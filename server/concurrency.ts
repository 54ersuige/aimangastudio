/**
 * 有界并发（bounded concurrency）工具。
 *
 * 为什么不用 `Promise.all(items.map(fn))`：那会把所有请求一次性打出去，
 * 出图这种"每格要读 4 张参考图 + 最多 3 轮重试"的场景会瞬间打爆上游限流，
 * 而且失败的格子会把内存里的图一次性堆住。有界并发的三个关键性质：
 *
 *  1. **上限**：同时在跑的 worker 数恒 ≤ limit，上游看到的并发是平稳的；
 *  2. **保序**：结果按输入下标回填，调用方可以安全地用 `result[i]` 对应 `items[i]`；
 *  3. **失败隔离**：单项抛错不会中断整批，失败信息按原位保留。
 *
 * 设计取舍：worker 用"抢下标"模式而非"分片"模式。分片（slice 给每个 worker）
 * 在任务耗时不均时会拖尾 —— 一个 worker 干等它那条最慢的。抢下标则只要有
 * 空闲就立刻拿下一个，尾延迟明显更短。
 */

/** 单项处理函数。`index` 是该项在输入数组中的原始下标。 */
export type IndexedTask<T, R> = (item: T, index: number) => Promise<R>;

export interface MapConcurrentOptions {
  /** 同时在跑的最大任务数。≤1 退化为串行。默认 1（保持历史行为，安全默认）。 */
  limit?: number;
  /**
   * 每完成一项回调一次（含失败项）。
   * done = 已完成数（含失败），total = 输入总数。
   * 用于任务进度上报。
   */
  onSettled?: (done: number, total: number) => void;
}

/** 单项失败的信息。 */
export interface SettledFailure<E = unknown> {
  index: number;
  error: E;
}

/**
 * 结果信封：成功项按原下标回填，失败项在下标处为 undefined。
 *
 * 刻意不用 `T | Error` 混合数组 —— 那会让每个调用点都要写 `instanceof` 判断，
 * 漏一处就会把一个 Error 对象当成正常结果往下传。
 */
export interface SettledResult<R, E = unknown> {
  /** 与输入等长。成功的项有值，失败的项为 undefined。 */
  values: Array<R | undefined>;
  /** 失败的项及其原因（按完成顺序，非输入顺序）。 */
  failures: Array<SettledFailure<E>>;
}

function normalizeLimit(limit: number | undefined, total: number): number {
  if (limit == null || !Number.isFinite(limit)) return 1;
  const n = Math.floor(limit);
  if (n < 1) return 1;
  return Math.min(n, Math.max(1, total));
}

/**
 * 以有界并发对数组逐项执行异步任务，返回保序的结算结果。
 *
 * 不会 reject —— 除非任务本身是同步抛出且未被 try 包住（那也不可能，已全包）。
 * 调用方通过 `failures` 判断是否有失败项。
 */
export async function mapConcurrent<T, R>(
  items: readonly T[],
  task: IndexedTask<T, R>,
  options: MapConcurrentOptions = {},
): Promise<SettledResult<R>> {
  const total = items.length;
  const values: Array<R | undefined> = new Array(total);
  const failures: Array<SettledFailure> = [];
  if (total === 0) return { values, failures };

  const limit = normalizeLimit(options.limit, total);
  let next = 0;
  let done = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      // 抢下标：Node 单线程下 `next++` 到读取之间没有 await，天然原子。
      const index = next++;
      if (index >= total) return;
      try {
        values[index] = await task(items[index], index);
      } catch (error) {
        failures.push({ index, error });
      } finally {
        done += 1;
        options.onSettled?.(done, total);
      }
    }
  };

  await Promise.all(Array.from({ length: limit }, () => worker()));
  return { values, failures };
}
