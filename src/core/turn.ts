import { VelocitySampler } from "./sampler.js";
import type { SpeedSnapshot } from "../types/index.js";

export class TurnSession {
  public userMessageId: string | null = null;
  public promptSentAt: number | null = null;
  public accumulatedReportedTokens: number = 0;
  public activeStepTokens: number = 0;
  public completedMessageIds = new Set<string>();
  public readonly sampler: VelocitySampler;
  public lastPublishedAt: number = 0;
  public active: boolean = false;
  public toolActive: boolean = false;
  public currentToolStartedAt: number | null = null;
  public totalToolDurationMs: number = 0;

  constructor(public readonly sessionId: string, windowMs?: number) {
    this.sampler = new VelocitySampler({ windowMs });
  }

  public begin(userMessageId: string, now: number = Date.now()): void {
    this.userMessageId = userMessageId;
    this.promptSentAt = now;
    this.accumulatedReportedTokens = 0;
    this.activeStepTokens = 0;
    this.completedMessageIds.clear();
    this.sampler.reset();
    this.lastPublishedAt = now;
    this.active = true;
    this.toolActive = false;
    this.currentToolStartedAt = null;
    this.totalToolDurationMs = 0;
  }

  public setToolStatus(active: boolean, now: number = Date.now()): void {
    if (this.toolActive === active) return;
    if (active) {
      this.toolActive = true;
      this.currentToolStartedAt = now;
    } else {
      this.toolActive = false;
      if (this.currentToolStartedAt !== null) {
        this.totalToolDurationMs += Math.max(0, now - this.currentToolStartedAt);
        this.currentToolStartedAt = null;
      }
    }
  }

  public appendTokens(count: number, now: number = Date.now()): void {
    if (count <= 0) return;
    if (this.promptSentAt === null) {
      this.promptSentAt = now;
    }
    this.active = true;
    // Model token output indicates tool wait has concluded.
    this.setToolStatus(false, now);
    this.activeStepTokens += count;
    this.sampler.record(count, now);
  }

  public completeStep(messageId: string, reportedTokens?: number, isToolCall?: boolean, now: number = Date.now()): void {
    if (this.completedMessageIds.has(messageId)) return;
    const tokens = typeof reportedTokens === "number" && reportedTokens > 0
      ? reportedTokens
      : this.activeStepTokens;
    this.accumulatedReportedTokens += tokens;
    this.activeStepTokens = 0;
    this.completedMessageIds.add(messageId);

    if (isToolCall) {
      this.setToolStatus(true, now);
    }
  }

  public finish(now: number = Date.now()): void {
    this.setToolStatus(false, now);
    this.active = false;
  }

  public getSnapshot(isActive: boolean, now: number = Date.now()): SpeedSnapshot {
    const totalTokens = this.accumulatedReportedTokens + this.activeStepTokens;
    const start = this.promptSentAt ?? now;
    const elapsedMs = Math.max(0, now - start);

    let activeToolWait = 0;
    if (this.toolActive && this.currentToolStartedAt !== null) {
      activeToolWait = Math.max(0, now - this.currentToolStartedAt);
    }
    // Deduct total tool execution latency from net generation duration.
    const totalToolMs = this.totalToolDurationMs + activeToolWait;
    const netGenerationMs = Math.max(100, elapsedMs - totalToolMs);
    const averageSpeed = totalTokens > 0 ? totalTokens / (netGenerationMs / 1000) : 0;
    const instantSpeed = isActive ? this.sampler.getInstantSpeed() : 0;

    return {
      instantSpeed,
      averageSpeed,
      totalTokens,
      durationMs: elapsedMs,
      active: isActive,
      toolActive: isActive && this.toolActive,
    };
  }
}
