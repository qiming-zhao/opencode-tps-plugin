export interface VelocitySamplerOptions {
  windowMs?: number;
  halfLifeMs?: number;
}

interface TokenSample {
  timestamp: number;
  tokens: number;
}

export class VelocitySampler {
  private startTime: number = Date.now();
  private totalTokens: number = 0;
  private readonly samples: TokenSample[] = [];
  private readonly windowMs: number;
  private readonly defaultHalfLife: number;
  private smoothedRate: number = 0;
  private lastSmoothedTimestamp: number = 0;
  private initialized: boolean = false;

  constructor(options: VelocitySamplerOptions = {}) {
    this.windowMs = options.windowMs && options.windowMs > 0 ? options.windowMs : 1000;
    this.defaultHalfLife = options.halfLifeMs && options.halfLifeMs > 0 ? options.halfLifeMs : 250;
  }

  private prune(now: number): void {
    const threshold = now - this.windowMs;
    let cutIndex = -1;
    for (let i = 0; i < this.samples.length; i++) {
      if (this.samples[i]!.timestamp >= threshold) {
        cutIndex = i;
        break;
      }
    }
    const removeCount = cutIndex === -1 ? this.samples.length : cutIndex;
    const maxRetained = Math.max(removeCount, this.samples.length - 120);
    if (maxRetained > 0) {
      this.samples.splice(0, maxRetained);
    }
  }

  private computeRawWindowRate(now: number): number {
    const threshold = now - this.windowMs;
    let windowSum = 0;
    let earliest = now;

    for (let i = 0; i < this.samples.length; i++) {
      const sample = this.samples[i]!;
      if (sample.timestamp >= threshold) {
        windowSum += sample.tokens;
        if (sample.timestamp < earliest) {
          earliest = sample.timestamp;
        }
      }
    }

    if (windowSum === 0) return 0;

    // Use elapsed duration from oldest sample to current time to reflect natural pause decay.
    const durationSeconds = Math.max((now - earliest) / 1000, 0.3);
    return windowSum / durationSeconds;
  }

  public record(count: number, timestamp?: number): void {
    const now = timestamp ?? Date.now();
    this.totalTokens += count;
    this.samples.push({ timestamp: now, tokens: count });
    this.prune(now);

    const rawRate = this.computeRawWindowRate(now);
    if (!this.initialized) {
      // Clamp initial snapshot to prevent single initial chunks from spiking baseline.
      this.smoothedRate = Math.min(rawRate, 100);
      this.initialized = true;
    } else {
      const timeDelta = Math.max(1, now - this.lastSmoothedTimestamp);
      // Dynamically dampen volatility during bulk chunk insertions.
      const halfLife = count > 200 ? 5000 : count > 50 ? 3000 : this.defaultHalfLife;
      const decay = Math.exp(-Math.LN2 * timeDelta / halfLife);
      this.smoothedRate = decay * this.smoothedRate + (1 - decay) * rawRate;
    }
    this.lastSmoothedTimestamp = now;
  }

  public getInstantSpeed(): number {
    return this.initialized ? this.smoothedRate : this.computeRawWindowRate(Date.now());
  }

  public getAverageSpeed(): number {
    const elapsedSeconds = (Date.now() - this.startTime) / 1000;
    return elapsedSeconds <= 0 ? 0 : this.totalTokens / elapsedSeconds;
  }

  public getTotalTokens(): number {
    return this.totalTokens;
  }

  public getDurationMs(): number {
    return Date.now() - this.startTime;
  }

  public reset(): void {
    this.startTime = Date.now();
    this.totalTokens = 0;
    this.samples.length = 0;
    this.smoothedRate = 0;
    this.initialized = false;
    this.lastSmoothedTimestamp = 0;
  }
}
