import type { PluginSettings, SpeedSnapshot } from "../types/index.js";

export type ThemeColors = Record<string, any>;

export function pickSpeedColor(
  theme: ThemeColors,
  settings: PluginSettings,
  snapshot: SpeedSnapshot
): any {
  if (!snapshot.active) {
    return theme.textMuted;
  }
  if (!settings.useColors) {
    return theme.text;
  }
  if (snapshot.toolActive) {
    return theme.warning;
  }

  const effectiveSpeed = snapshot.instantSpeed > 0 ? snapshot.instantSpeed : snapshot.averageSpeed;
  if (effectiveSpeed < settings.slowRate) {
    return theme.error;
  }
  if (effectiveSpeed > settings.fastRate) {
    return theme.success;
  }
  return theme.warning;
}
