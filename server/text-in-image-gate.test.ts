/**
 * 第五道闸：画面内可读文字（2026-10-20）。
 *
 * 为什么加这道闸：
 * 此前系统**根本没有**这个检查 —— 只有 prompt 里"叫模型别写字"、
 * 描述清洗（把"印着XX"改成"无字"）、DNA 里一句约束，全是**预防**。
 * 出图真出了字，没人查。
 *
 * 实测翻车现场：2026-10-20 第 3 季《碎纸》有一格，屏幕上出现了
 * 伪汉字「跛剃流搬己治云」—— 漫画里最扎眼的硬伤之一，
 * 而当天的 8 维评审只报了「田经理缺眼镜」，**一格都没报出来**。
 *
 * 这道闸**复用已有的 vision 调用**（不额外花钱），只是多问一句。
 */
import { describe, it, expect } from 'vitest';
import { buildSystemInstruction, judgePanel, type PanelGateResult } from './panel-gate.js';

const okGate: PanelGateResult = {
  limb: null, gender: null, review: null, alignment: null, textInImage: null, cached: false,
};

describe('第五道闸 —— 画面内可读文字', () => {
  it('prompt 里问到了「可读文字/伪汉字」，并写明什么不算', () => {
    const p = buildSystemInstruction();
    expect(p).toContain('textInImage');
    expect(p).toContain('hasReadableText');
    // 必须显式写「不要报什么」：边框、涂鸦线、模糊的色块都不算字
    expect(p).toMatch(/do NOT report as text/i);
    // 伪汉字必须算失败品（这是实测翻车的那一类）
    expect(p).toMatch(/GIBBERISH/i);
  });

  it('画面里有可读文字 → 不通过（触发重画）', () => {
    const g: PanelGateResult = {
      ...okGate,
      textInImage: { hasReadableText: true, reason: '屏幕上有伪汉字', confidence: 0.9 },
    };
    const v = judgePanel(g, { alignmentItems: null });
    expect(v.ok).toBe(false);
    expect(v.reasons.join(' ')).toContain('text');
  });

  it('画面里没有文字 → 通过', () => {
    const g: PanelGateResult = {
      ...okGate,
      textInImage: { hasReadableText: false, reason: '', confidence: 0.9 },
    };
    expect(judgePanel(g, { alignmentItems: null }).ok).toBe(true);
  });

  it('检查没返回（模型没给/解析失败）→ 视作通过，绝不阻塞出图', () => {
    expect(judgePanel({ ...okGate, textInImage: null }, { alignmentItems: null }).ok).toBe(true);
  });
});
