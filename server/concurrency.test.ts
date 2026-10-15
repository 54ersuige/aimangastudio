/**
 * 有界并发原语的回归测试（2026-10-15 新增）。
 *
 * 这个工具是生图并发改造的地基 —— 它错了，整页出图就会张冠李戴或静默丢格。
 * 所以三条性质都要钉死：并发上限、保序、失败隔离。
 */
import { describe, it, expect } from 'vitest';
import { mapConcurrent } from './concurrency.js';

const tick = (ms = 1) => new Promise<void>(r => setTimeout(r, ms));

describe('mapConcurrent —— 并发上限', () => {
  it('同时在跑的任务数不超过 limit', async () => {
    let active = 0;
    let peak = 0;
    await mapConcurrent(
      Array.from({ length: 12 }, (_, i) => i),
      async () => {
        active += 1;
        peak = Math.max(peak, active);
        await tick(5);
        active -= 1;
      },
      { limit: 3 },
    );
    expect(peak).toBe(3);
  });

  it('limit 为 1 时退化为严格串行（保持历史行为）', async () => {
    let active = 0;
    let peak = 0;
    await mapConcurrent([1, 2, 3, 4], async () => {
      active += 1;
      peak = Math.max(peak, active);
      await tick(3);
      active -= 1;
    }, { limit: 1 });
    expect(peak).toBe(1);
  });

  it('limit 大于总数时不会多开 worker', async () => {
    let peak = 0;
    let active = 0;
    await mapConcurrent([1, 2], async () => {
      active += 1;
      peak = Math.max(peak, active);
      await tick(4);
      active -= 1;
    }, { limit: 99 });
    expect(peak).toBe(2);
  });

  it('非法 limit（0 / 负数 / NaN / undefined）都退化为串行而不是崩溃', async () => {
    for (const limit of [0, -5, NaN, undefined]) {
      let peak = 0;
      let active = 0;
      await mapConcurrent([1, 2, 3], async () => {
        active += 1;
        peak = Math.max(peak, active);
        await tick(3);
        active -= 1;
      }, { limit });
      expect(peak, `limit=${String(limit)} 应串行`).toBe(1);
    }
  });
});

describe('mapConcurrent —— 保序', () => {
  it('结果按输入下标回填，与完成顺序无关', async () => {
    // 让靠后的项先完成，验证不是按"谁先做完谁排前面"
    const items = [50, 5, 30, 1, 20];
    const { values, failures } = await mapConcurrent(
      items,
      async (ms) => { await tick(ms); return ms; },
      { limit: 5 },
    );
    expect(failures).toEqual([]);
    expect(values).toEqual(items);
  });

  it('index 参数与输入下标一致', async () => {
    const seen: number[] = [];
    await mapConcurrent(['a', 'b', 'c'], async (item, index) => {
      seen.push(index);
      return item;
    }, { limit: 1 });
    expect(seen).toEqual([0, 1, 2]);
  });

  it('总耗时不显著超过理论下限（证明确实在并行）', async () => {
    const t0 = Date.now();
    await mapConcurrent(Array.from({ length: 9 }, () => 0), async () => { await tick(50); }, { limit: 3 });
    const elapsed = Date.now() - t0;
    // 串行约 450ms；并发 3 应在 150ms 上下。放宽到 400ms 以容忍 CI 抖动。
    expect(elapsed).toBeLessThan(400);
  });
});

describe('mapConcurrent —— 失败隔离', () => {
  it('单项失败不影响其他项，失败项在 values 中为 undefined', async () => {
    const { values, failures } = await mapConcurrent(
      [1, 2, 3, 4],
      async (n) => {
        if (n === 2 || n === 4) throw new Error(`fail-${n}`);
        return n * 10;
      },
      { limit: 2 },
    );
    expect(values).toEqual([10, undefined, 30, undefined]);
    expect(failures.map(f => f.index).sort()).toEqual([1, 3]);
    expect((failures[0].error as Error).message).toMatch(/^fail-/);
  });

  it('全部失败时不 reject，由 failures 表达', async () => {
    const { values, failures } = await mapConcurrent([1, 2, 3], async () => {
      throw new Error('boom');
    }, { limit: 3 });
    expect(values).toEqual([undefined, undefined, undefined]);
    expect(failures).toHaveLength(3);
  });

  it('空数组直接返回空结果', async () => {
    const { values, failures } = await mapConcurrent([], async () => 1, { limit: 3 });
    expect(values).toEqual([]);
    expect(failures).toEqual([]);
  });
});

describe('mapConcurrent —— 进度回调', () => {
  it('onSettled 每完成一项调用一次，(done,total) 严格递增且终为 total', async () => {
    const calls: Array<[number, number]> = [];
    await mapConcurrent(
      Array.from({ length: 7 }, (_, i) => i),
      async () => { await tick(3); },
      { limit: 3, onSettled: (d, t) => calls.push([d, t]) },
    );
    expect(calls).toHaveLength(7);
    expect(calls.every(c => c[1] === 7)).toBe(true);
    expect(calls.map(c => c[0])).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('失败项也会触发 onSettled（进度必须走完全程，否则前端会永远停在中途）', async () => {
    const calls: number[] = [];
    await mapConcurrent(
      [1, 2, 3, 4],
      async (n) => { if (n % 2 === 0) throw new Error('x'); return n; },
      { limit: 2, onSettled: (d) => calls.push(d) },
    );
    expect(calls.sort()).toEqual([1, 2, 3, 4]);
  });
});
