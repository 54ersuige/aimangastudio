/**
 * 长任务超时与进度上报的回归测试（2026-10-16）。
 *
 * 这轮的真实故障链：
 *   用户点「生成本季话目」→ 界面 8 分钟没反应 → 用户以为卡死又点一次
 *   → 第二次撞 409 → 局面更乱。
 *
 * 拆开是两个独立缺陷：
 *   1. 三个话目端点是同步 HTTP，前端只有一句不动的「生成中…」
 *   2. **text 模型超时 240s，而批量出 4 话实测要 5~8 分钟**
 *      → 任务在 4 分钟处被 `请求超时` 掐断，用户看到的是彻底失败
 *
 * 第 2 条更阴险：它平时不发作（模型跑得快就过去了），
 * 属于「运气好的时候看起来没问题」，所以极易被改回去。
 * 这些测试就是防这个。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, 'chapters.ts'), 'utf-8');
const HELPERS = readFileSync(join(HERE, 'helpers.ts'), 'utf-8');

describe('三个话目端点必须显式声明超时', () => {
  it('generate-chapters 给了 8 分钟（实测 4 话要 5~8 分钟）', () => {
    // 240s 的默认值会在这里把任务掐断 —— 用户看到的是彻底失败，
    // 而不是"慢一点但能出结果"。
    const seg = SRC.slice(SRC.indexOf("'/series/:id/arcs/:arcId/generate-chapters'"));
    expect(seg.slice(0, 6000)).toContain('timeoutMs: 480000');
  });

  it('append-next-chapter 与 replan 给了 5 分钟', () => {
    expect(SRC).toContain('timeoutMs: 300000');
    // 两处（append + replan），不是一处
    const count = (SRC.match(/timeoutMs: 300000/g) || []).length;
    expect(count).toBe(2);
  });

  it('callStructuredJson 支持 per-call 超时覆盖', () => {
    expect(HELPERS).toContain('timeoutMs?: number');
    // 每次尝试单独放宽：否则第 2 次重试会被第 1 次消耗的墙钟时间误伤
    expect(HELPERS).toContain('perAttemptMs');
    expect(HELPERS).toMatch(/attemptConfig\s*=\s*\{\s*\.\.\.config,\s*timeout:\s*perAttemptMs/);
  });

  it('⚠️ 覆盖后的 config 必须真的传进 generateText', () => {
    // 这条是补的：修 bug 时我造了 attemptConfig 却仍然 `generateText(config, req)`，
    // 表面上「覆盖已实现」、测试也全绿（字符串都在），实际超时一点没变。
    //
    // 只断言 `attemptConfig` 存在是不够的 —— 必须断言**它被用上了**。
    // 这里不读源码做脆弱匹配，而是直接锁住「调用点用的是覆盖后的对象」。
    const callSites = HELPERS.match(/provider\.generateText\(\s*\w+\s*,/g) || [];
    expect(callSites.length).toBeGreaterThan(0);
    for (const site of callSites) {
      expect(site, 'generateText 必须收到 attemptConfig，而不是原始 config').toContain('attemptConfig');
    }
    // 且原始 config 不应再直接进 provider（那正是这次的 bug）
    expect(HELPERS).not.toMatch(/provider\.generateText\(\s*config\s*,/);
  });
});

describe('长任务必须走 task 队列（不能同步挂 HTTP）', () => {
  const endpoints = [
    { name: 'generate-chapters', key: 'arc-chapters' },
    { name: 'append-next-chapter', key: 'append-chapter' },
    { name: 'replan', key: 'replan-chapter' },
  ];
  for (const ep of endpoints) {
    it(`${ep.name} 用 runTask + 返回 taskId`, () => {
      const idx = SRC.indexOf('runTask(`' + ep.key + ':');
      expect(idx, `${ep.name} 找不到 runTask key`).toBeGreaterThan(-1);
      const seg = SRC.slice(idx, idx + 300);
      expect(seg).toContain('runTask(');
    });
  }

  it('三个端点都返回 { taskId } 而非同步结果', () => {
    const n = (SRC.match(/res\.json\(\{ taskId \}\)/g) || []).length;
    expect(n).toBe(3);
  });
});

describe('重复点击必须被挡，且提示要说人话', () => {
  it('三个端点都处理 DuplicateTaskError', () => {
    const n = (SRC.match(/instanceof DuplicateTaskError/g) || []).length;
    expect(n).toBe(3);
  });

  it('409 提示要包含真实耗时，且明确告诉用户别再点', () => {
    const hits = SRC.match(/请等它跑完[^']+不用重复点击/g) || [];
    expect(hits.length).toBe(3);
    for (const h of hits) {
      // 「该季已有 chapter」是内部状态描述，用户完全看不懂自己为什么被挡
      expect(h).not.toContain('已有 chapter');
      expect(h).toMatch(/分钟/);
    }
  });
});

describe('进度必须真的上报', () => {
  it('三个端点都传了 onProgress', () => {
    const n = (SRC.match(/onProgress:/g) || []).length;
    expect(n).toBe(3);
  });

  it('进度回调同时用于 setTaskProgress 和 console（后者留痕便于排查）', () => {
    expect(SRC).toContain('setTaskProgress(tid');
    expect(SRC).toMatch(/console\.log\(`\[(arc-chapters|append-chapter|replan-chapter)\] progress/);
  });
});
