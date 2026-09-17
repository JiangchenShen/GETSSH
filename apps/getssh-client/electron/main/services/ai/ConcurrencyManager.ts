export class ConcurrencyManager {
  private static instance: ConcurrencyManager;
  private activeRequests: Map<string, number> = new Map();
  private limits: Map<string, number> = new Map();
  private queues: Map<string, Array<{ resolve: () => void; reject: (err: Error) => void }>> = new Map();

  private constructor() {
    this.limits.set('deepseek', 50);
    this.limits.set('kimi', 5); 
    this.limits.set('zhipu', 10);
    this.limits.set('openai', 20);
    this.limits.set('anthropic', 20);
    this.limits.set('gemini', 20);
    // MiniMax 旗舰 M3 的 RPM 只有 200（M2.x 是 500），比同档竞品都紧，保守取小
    this.limits.set('minimax', 4);
    // 百炼 RPM 很高（主力 30000），但有秒级 RPS 二次管控：
    // 「即使分钟级未超限，秒内突发流量仍会触发限流」，所以靠并发信号量做整形
    this.limits.set('qwen', 8);
    this.limits.set('ollama', 10);
  }

  public static getInstance(): ConcurrencyManager {
    if (!ConcurrencyManager.instance) {
      ConcurrencyManager.instance = new ConcurrencyManager();
    }
    return ConcurrencyManager.instance;
  }

  public setLimit(provider: string, limit: number) {
    this.limits.set(provider.toLowerCase(), limit);
  }

  public async acquire(provider: string, signal?: AbortSignal): Promise<void> {
    const key = provider.toLowerCase();
    const limit = this.limits.get(key) || 10;
    const currentActive = this.activeRequests.get(key) || 0;

    if (signal?.aborted) {
      throw new Error('Request was aborted prior to acquiring concurrency slot');
    }

    if (currentActive < limit) {
      this.activeRequests.set(key, currentActive + 1);
      return Promise.resolve();
    }

    // Queue the request with abort listener
    return new Promise((resolve, reject) => {
      if (!this.queues.has(key)) {
        this.queues.set(key, []);
      }

      const queueItem = { resolve, reject };
      const queue = this.queues.get(key)!;
      queue.push(queueItem);

      if (signal) {
        const onAbort = () => {
          signal.removeEventListener('abort', onAbort);
          const idx = queue.indexOf(queueItem);
          if (idx !== -1) {
            queue.splice(idx, 1);
            reject(new Error('Request aborted while waiting in concurrency queue'));
          }
        };
        signal.addEventListener('abort', onAbort, { once: true });
      }
    });
  }

  public release(provider: string): void {
    const key = provider.toLowerCase();
    const currentActive = this.activeRequests.get(key) || 0;

    const queue = this.queues.get(key);
    if (queue && queue.length > 0) {
      const { resolve } = queue.shift()!;
      resolve();
    } else {
      this.activeRequests.set(key, Math.max(0, currentActive - 1));
    }
  }
}
