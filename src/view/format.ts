import type { PluginSettings, SpeedSnapshot } from "../types/index.js";

export function formatInteger(val: number): string {
  return Math.round(val).toLocaleString("en-US");
}

export function formatStopwatch(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
}

export function formatStatusBar(snapshot: SpeedSnapshot, settings: PluginSettings): string {
  const segments: string[] = [];

  if (snapshot.active) {
    if (settings.showRate) {
      const speedText = snapshot.toolActive ? "TOOL" : snapshot.instantSpeed.toFixed(1);
      segments.push(`TPS: ${speedText}`);
    }
    if (settings.showAvg) {
      segments.push(`AVG: ${snapshot.averageSpeed.toFixed(1)}`);
    }
  } else if (settings.showAvg || settings.showRate) {
    segments.push(`AVG: ${snapshot.averageSpeed.toFixed(1)} TPS`);
  }

  if (settings.showTokens) {
    segments.push(`TOK: ${formatInteger(snapshot.totalTokens)}`);
  }

  if (settings.showTimer) {
    segments.push(formatStopwatch(snapshot.durationMs));
  }

  return segments.length > 0 ? segments.join(" | ") : "TPS";
}
