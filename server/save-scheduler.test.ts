/**
 * 落盘调度器行为测试（2026-10-19 新增）。
 *
 * 这组测试的存在理由：一整部《加油啊》4 话是被这个 bug 吃掉的。
 * 当时的 saveAll 是纯尾部防抖，一次生成跑 5~8 分钟、期间每隔几百毫秒 save 一次，
 * 定时器被无限推后 → 整个任务期间磁盘一次没动 → 进程被 tsx watch 热重启杀掉时
 * beforeExit/SIGTERM 不执行 → 成果全没。
 *
 * 所以这里刻意**不用「断言常量存在」的方式**，而是用假时钟真的把连续调度跑一遍，
 * 断言「在最长的那次连续忙碌里，flush 到底有没有发生、发生了几次」。
 * （本项目已踩过「造好了对象但没传进去，测试全绿而行为没变」的坑。）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSaveScheduler } from './save-scheduler.js';

describe('落盘调度器 —— 带最长上限的防抖', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('连续调度超过 maxWait 后，flush 必须真的发生（事故场景本身）', () => {
    const flush = vi.fn();
    const s = createSaveScheduler(flush, { debounceMs: 800, maxWaitMs: 5000 });

    // 模拟一次 8 分钟生成：每 300ms 存一次盘，一路不停。
    // 纯尾部防抖在这里会一次都不落盘；上限必须把它截住。
    for (let i = 0; i < 1600; i++) {
      s.schedule();
      vi.advanceTimersByTime(300);
    }

    expect(flush.mock.calls.length).toBeGreaterThan(0);
    // 8 分钟里按 5 秒上限至少落 ~96 次，绝不能是 1 次
    expect(flush.mock.calls.length).toBeGreaterThan(90);
  });

  it('纯尾部防抖会漏掉的极端情形：变更间隔恰好短于 debounceMs', () => {
    const flush = vi.fn();
    const s = createSaveScheduler(flush, { debounceMs: 800, maxWaitMs: 5000 });

    // 每 500ms 一次，永远等不满 800ms 的静默期
    for (let i = 0; i < 60; i++) {
      s.schedule();
      vi.advanceTimersByTime(500);
    }

    expect(flush.mock.calls.length).toBeGreaterThanOrEqual(5);
  });

  it('空闲突发仍然合并成一次写（没把防抖优化白拆了）', () => {
    const flush = vi.fn();
    const s = createSaveScheduler(flush, { debounceMs: 800, maxWaitMs: 5000 });

    // 一簇密集变更后安静下来
    for (let i = 0; i < 20; i++) {
      s.schedule();
      vi.advanceTimersByTime(10);
    }
    expect(flush).not.toHaveBeenCalled(); // 还没到 800ms
    vi.advanceTimersByTime(800);
    expect(flush).toHaveBeenCalledTimes(1); // 整簇只写一次
  });

  it('maxWait 一到就落盘，不必等静默期结束', () => {
    const flush = vi.fn();
    const s = createSaveScheduler(flush, { debounceMs: 800, maxWaitMs: 5000 });

    s.schedule();
    vi.advanceTimersByTime(5000);
    expect(flush).toHaveBeenCalledTimes(1); // 恰好 5s 触发
  });

  it('flushNow 立刻落盘并取消待落盘，不留悬挂定时器', () => {
    const flush = vi.fn();
    const s = createSaveScheduler(flush, { debounceMs: 800, maxWaitMs: 5000 });

    s.schedule();
    expect(s.isPending()).toBe(true);
    s.flushNow();
    expect(s.isPending()).toBe(false);
    expect(flush).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(60_000);
    expect(flush).toHaveBeenCalledTimes(1); // 不会再补一次
  });

  it('flushNow 在无挂起变更时也是安全的空操作语义', () => {
    const flush = vi.fn();
    const s = createSaveScheduler(flush, { debounceMs: 800, maxWaitMs: 5000 });
    expect(() => s.flushNow()).not.toThrow();
    expect(() => s.flushNow()).not.toThrow();
  });

  it('自定义时钟可用（测试不依赖真实时间）', () => {
    const flush = vi.fn();
    let t = 0;
    const s = createSaveScheduler(flush, { debounceMs: 800, maxWaitMs: 5000, now: () => t });
    s.schedule();
    expect(s.isPending()).toBe(true);
    t += 100_000; // 时间快进，但没 advanceTimers → 定时器不会自己响
    expect(flush).not.toHaveBeenCalled();
  });
});
