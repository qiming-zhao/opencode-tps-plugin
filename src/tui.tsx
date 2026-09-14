import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui";
import { createMemo, createSignal, Show } from "solid-js";
import { TurnSession } from "./core/turn.js";
import { createStreamEstimator, estimateTokens, type StreamEstimator } from "./core/estimator.js";
import { resolveSettings } from "./config/settings.js";
import { formatStatusBar } from "./view/format.js";
import { pickSpeedColor } from "./view/theme.js";
import type { PluginSettings, SpeedSnapshot } from "./types/index.js";

interface SessionEntry {
  snapshot: SpeedSnapshot;
}

function ThroughputGauge(props: {
  api: TuiPluginApi;
  settings: PluginSettings;
  sessionId: string;
  readings: () => ReadonlyMap<string, SessionEntry>;
}) {
  const current = createMemo(() => props.readings().get(props.sessionId));

  return (
    <Show when={current()} fallback={<box flexShrink={0} />}>
      {(entry) => (
        <box flexDirection="row" flexShrink={0}>
          <text fg={pickSpeedColor(props.api.theme.current, props.settings, entry().snapshot)}>
            {formatStatusBar(entry().snapshot, props.settings)}
          </text>
        </box>
      )}
    </Show>
  );
}

const tui: TuiPlugin = async (api) => {
  const settings = resolveSettings();
  if (!settings.enabled) return;

  const [sessionStore, setSessionStore] = createSignal(new Map<string, SessionEntry>());
  const sessions = new Map<string, TurnSession>();
  const parentSessionMap = new Map<string, string>();
  const pendingSubtasks = new Set<string>();

  const streamCache = new Map<string, Map<string, string | StreamEstimator>>();
  const roleDirectory = new Map<string, Map<string, string>>();
  const broadcastTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const cleanups: Array<() => void> = [];

  function recordParent(child: string, parent?: string): void {
    if (!child || !parent || child === parent) return;
    parentSessionMap.set(child, parent);
  }

  function findRootSession(id: string): string {
    let target = id;
    const seen = new Set<string>();
    while (target && !seen.has(target)) {
      seen.add(target);
      let p = parentSessionMap.get(target);
      if (!p) {
        try {
          p = api.state?.session?.get(target)?.parentID;
          if (p) parentSessionMap.set(target, p);
        } catch {}
      }
      if (p && p !== target) {
        target = p;
      } else {
        break;
      }
    }
    return target;
  }

  function getSessionCache(id: string): Map<string, string | StreamEstimator> {
    let cache = streamCache.get(id);
    if (!cache) {
      cache = new Map();
      streamCache.set(id, cache);
    }
    return cache;
  }

  function obtainSession(id: string): TurnSession {
    let s = sessions.get(id);
    if (!s) {
      s = new TurnSession(id, settings.samplingWindowMs);
      sessions.set(id, s);
    }
    return s;
  }

  function stopBroadcastTimer(id: string): void {
    const timer = broadcastTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      broadcastTimers.delete(id);
    }
  }

  function commitSnapshot(id: string, active: boolean, now: number = Date.now()): void {
    const s = sessions.get(id);
    if (!s) return;
    stopBroadcastTimer(id);

    if (active) {
      s.lastPublishedAt = now;
    }

    const snapshot = s.getSnapshot(active, now);
    setSessionStore((prev) => new Map(prev).set(id, { snapshot }));
  }

  function scheduleBroadcast(id: string, delay: number): void {
    if (broadcastTimers.has(id)) return;
    const timer = setTimeout(() => {
      broadcastTimers.delete(id);
      const s = sessions.get(id);
      const now = Date.now();
      if (s && s.active && now - s.lastPublishedAt >= settings.refreshIntervalMs) {
        commitSnapshot(id, true, now);
      }
    }, delay);
    broadcastTimers.set(id, timer);
  }

  function throttleBroadcast(id: string, now: number): void {
    const s = sessions.get(id);
    if (!s) return;
    const elapsedSinceBroadcast = now - s.lastPublishedAt;

    const delayThrottle = settings.refreshIntervalMs - elapsedSinceBroadcast;

    if (delayThrottle <= 0) {
      commitSnapshot(id, true, now);
    } else {
      scheduleBroadcast(id, Math.max(1, delayThrottle));
    }
  }

  function resetTurn(id: string, userMsgId: string): void {
    const s = obtainSession(id);
    s.begin(userMsgId);
    stopBroadcastTimer(id);
    streamCache.delete(id);
    commitSnapshot(id, true);
  }

  function registerTokens(sessionId: string, count: number): void {
    if (count <= 0) return;
    const rootId = findRootSession(sessionId);
    const s = obtainSession(rootId);
    const now = Date.now();
    s.appendTokens(count, now);
    throttleBroadcast(rootId, now);
  }

  function absorbDelta(sessionId: string, messageId: string, partId: string, delta: string): number {
    const cache = getSessionCache(sessionId);
    for (const kind of ["text", "reasoning"]) {
      const key = `${messageId}:${partId}:${kind}`;
      const prev = cache.get(key);
      cache.set(key, `${typeof prev === "string" ? prev : ""}${delta}`);
    }

    const liveKey = `${messageId}:${partId}:stream`;
    let estimator = cache.get(liveKey);
    if (!estimator || typeof estimator === "string") {
      estimator = createStreamEstimator(settings.tokenMode);
      cache.set(liveKey, estimator);
    }
    return estimator.feed(delta);
  }

  function shouldObserveText(sessionId: string, messageId: string, text: string): boolean {
    if (!text) return false;
    const role = roleDirectory.get(sessionId)?.get(messageId);
    return role !== "user";
  }

  api.slots.register({
    order: 20,
    slots: {
      session_prompt_right(_ctx, props) {
        return (
          <ThroughputGauge
            api={api}
            settings={settings}
            sessionId={props.session_id}
            readings={sessionStore}
          />
        );
      },
    },
  });

  cleanups.push(
    api.event.on("session.created", (ev) => {
      const meta = ev.properties?.info;
      if (meta?.id) {
        if (meta.parentID) {
          recordParent(meta.id, meta.parentID);
        } else if (pendingSubtasks.size > 0) {
          const parent = Array.from(pendingSubtasks).pop();
          if (parent) recordParent(meta.id, parent);
        }
      }
    })
  );

  cleanups.push(
    api.event.on("session.updated", (ev) => {
      const meta = ev.properties?.info;
      if (meta?.id && meta.parentID) {
        recordParent(meta.id, meta.parentID);
      }
    })
  );

  cleanups.push(
    api.event.on("message.updated", (ev) => {
      const info = ev.properties.info;
      if (!info) return;

      const rawSessionId = ev.properties.sessionID || info.sessionID;
      const rootSessionId = findRootSession(rawSessionId);

      let roles = roleDirectory.get(rawSessionId);
      if (!roles) {
        roles = new Map();
        roleDirectory.set(rawSessionId, roles);
      }
      roles.set(info.id, info.role);

      if (info.role === "user") {
        if (rawSessionId === rootSessionId) {
          const s = obtainSession(rootSessionId);
          if (s.userMessageId !== info.id) {
            resetTurn(rootSessionId, info.id);
          }
        }
        return;
      }

      if (info.role === "assistant" && info.time?.completed) {
        const s = obtainSession(rootSessionId);
        const reported = (info.tokens?.output ?? 0) + (info.tokens?.reasoning ?? 0);
        const isToolCall = info.finish === "tool-calls";
        s.completeStep(info.id, reported, isToolCall, info.time.completed);

        if (s.active) {
          commitSnapshot(rootSessionId, true);
        }
      }
    })
  );

  cleanups.push(
    api.event.on("message.part.delta", (ev) => {
      if (ev.properties.field === "output" || ev.properties.field === "error") {
        return;
      }
      const rawSessionId = ev.properties.sessionID;
      const delta = ev.properties.delta;
      if (rawSessionId && delta && shouldObserveText(rawSessionId, ev.properties.messageID, delta)) {
        const tokens = absorbDelta(
          rawSessionId,
          ev.properties.messageID,
          ev.properties.partID || "delta",
          delta
        );
        registerTokens(rawSessionId, tokens);
      }
    })
  );

  cleanups.push(
    api.event.on("message.part.updated", (ev) => {
      const part = ev.properties.part;
      if (!part) return;

      const rawSessionId = ev.properties.sessionID;
      const rootSessionId = findRootSession(rawSessionId);

      if (part.type === "tool") {
        if (part.tool === "task") {
          pendingSubtasks.add(rawSessionId);
        }
        const s = obtainSession(rootSessionId);
        const status = part.state?.status;
        if (status === "running") {
          if (s.active) {
            s.setToolStatus(true);
            commitSnapshot(rootSessionId, true);
          }
        } else if (status === "completed" || status === "error") {
          if (part.tool === "task") {
            pendingSubtasks.delete(rawSessionId);
          }
          if (s.active && s.toolActive) {
            s.setToolStatus(false);
            commitSnapshot(rootSessionId, true);
          }
        }
        return;
      }

      if (part.type !== "text" && part.type !== "reasoning") return;
      const text = (part as { text?: string; reasoning?: string }).text ?? (part as { reasoning?: string }).reasoning ?? "";
      if (!text || !shouldObserveText(rawSessionId, part.messageID, text)) return;

      const cache = getSessionCache(rawSessionId);
      const key = `${part.messageID}:${part.id}:${part.type}`;
      const prev = cache.get(key);
      const previousText = typeof prev === "string" ? prev : "";

      let count: number;
      if (text.startsWith(previousText)) {
        count = estimateTokens(text.slice(previousText.length), settings.tokenMode);
      } else {
        count = estimateTokens(text, settings.tokenMode);
      }
      cache.set(key, text);
      registerTokens(rawSessionId, count);
    })
  );

  cleanups.push(
    api.event.on("session.idle", (ev) => {
      const rawSessionId = ev.properties.sessionID;
      const rootSessionId = findRootSession(rawSessionId);
      streamCache.delete(rawSessionId);

      // Subagent idle events should not conclude the root turn.
      if (rawSessionId !== rootSessionId) return;

      const s = sessions.get(rootSessionId);
      if (!s) return;
      s.finish();
      stopBroadcastTimer(rootSessionId);
      commitSnapshot(rootSessionId, false);
    })
  );

  const heartbeat = setInterval(() => {
    const now = Date.now();
    for (const [id, s] of sessions) {
      if (s.active && s.promptSentAt !== null) {
        commitSnapshot(id, true, now);
      }
    }
  }, 1000);
  cleanups.push(() => clearInterval(heartbeat));

  api.lifecycle.onDispose(() => {
    for (const dispose of cleanups) dispose();
    sessions.clear();
    parentSessionMap.clear();
    pendingSubtasks.clear();
    streamCache.clear();
    roleDirectory.clear();
    for (const timer of broadcastTimers.values()) clearTimeout(timer);
    broadcastTimers.clear();
    setSessionStore(new Map());
  });
};

const plugin: TuiPluginModule = {
  id: "opencode-tps-plugin",
  tui,
};

export default plugin;
