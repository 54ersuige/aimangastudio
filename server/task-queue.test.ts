/**
 * 任务队列回归测试（2026-10-15 新增）。
 *
 * 锁住三条：同 key 互斥、progress 只能在 running 期上报并被夹到 0-100、
 * 30 分钟 TTL 惰性清理。后两项是 2026-09-18 未提交改动的一部分。
 *
 * 注意：task-queue 的状态是模块级 Map，测试之间靠唯一 key 隔离。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { runTask, getTask, listTasks, setTaskProgress, DuplicateTaskError } from './task-queue.js';

const tick = (n = 20) => new Promise<void>(r => setTimeout(r, n));
let seq = 0;
const uniq = (p: string) => `${p}-${process.pid}-${seq++}`;

/** 造一个可手动放行的闸门，让任务停在 running 状态供断言。 */
function gate() {
  let open!: () => void;
  const promise = new Promise<void>(r => { open = r; });
  return { promise, open };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('runTask —— 互斥', () => {
  it('同 key 的第二个任务被拒（防重复点击 / 并发重复触发）', async () => {
    const key = uniq('page');
    const g = gate();
    const id = runTask(key, 'test', async () => { await g.promise; return 'first'; });

    expect(() => runTask(key, 'test', async () => 'second')).toThrow(DuplicateTaskError);

    g.open();
    await tick();
    expect(getTask(id)?.status).toBe('done');
  });

  it('不同 key 可以并行跑', async () => {
    const g = gate();
    const a = uniq('page');
    const b = uniq('page');
    const idA = runTask(a, 'test', async () => { await g.promise; return 'A'; });
    const idB = runTask(b, 'test', async () => { await g.promise; return 'B'; });

    expect(() => runTask(a, 'test', async () => 'dup')).toThrow(DuplicateTaskError);

    g.open();
    await tick();
    expect(getTask(idA)?.status).toBe('done');
    expect(getTask(idB)?.status).toBe('done');
  });

  it('任务失败时 status=error 且带上原因，随后同 key 可以重新发起', async () => {
    const key = uniq('page');
    const id = runTask(key, 'test', async () => { throw new Error('boom'); });
    await tick();

    const t = getTask(id);
    expect(t?.status).toBe('error');
    expect(t?.error).toContain('boom');

    // 失败后 key 应释放，允许重试
    expect(() => runTask(key, 'test', async () => 'retry')).not.toThrow();
  });

  it('成功时 status=done 并把返回值放进 result', async () => {
    const id = runTask(uniq('page'), 'test', async () => ({ panels: [1, 2] }));
    await tick();
    const t = getTask(id);
    expect(t?.status).toBe('done');
    expect(t?.result).toEqual({ panels: [1, 2] });
    expect(t?.progress).toBe(100);
  });
});

describe('setTaskProgress —— 进度上报', () => {
  it('running 期间可以上报，并被夹到 0-100 且取整', async () => {
    const g = gate();
    let id = '';
    id = runTask(uniq('page'), 'test', async () => {
      await g.promise;
      setTaskProgress(id, -40);
      setTaskProgress(id, 999);
      setTaskProgress(id, 42.6);
      // 断言必须在任务体内做：一旦 return，runTask 会把 progress 置 100。
      expect(getTask(id)?.progress).toBe(43);
      expect(getTask(id)?.status).toBe('running');
      return 'ok';
    });
    g.open();
    await tick();
    expect(getTask(id)?.status).toBe('done');
    expect(getTask(id)?.progress).toBe(100);
  });

  it('负数夹到 0、超 100 夹到 100', async () => {
    const g = gate();
    let id = '';
    id = runTask(uniq('page'), 'test', async () => {
      await g.promise;
      setTaskProgress(id, -1);
      expect(getTask(id)?.progress).toBe(0);
      setTaskProgress(id, 1000);
      expect(getTask(id)?.progress).toBe(100);
      return 'ok';
    });
    g.open();
    await tick();
    expect(getTask(id)?.status).toBe('done');
  });

  it('未知 taskId 是 no-op，不抛错', () => {
    expect(() => setTaskProgress('does-not-exist', 50)).not.toThrow();
  });

  it('任务结束后不再接受上报（progress 保持 100）', async () => {
    const id = runTask(uniq('page'), 'test', async () => 'ok');
    await tick();
    setTaskProgress(id, 10);
    expect(getTask(id)?.progress).toBe(100);
  });
});

describe('TTL 清理', () => {
  it('超过 30 分钟后任务被惰性清理掉', async () => {
    vi.useFakeTimers();
    const id = runTask(uniq('page'), 'test', async () => 'ok');
    await vi.advanceTimersByTimeAsync(20);
    expect(getTask(id)).toBeDefined();

    await vi.advanceTimersByTimeAsync(31 * 60 * 1000);
    expect(getTask(id)).toBeUndefined();
    vi.useRealTimers();
  });
});

describe('listTasks —— 不泄露内部 key', () => {
  it('列出的任务不含 key 字段', async () => {
    const id = runTask(uniq('page'), 'test', async () => 'ok');
    await tick();
    const found = listTasks().find(t => t.id === id);
    expect(found).toBeDefined();
    expect(found).not.toHaveProperty('key');
  });
});
