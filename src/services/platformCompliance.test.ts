/**
 * 公众号合规检查回归测试（2026-10-15 新增）。
 *
 * 最重要的一条是 author 未署名时的行为 —— 原代码直接 draft.author.trim()，
 * 而 ArticleDraft.author 是可选字段，未署名会在打开合规面板时抛 TypeError
 * 并连带整个面板崩掉。这里锁死"不崩 + 给出 warning 提示"两个断言。
 */
import { describe, it, expect } from 'vitest';
import { analyzeCompliance } from './platformCompliance.js';
import type { ArticleDraft } from '../types';

const draft = (over: Partial<ArticleDraft> = {}): ArticleDraft => ({
  id: 'd1',
  title: '加班兽',
  subtitle: '一个关于职场生存的短篇漫画，讲清楚了道理。',
  template: 'magazine',
  typography: {
    accent: '#B03A2E',
    bodySize: 16,
    lineHeight: 1.8,
    paragraphSpacing: 1,
    titleFamily: 'serif',
    endMark: true,
  },
  blocks: [
    { kind: 'heading', level: 2, text: '开始' },
    { kind: 'paragraph', text: '正文内容，这段话刻意避开了所有内置风险词。' },
  ],
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

const authorCheck = (d: ArticleDraft) =>
  analyzeCompliance(d).checks.find(c => c.label === '原创声明');

describe('analyzeCompliance —— 作者未署名不能崩', () => {
  it('author 为 undefined 时正常返回报告，不抛异常', () => {
    const r = analyzeCompliance(draft({ author: undefined }));
    expect(r).toBeDefined();
    expect(Array.isArray(r.checks)).toBe(true);
  });

  it('author 为 undefined 时给出"未填写作者"的 warning 与对应建议', () => {
    const r = analyzeCompliance(draft({ author: undefined }));
    expect(authorCheck(draft({ author: undefined }))?.level).toBe('warning');
    expect(authorCheck(draft({ author: undefined }))?.detail).toContain('未填写作者');
    expect(r.issues.join()).toContain('原创');
  });

  it('author 为纯空格时与 undefined 行为一致', () => {
    expect(authorCheck(draft({ author: '   ' }))?.level).toBe('warning');
  });

  it('author 已填写时判为 good 且显示 trim 后的署名', () => {
    const c = authorCheck(draft({ author: '  子瑜 ' }));
    expect(c?.level).toBe('good');
    expect(c?.detail).toContain('子瑜');
    // 不应把首尾空格带进展示
    expect(c?.detail).not.toContain('  ');
  });
});

describe('analyzeCompliance —— 其他检查不回归', () => {
  it('正文不含风险词时该项满分', () => {
    const risky = analyzeCompliance(draft()).checks.find(c => c.label === '高风险词');
    expect(risky?.level).toBe('good');
    expect(risky?.score).toBe(risky?.maxScore);
  });

  it('正文命中风险词时降级为 warning 并列出命中词', () => {
    const r = analyzeCompliance(draft({
      blocks: [{ kind: 'paragraph', text: '这是全网最低价，100% 有效。' }],
    }));
    const risky = r.checks.find(c => c.label === '高风险词');
    expect(risky?.level).toBe('warning');
    expect(risky?.detail).toMatch(/命中/);
  });

  it('分数被夹在 0-100 之间', () => {
    const r = analyzeCompliance(draft());
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
  });

  it('导语长度决定该项评分：30-80 字为 good', () => {
    const long = '一二三四五六七八九十'.repeat(4); // 40 字
    expect(analyzeCompliance(draft({ subtitle: long })).checks
      .find(c => c.label === '导语 / 摘要')?.level).toBe('good');

    expect(analyzeCompliance(draft({ subtitle: '' })).checks
      .find(c => c.label === '导语 / 摘要')?.level).toBe('warning');
  });
});
