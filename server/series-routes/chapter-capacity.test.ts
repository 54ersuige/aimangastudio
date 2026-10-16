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
  PANELS_PER_BATCH,
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
  it('说明了每批 6 格与字数换算', () => {
    expect(CHAPTER_CAPACITY_RULE).toContain(String(PANELS_PER_BATCH));
    expect(CHAPTER_CAPACITY_RULE).toContain('120');
    expect(CHAPTER_CAPACITY_RULE).toContain('180');
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
