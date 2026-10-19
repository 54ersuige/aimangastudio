/**
 * 落盘调度器：带「最长等待上限」的防抖。
 *
 * 【为什么不能只用普通防抖】——2026-10-19 真实事故，丢了一整部《加油啊》4 话。
 * 一次生成要跑 5~8 分钟，期间每隔几百毫秒就 save 一次。普通「尾部防抖」每次都
 * clearTimeout 重新计时，于是定时器被无限往后推，**整场任务期间一次都没落过盘**：
 * 磁盘上的文件冻结在任务开始那一刻。进程一旦被杀掉（改一行代码 tsx watch 热重启、
 * 崩溃、taskkill /F），beforeExit / SIGINT / SIGTERM 处理器统统不执行，
 * 整场生成的成果归零。
 *
 * 加了 maxWait 之后：
 *   - 空闲时仍按 debounceMs 合并突发写（高频小改动不会打爆磁盘）；
 *   - 连续 busy 时由 maxWaitMs 强制收口，**丢数据窗口从「整场任务」压到 5 秒**。
 *
 * 单独成模块而不是塞在 series-store 里，是为了能在测试里用假时钟
 * 真跑出「连续调度会不会落盘」这个行为。断言常量存在 ≠ 断言行为生效，
 * 这个坑本项目已经踩过一次（造好了 config 却没传给 generateText，测试全绿而超时没变）。
 */

export interface SaveSchedulerOptions {
  /** 尾部防抖窗口：最后一次变更后等这么久才落盘。 */
  debounceMs: number;
  /** 最长等待上限：距本轮首次挂起超过这么久就强制落盘，与是否还在继续变更无关。 */
  maxWaitMs: number;
  /** 可注入时钟，便于测试。 */
  now?: () => number;
}

export interface SaveScheduler {
  /** 记一次变更并安排落盘。连续调用会合并，但受 maxWaitMs 约束。 */
  schedule(): void;
  /** 立刻取消待落盘并同步落盘（幂等）。 */
  flushNow(): void;
  /** 当前是否有待落盘的变更。 */
  isPending(): boolean;
}

export function createSaveScheduler(flush: () => void, opts: SaveSchedulerOptions): SaveScheduler {
  const now = opts.now ?? (() => Date.now());
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** 本轮防抖窗口的起点；0 表示当前没有待落盘变更。 */
  let firstPendingAt = 0;

  function clear(): void {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    firstPendingAt = 0;
  }

  return {
    schedule(): void {
      const t = now();
      if (firstPendingAt === 0) firstPendingAt = t; // 本轮挂起的起点
      if (timer) clearTimeout(timer);
      // 取「尾部防抖」和「最长上限」中更早的那个
      const waited = t - firstPendingAt;
      const wait = Math.min(opts.debounceMs, Math.max(0, opts.maxWaitMs - waited));
      timer = setTimeout(() => {
        timer = null;
        firstPendingAt = 0;
        flush();
      }, wait);
      timer.unref?.(); // 不阻止进程自然退出；退出前的兜底见 series-store 的信号处理
    },

    flushNow(): void {
      clear();
      // 无条件调用：flush 自身是幂等的（无挂起变更时直接返回）。
      // 语义就是「确保此刻已落盘」，而不是「如果有才落盘」。
      flush();
    },

    isPending(): boolean {
      return timer !== null;
    },
  };
}
