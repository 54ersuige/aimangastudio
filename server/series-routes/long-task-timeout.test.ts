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
const { isRetryableTransportError } = await import('./helpers.js');

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

  it('⚠️ 必须有心跳：只在尝试开始时报一次 = 进度条死守 0% 三分钟', () => {
    // 这是 2026-10-19 实跑暴露的：一次尝试 60~120 秒，
    // 而 onProgress 只在尝试**开始时**回调 → 前三分钟进度恒为 0。
    // 「0% 停了 3 分钟」和「没反应」观感没区别，
    // 用户正是因此以为卡死、重启了服务，把正在跑的任务一起杀掉。
    const n = (SRC.match(/heartbeat: \{ from:/g) || []).length;
    expect(n, '三个端点都要启用心跳').toBe(3);
    expect(SRC).toContain('onHeartbeatStart:');
  });

  it('心跳区间不能撞到终点（真正完成由外层显式覆盖）', () => {
    // to=49 而不是 100：心���只负责"看起来在动"，不越权宣告完成。
    const to = SRC.match(/heartbeat: \{ from: \d+, to: (\d+)/g) || [];
    for (const t of to) {
      expect(t).toMatch(/to: (49|[1-9]\d)/);
      expect(t).not.toMatch(/to: 100/);
    }
  });

  it('心跳定时器必须在每次尝试结束时停掉，不能悬挂', () => {
    const HELPERS2 = readFileSync(join(HERE, 'helpers.ts'), 'utf-8');
    // generateText 用 try/catch/finally 包住 —— 成功、重试、抛出三条路径都会停
    expect(HELPERS2).toMatch(/await provider\.generateText\(attemptConfig, req\);[\s\S]{0,900}finally\s*\{\s*\/\/ 这一次尝试结束了[\s\S]{0,120}stopHb\(\)/);
    // 循环外再兜底一次，防止 return/throw 漏掉
    expect(HELPERS2).toMatch(/\}\s*\n\s*\}\s*finally\s*\{\s*\/\/ 兜底[\s\S]{0,160}stopHb\(\)/);
  });
});

describe('传输层失败必须重试（2026-10-19 实测 fetch failed）', () => {
  const retryable = [
    'fetch failed',
    'Minimax API error: fetch failed',
    'read ECONNRESET',
    'socket hang up',
    '请求超时（480s 内未返回）',
    'API error 503: service unavailable',
  ];
  for (const m of retryable) {
    it(`「${m}」应重试`, () => {
      expect(isRetryableTransportError(m)).toBe(true);
    });
  }

  const notRetryable = [
    'Minimax API error 429: 已达到 Token Plan 用量上限',
    'API error 429: rate_limit_error',
    'API error 401: Invalid API key',
    'API error 400: invalid parameter',
    '余额不足',
  ];
  for (const m of notRetryable) {
    it(`「${m.slice(0, 32)}…」不应重试`, () => {
      expect(isRetryableTransportError(m)).toBe(false);
    });
  }

  it('⚠️ 429 文案里混着 fetch 描述时仍判为不可重试', () => {
    // 真实报错长这样：429 的 message 后面跟着 provider 包装的连接信息。
    // 判断顺序放错就会把它误判成可重试 → 用户多等一个超时周期才发现没救。
    const real = 'fetch failed: Minimax API error 429 rate_limit_error 用量上限';
    expect(isRetryableTransportError(real)).toBe(false);
  });

  it('重试分支确实接进了 generateText 的 catch', () => {
    expect(HELPERS).toContain('isRetryableTransportError(msg)');
    expect(HELPERS).toMatch(/catch\s*\(e:\s*any\)\s*\{[\s\S]{0,200}stopHb\(\)/);
  });
});
