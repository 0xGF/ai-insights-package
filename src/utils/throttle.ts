// src/utils/throttle.ts
export class Throttle {
    private queue: Array<() => Promise<any>> = [];
    private running = 0;
    private lastCall = 0;
  
    constructor(
      private limit: number,
      private interval: number
    ) {}
  
    async add<T>(fn: () => Promise<T>): Promise<T> {
      // Wait if we're at the limit
      while (this.running >= this.limit) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
  
      // Wait for interval
      const now = Date.now();
      const timeToWait = this.lastCall + this.interval - now;
      if (timeToWait > 0) {
        await new Promise(resolve => setTimeout(resolve, timeToWait));
      }
  
      this.running++;
      this.lastCall = Date.now();
  
      try {
        const result = await fn();
        return result;
      } finally {
        this.running--;
      }
    }
  }