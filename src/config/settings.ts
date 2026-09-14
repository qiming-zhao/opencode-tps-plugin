import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { PluginSettings, TokenMode } from "../types/index.js";

export const defaultSettings: PluginSettings = {
  enabled: true,
  refreshIntervalMs: 50,
  samplingWindowMs: 1000,
  showAvg: true,
  showRate: true,
  showTokens: true,
  showTimer: true,
  tokenMode: "general",
  useColors: true,
  slowRate: 10,
  fastRate: 50,
};

const TOKEN_MODES: readonly TokenMode[] = ["general", "program", "prose"];

function parseBoolean(val: unknown, fallback: boolean): boolean {
  return typeof val === "boolean" ? val : fallback;
}

function parseNumber(val: unknown, fallback: number, min: number, max: number): number {
  return typeof val === "number" && Number.isFinite(val) && val >= 0
    ? Math.max(min, Math.min(max, val))
    : fallback;
}

function parseTokenMode(val: unknown, fallback: TokenMode): TokenMode {
  return TOKEN_MODES.includes(val as TokenMode) ? (val as TokenMode) : fallback;
}

function mergeSettings(partial: Partial<PluginSettings>, base: PluginSettings): PluginSettings {
  let slowRate = parseNumber(partial.slowRate, base.slowRate, 0, 10000);
  let fastRate = parseNumber(partial.fastRate, base.fastRate, 0, 10000);

  // If ordering is invalid, reset both to base defaults.
  if (slowRate >= fastRate) {
    slowRate = base.slowRate;
    fastRate = base.fastRate;
  }

  return {
    enabled: parseBoolean(partial.enabled, base.enabled),
    refreshIntervalMs: parseNumber(partial.refreshIntervalMs, base.refreshIntervalMs, 10, 5000),
    samplingWindowMs: parseNumber(partial.samplingWindowMs, base.samplingWindowMs, 100, 30000),
    showAvg: parseBoolean(partial.showAvg, base.showAvg),
    showRate: parseBoolean(partial.showRate, base.showRate),
    showTokens: parseBoolean(partial.showTokens, base.showTokens),
    showTimer: parseBoolean(partial.showTimer, base.showTimer),
    tokenMode: parseTokenMode(partial.tokenMode, base.tokenMode),
    useColors: parseBoolean(partial.useColors, base.useColors),
    slowRate,
    fastRate,
  };
}

function readJsonFile<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === "object" && parsed !== null ? (parsed as T) : null;
  } catch {
    return null;
  }
}

function readEnv(key: string): string | undefined {
  return process.env[`TPS_PLUGIN_${key}`];
}

function loadEnvSettings(): Partial<PluginSettings> {
  const result: Partial<PluginSettings> = {};

  const boolKeys = [
    ["enabled", "ENABLED"],
    ["useColors", "USE_COLORS"],
  ] as const;

  for (const [key, envName] of boolKeys) {
    const val = readEnv(envName);
    if (val !== undefined) {
      result[key] = val === "true";
    }
  }

  const numKeys = [
    ["refreshIntervalMs", "REFRESH_INTERVAL_MS", true],
    ["samplingWindowMs", "SAMPLING_WINDOW_MS", true],
    ["slowRate", "SLOW_RATE", false],
    ["fastRate", "FAST_RATE", false],
  ] as const;

  for (const [key, envName, isInt] of numKeys) {
    const val = readEnv(envName);
    if (val !== undefined) {
      const parsed = isInt ? parseInt(val, 10) : parseFloat(val);
      if (!Number.isNaN(parsed)) {
        result[key] = parsed;
      }
    }
  }

  const mode = readEnv("TOKEN_MODE");
  if (mode !== undefined) {
    if (mode === "general" || mode === "program" || mode === "prose") {
      result.tokenMode = mode;
    }
  }

  return result;
}

export function resolveSettings(overrides?: Partial<PluginSettings>): PluginSettings {
  const localDir = path.join(process.cwd(), ".opencode");
  const localConfig = readJsonFile<Partial<PluginSettings>>(path.join(localDir, "tps-plugin.json"));

  const userDir = path.join(os.homedir(), ".config", "opencode");
  const userConfig = readJsonFile<Partial<PluginSettings>>(path.join(userDir, "tps-plugin.json"));

  const merged = {
    ...localConfig,
    ...userConfig,
    ...loadEnvSettings(),
    ...overrides,
  };

  return mergeSettings(merged, defaultSettings);
}
