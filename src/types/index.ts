export type TokenMode = "general" | "program" | "prose";

export interface PluginSettings {
  enabled: boolean;
  refreshIntervalMs: number;
  samplingWindowMs: number;
  showAvg: boolean;
  showRate: boolean;
  showTokens: boolean;
  showTimer: boolean;
  tokenMode: TokenMode;
  useColors: boolean;
  slowRate: number;
  fastRate: number;
}

export interface SpeedSnapshot {
  instantSpeed: number;
  averageSpeed: number;
  totalTokens: number;
  durationMs: number;
  active: boolean;
  toolActive?: boolean;
}
