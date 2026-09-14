import type { TokenMode } from "../types/index.js";

const CJK_RANGES: Array<[number, number]> = [
  [0x4e00, 0x9fff],
  [0x3400, 0x4dbf],
  [0xf900, 0xfaff],
  [0x3000, 0x303f],
  [0xff01, 0xff60],
  [0xac00, 0xd7af],
];

export function isCjkCodepoint(code: number): boolean {
  for (let i = 0; i < CJK_RANGES.length; i++) {
    const range = CJK_RANGES[i]!;
    if (code >= range[0] && code <= range[1]) {
      return true;
    }
  }
  return false;
}

function countCjkUnits(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    if (isCjkCodepoint(text.charCodeAt(i))) {
      count++;
    }
  }
  return count;
}

export function estimateTokensByChar(text: string, divisor: number): number {
  if (!text) return 0;
  const cjk = countCjkUnits(text);
  return cjk + Math.ceil((text.length - cjk) / divisor);
}

export function estimateTokensByWord(text: string, divisor: number = 0.75): number {
  if (!text) return 0;
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return Math.ceil(trimmed.split(/\s+/).length / divisor);
}

export function estimateTokens(text: string, mode: TokenMode = "general"): number {
  if (mode === "prose") {
    return estimateTokensByWord(text, 0.75);
  }
  return estimateTokensByChar(text, mode === "program" ? 3 : 4);
}

export interface StreamEstimator {
  feed(delta: string): number;
  total(): number;
  reset(): void;
}

export function createCharStreamEstimator(divisor: number): StreamEstimator {
  let cjkTotal = 0;
  let nonCjkTotal = 0;
  let previousTokenTotal = 0;

  return {
    feed(delta: string): number {
      if (!delta) return 0;
      const cjk = countCjkUnits(delta);
      cjkTotal += cjk;
      nonCjkTotal += delta.length - cjk;
      // Round against cumulative non-CJK characters to prevent chunk fragmentation errors.
      const currentTokenTotal = cjkTotal + Math.ceil(nonCjkTotal / divisor);
      const added = currentTokenTotal - previousTokenTotal;
      previousTokenTotal = currentTokenTotal;
      return added;
    },
    total(): number {
      return previousTokenTotal;
    },
    reset(): void {
      cjkTotal = 0;
      nonCjkTotal = 0;
      previousTokenTotal = 0;
    },
  };
}

const SPACE_REGEX = /\s/;

export function createWordStreamEstimator(divisor: number = 0.75): StreamEstimator {
  let wordCount = 0;
  let previousTokenTotal = 0;
  let inWord = false;

  return {
    feed(delta: string): number {
      if (!delta) return 0;
      for (let i = 0; i < delta.length; i++) {
        if (SPACE_REGEX.test(delta[i]!)) {
          inWord = false;
        } else if (!inWord) {
          wordCount++;
          inWord = true;
        }
      }
      const currentTokenTotal = Math.ceil(wordCount / divisor);
      const added = currentTokenTotal - previousTokenTotal;
      previousTokenTotal = currentTokenTotal;
      return added;
    },
    total(): number {
      return previousTokenTotal;
    },
    reset(): void {
      wordCount = 0;
      previousTokenTotal = 0;
      inWord = false;
    },
  };
}

export function createStreamEstimator(mode: TokenMode = "general"): StreamEstimator {
  if (mode === "prose") {
    return createWordStreamEstimator(0.75);
  }
  return createCharStreamEstimator(mode === "program" ? 3 : 4);
}
