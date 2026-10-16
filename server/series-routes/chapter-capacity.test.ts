/**
 * 「一话该有多少内容」判据的回归测试（2026-10-16）。
 *
 * 病根实测数据：四个话的 summary 分别 104 / 104 / 102 / 101 字，
 * pageCount 全是 3（→18 格容量），而《报到》的 6 格与 summary 的 6 句话
 * 一一对应 —— summary 的信息量只够撑 1 批，剩下 12 格是空批次。
 *
 * 这些测试锁的是那条返工指令会**真的被触发**，
 * 而不是"看起来校验了但实际上永远通过"。
 */
import { describe, it, expect } from 'vitest';
import {
  checkChapterCapacity,
  estimatedPanels,
  panelsForPageCount,
  summaryCoversPageCount,
  CHAPTER_CAPACITY_RULE,
  CHARS_PER_PANEL,
  PANELS_PER_BATCH,
  PANELS_PER_EPISODE_MIN,
  PANELS_PER_EPISODE_MAX,
  BATCHES_PER_EPISODE_MIN,
  BATCHES_PER_EPISODE_MAX,
  feasibleTotalBatches,
  checkChapterDensity,
  DENSITY_WARN_RATIO,
} from './chapter-capacity.js';

describe('容量换算', () => {
  it('pageCount 2 → 12 格；3 → 18 格', () => {
    expect(panelsForPageCount(2)).toBe(12);
    expect(panelsForPageCount(3)).toBe(18);
  });
});

describe('estimatedPanels', () => {
  it('实测的 104 字 summary ≈ 5 拍（够 1 批，不够 2 批）', () => {
    // 104 字 / 每格 20 字 = 5.2 → floor 5
    expect(estimatedPanels('一'.repeat(104))).toBe(5);
  });

  it('空 summary → 0 拍', () => {
    expect(estimatedPanels('')).toBe(0);
    expect(estimatedPanels('   ')).toBe(0);
  });
});

describe('summaryCoversPageCount —— 撑不撑得起它自己声明的格数', () => {
  it('实测的 104 字撑不起 pageCount=3（18 格）', () => {
    // 这就是病根本身：规划说 18 格，summary 只够 5 拍
    expect(summaryCoversPageCount('一'.repeat(104), 3)).toBe(false);
  });

  it('240 字刚好够 pageCount=2（12 格）', () => {
    // 12 格 × 每格 20 字 = 240
    expect(summaryCoversPageCount('一'.repeat(240), 2)).toBe(true);
    expect(summaryCoversPageCount('一'.repeat(239), 2)).toBe(false);
  });

  it('360 字够 pageCount=3（18 格）', () => {
    // 18 格 × 每格 20 字 = 360
    expect(summaryCoversPageCount('一'.repeat(360), 3)).toBe(true);
    expect(summaryCoversPageCount('一'.repeat(359), 3)).toBe(false);
  });
});

describe('checkChapterCapacity —— 返工指令必须具体到可执行', () => {
  it('撑得起 → 通过（返回 null，不拦）', () => {
    expect(checkChapterCapacity('一'.repeat(360), 3)).toBeNull();
  });

  it('撑不起 → 返回返工指令', () => {
    const problem = checkChapterCapacity('一'.repeat(104), 3);
    expect(problem).not.toBeNull();
    expect(problem).toContain('3 批');
    expect(problem).toContain('18 格');
  });

  it('返工指令要给出具体字数目标，不能只说"写长点"', () => {
    const problem = checkChapterCapacity('一'.repeat(104), 3)!;
    // 18 格 × 20 字 = 360
    expect(problem).toContain('360');
  });

  it('返工指令必须同时提戏剧张力与"结尾别收干净"', () => {
    const problem = checkChapterCapacity('一'.repeat(50), 2)!;
    expect(problem).toContain('冲突');
    expect(problem).toContain('未解决');
  });

  it('pageCount=2 也一样拦（不能只拦 3）', () => {
    expect(checkChapterCapacity('一'.repeat(104), 2)).not.toBeNull();
  });
});

describe('CHAPTER_CAPACITY_RULE —— 三个规划入口共用的约束段', () => {
  it('说明了每批 6 格与字数换算（数字从常量推导，不手写）', () => {
    expect(CHAPTER_CAPACITY_RULE).toContain(String(PANELS_PER_BATCH));
    // 这条断言原本硬编码 '120' / '180'，把 prompt 与代码差一倍的 bug 一起锁住了。
    // 现在改成从常量推导：2×6×20=240，3×6×20=360。
    expect(CHAPTER_CAPACITY_RULE).toContain(
      String(BATCHES_PER_EPISODE_MIN * PANELS_PER_BATCH * CHARS_PER_PANEL),
    );
    expect(CHAPTER_CAPACITY_RULE).toContain(
      String(BATCHES_PER_EPISODE_MAX * PANELS_PER_BATCH * CHARS_PER_PANEL),
    );
  });

  it('要求冲突/转折', () => {
    expect(CHAPTER_CAPACITY_RULE).toContain('冲突');
  });

  it('要求结尾留未解决的悬念', () => {
    expect(CHAPTER_CAPACITY_RULE).toContain('未解决');
  });

  it('禁止用重复句子凑字数', () => {
    expect(CHAPTER_CAPACITY_RULE).toContain('禁止');
  });
});

describe('批次区间是推导出来的，不是另拍一个数字', () => {
  it('每话批次数 = 格数区间 ÷ 每批格数', () => {
    expect(BATCHES_PER_EPISODE_MIN).toBe(PANELS_PER_EPISODE_MIN / PANELS_PER_BATCH);
    expect(BATCHES_PER_EPISODE_MAX).toBe(PANELS_PER_EPISODE_MAX / PANELS_PER_BATCH);
    expect(BATCHES_PER_EPISODE_MIN).toBe(2);
    expect(BATCHES_PER_EPISODE_MAX).toBe(3);
  });
});

describe('feasibleTotalBatches —— 总数必须真的可达（2026-10-16 三个自相矛盾的修复）', () => {
  it('4 话要 16 批（话数×4）→ 夹到 12，因为每话最多 3 批', () => {
    // 这就是 generate-chapters 原先的算法：plannedChapterCount * 4，永远达不到
    expect(feasibleTotalBatches(16, 4, 4, 4)).toBe(12);
  });

  it('请求值低于下限时抬到下限', () => {
    expect(feasibleTotalBatches(1, 4, 4, 4)).toBe(8);
  });

  it('请求值高于上限时压到上限', () => {
    expect(feasibleTotalBatches(99, 4, 4, 4)).toBe(12);
  });

  it('落在区间内的值原样保留', () => {
    expect(feasibleTotalBatches(10, 4, 4, 4)).toBe(10);
  });

  it('话数未知时按 1-8 话的全局可达区间夹（兼容旧端点：12 批 + 模型选 8 话不可达）', () => {
    // 8 话最少 16 批 > 12，要求严格等于 12 就是逼模型编或被拒
    expect(feasibleTotalBatches(12, undefined, 1, 8)).toBe(12);
    expect(feasibleTotalBatches(60, undefined, 1, 8)).toBe(24);
    expect(feasibleTotalBatches(0, undefined, 1, 8)).toBe(2);
  });

  it('任何输入的结果都落在该话数真正可达的区间内（不变量，不是逐个 case）', () => {
    for (const n of [1, 2, 3, 5, 8]) {
      for (let req = -5; req <= 80; req++) {
        const got = feasibleTotalBatches(req, n, 1, 8);
        expect(got).toBeGreaterThanOrEqual(n * BATCHES_PER_EPISODE_MIN);
        expect(got).toBeLessThanOrEqual(n * BATCHES_PER_EPISODE_MAX);
      }
    }
  });

  it('话数未知时只受全局区间约束（12 批对 4 话是可达的，不能被当成 1 话压到 3）', () => {
    for (let req = -5; req <= 80; req++) {
      const got = feasibleTotalBatches(req, undefined, 1, 8);
      expect(got).toBeGreaterThanOrEqual(2);
      expect(got).toBeLessThanOrEqual(24);
      // 必须至少存在一种话数能让 pageCount 之和正好等于返回值
      const reachable = [1, 2, 3, 4, 5, 6, 7, 8].some(
        k => k * BATCHES_PER_EPISODE_MIN <= got && got <= k * BATCHES_PER_EPISODE_MAX
      );
      expect(reachable, `${got} 批在 1-8 话下无解`).toBe(true);
    }
  });
});
describe('prompt 里写的字数必须等于代码算出来的（2026-10-16 的 2 倍差）', () => {
  it('rule 里声明的字数下界 = 批次数 × 每批格数 × 每格字数', () => {
    const need2 = BATCHES_PER_EPISODE_MIN * PANELS_PER_BATCH * CHARS_PER_PANEL; // 2×6×20 = 240
    const need3 = BATCHES_PER_EPISODE_MAX * PANELS_PER_BATCH * CHARS_PER_PANEL; // 3×6×20 = 360
    expect(need2).toBe(240);
    expect(need3).toBe(360);
    expect(CHAPTER_CAPACITY_RULE).toContain(`pageCount=${BATCHES_PER_EPISODE_MIN} 需 ≥${need2} 字`);
    expect(CHAPTER_CAPACITY_RULE).toContain(`pageCount=${BATCHES_PER_EPISODE_MAX} 需 ≥${need3} 字`);
  });

  it('不能出现手写的错误数字（120 / 180 是曾经那版差一倍的错值）', () => {
    expect(CHAPTER_CAPACITY_RULE).not.toContain('需 ≥120 字');
    expect(CHAPTER_CAPACITY_RULE).not.toContain('需 ≥180 字');
  });

  it('规则里引用的每格/每批数字与常量一致', () => {
    expect(CHAPTER_CAPACITY_RULE).toContain(`一页 = ${PANELS_PER_BATCH} 格`);
    expect(CHAPTER_CAPACITY_RULE).toContain(`每格 ${CHARS_PER_PANEL} 字估算`);
  });

  it('张力要求包含「主动选择」与「代价」——实跑评估发现只写「冲突」会跑偏成暧昧', () => {
    // 2026-10-16 实跑：453 字版本容量合格，但主角全程被动、没有代价、
    // 冲突写成了办公室暧昧。不把这两条写进 prompt，下一话还会犯。
    expect(CHAPTER_CAPACITY_RULE).toContain('主动的选择或反抗');
    expect(CHAPTER_CAPACITY_RULE).toContain('处在风险里');
    expect(CHAPTER_CAPACITY_RULE).toContain('暧昧');
  });
});
describe('checkChapterDensity —— 只提示不拦截（2026-10-16 实跑四话 23/26/41/33 拍）', () => {
  it('实跑四话里，确实过密的两话能被认出来（需求 18 拍）', () => {
    // 实测：报到469(23拍,1.28×) 加班537(26拍,1.44×) 十一点672(33拍,1.83×) 哈哈830(41拍,2.28×)
    expect(checkChapterDensity('一'.repeat(469), 3)).toBeNull(); // 1.28× —— 写得细，不打扰
    expect(checkChapterDensity('一'.repeat(537), 3)).toBeNull(); // 1.44× —— 同上
    expect(checkChapterDensity('一'.repeat(672), 3)).not.toBeNull(); // 1.83×
    expect(checkChapterDensity('一'.repeat(830), 3)).not.toBeNull(); // 2.28×
  });

  it('正常密度（刚好够）不提示 —— 不能因为写得细就骚扰用户', () => {
    expect(checkChapterDensity('一'.repeat(400), 3)).toBeNull(); // 20 拍 vs 18 需求
  });

  it('阈值是 1.5 倍（照实跑比值定的，不是拍脑袋的 2 倍）', () => {
    expect(DENSITY_WARN_RATIO).toBe(1.5);
    expect(checkChapterDensity('一'.repeat(520), 3)).toBeNull();   // 26 拍 = 1.44×
    expect(checkChapterDensity('一'.repeat(560), 3)).not.toBeNull(); // 28 拍 = 1.56×
  });

  it('超过阈值才提示，且提示里带上具体超出比例', () => {
    const msg = checkChapterDensity('一'.repeat(820), 3);
    expect(msg).not.toBeNull();
    expect(msg).toContain('密度偏高');
    expect(msg).toContain('%');
  });

  it('pageCount=2（12 格）时阈值同步收紧，不能沿用 3 批的口径', () => {
    expect(checkChapterDensity('一'.repeat(400), 2)).not.toBeNull(); // 20 拍 vs 12 需求
  });
});

describe('防套路规则（实跑发现四话全是同一形态）', () => {
  it('规则里要求冲突形态不得重复', () => {
    expect(CHAPTER_CAPACITY_RULE).toContain('冲突形态不能和前面几话重复');
    expect(CHAPTER_CAPACITY_RULE).toContain('套路化的张力不是张力');
  });

  it('规则里要求不要写超容量', () => {
    expect(CHAPTER_CAPACITY_RULE).toContain('内容不要写超');
    expect(CHAPTER_CAPACITY_RULE).toContain('写更多不会更好');
  });
});