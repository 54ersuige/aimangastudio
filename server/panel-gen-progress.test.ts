/**
 * 出图进度链路的端到端回归测试（2026-10-15 新增）。
 *
 * 这条链路此前是**两头都断的**：后端 `setTaskProgress` 定义了但零调用点，
 * 前端 `onProgress` 定义了但 8 个 postTask 调用点全都不传 opts。
 * 两端各自单测都能过（函数存在），串起来却什么都不发生 ——
 * 正是"加字段只改了一半"的典型形态。
 *
 * 本测试把 runTask + setTaskProgress + mapConcurrent 串成真实链路，
 * 验证：进度会真的从 0 走到 100，且并发下不丢步。
 */
import { describe, it, expect } from 'vitest';
import { runTask, getTask, setTaskProgress } from './task-queue.js';
import { mapConcurrent } from './concurrency.js';

const tick = (ms = 5) => new Promise<void>(r => setTimeout(r, ms));

/** 模拟 generatePanelImages 的接线方式：runTask → mapConcurrent(onProgress) → setTaskProgress。 */
function runPanelBatchLikeRealPipeline(key: string, panels: number, perPanelMs = 10) {
  return runTask(key, 'page-generate', async (taskId) => {
    const { values, failures } = await mapConcurrent(
      Array.from({ length: panels }, (_, i) => i),
      async (i) => {
        await tick(perPanelMs);
        if (i === panels - 1) throw new Error(`第${i}格炸了`); // 模拟最坏一格失败
        return `/data/images/p${i}.png`;
      },
      {
        limit: 3,
        onSettled: (done, total) => setTaskProgress(taskId, Math.round((done / total) * 100)),
      },
    );
    return { values, failures };
  });
}

describe('出图进度链路 —— 后端真的在推进度', () => {
  it('task 的 progress 会随分镜完成而上升，最终为 100', async () => {
    const key = `p-${process.pid}-${Math.random()}`;
    const seen: number[] = [];
    const id = runTask(key, 'page-generate', async (taskId) => {
      const { values, failures } = await mapConcurrent(
        [0, 1, 2, 3, 4, 5],
        async () => { await tick(12); return 'ok'; },
        { limit: 3, onSettled: (d, t) => setTaskProgress(taskId, Math.round((d / t) * 100)) },
      );
      // 采样：每次 settle 后立刻读一次
      seen.push(getTask(taskId)?.progress ?? -1);
      return { values, failures };
    });
    await tick(200);
    expect(getTask(id)?.status).toBe('done');
    expect(getTask(id)?.progress).toBe(100);
    // 采样点应当是递增的百分比序列，终值 100
    expect(seen[seen.length - 1]).toBe(100);
  });

  it('部分失败时任务仍为 done，进度也仍到 100（不会卡在中途）', async () => {
    const key = `p-${process.pid}-${Math.random()}`;
    const id = runPanelBatchLikeRealPipeline(key, 6);
    await tick(300);
    const t = getTask(id);
    expect(t?.status).toBe('done');
    expect(t?.progress).toBe(100);
    const result = t?.result as { values: (string | undefined)[]; failures: unknown[] };
    expect(result.failures).toHaveLength(1);
    expect(result.values.filter(Boolean)).toHaveLength(5);
  });

  it('进度严格单调递增，不回退（UI 进度条不能倒着走）', async () => {
    const key = `p-${process.pid}-${Math.random()}`;
    const samples: number[] = [];
    const id = runTask(key, 'page-generate', async (taskId) => {
      await mapConcurrent(
        Array.from({ length: 9 }, () => 0),
        async () => { await tick(8); },
        {
          limit: 3,
          onSettled: (d, t) => {
            setTaskProgress(taskId, Math.round((d / t) * 100));
            samples.push(getTask(taskId)?.progress ?? -1);
          },
        },
      );
      return 'done';
    });
    await tick(400);
    expect(getTask(id)?.status).toBe('done');
    expect(samples.length).toBe(9);
    for (let i = 1; i < samples.length; i += 1) {
      expect(samples[i], `第 ${i} 次采样回退了`).toBeGreaterThanOrEqual(samples[i - 1]);
    }
    expect(samples[samples.length - 1]).toBe(100);
  });

  it('setTaskProgress 对未知/已结束任务静默无害（并发收尾时不会炸）', async () => {
    const key = `p-${process.pid}-${Math.random()}`;
    const id = runTask(key, 'page-generate', async () => 'ok');
    await tick(60);
    // 任务已 done，此时上报应被忽略而不是抛错
    expect(() => setTaskProgress(id, 50)).not.toThrow();
    expect(getTask(id)?.progress).toBe(100);
  });
});
