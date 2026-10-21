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

describe('第五道闸 —— 画面内文字（只拦伪字乱码）', () => {
  it('prompt 区分「伪字乱码」与「真实文字」，并写明什么不算', () => {
    const p = buildSystemInstruction();
    expect(p).toContain('textInImage');
    expect(p).toContain('hasGarbledText');
    expect(p).toContain('hasRealText');
    // 必须显式写「不要报什么」：边框、涂鸦线、模糊的色块都不算字
    expect(p).toMatch(/do NOT report as writing/i);
    // 伪字必须算失败品（这是实测翻车的那一类）
    expect(p).toMatch(/hasGarbledText = TRUE/i);
  });

  it('伪字乱码 → 不通过（触发重画）', () => {
    const g: PanelGateResult = {
      ...okGate,
      textInImage: { hasGarbledText: true, hasRealText: false, reason: '屏幕上有伪汉字', confidence: 0.9 },
    };
    const v = judgePanel(g, { alignmentItems: null });
    expect(v.ok).toBe(false);
    expect(v.reasons.join(' ')).toContain('text');
  });

  it('真实可读文字 → 通过（可能合理 / 剧情需要，不为它重画）', () => {
    // 2026-10-20 用户定的原则：「文字合适或者影响不大、关注度不高不用处理，
    // 要保证效果的前提下，成本合理」。电梯屏上的楼层号「12」不该触发重画。
    const g: PanelGateResult = {
      ...okGate,
      textInImage: { hasGarbledText: false, hasRealText: true, reason: '电梯屏显示 12', confidence: 0.9 },
    };
    expect(judgePanel(g, { alignmentItems: null }).ok).toBe(true);
  });

  it('既有真字又有伪字 → 仍然不通过（伪字是硬伤）', () => {
    const g: PanelGateResult = {
      ...okGate,
      textInImage: { hasGarbledText: true, hasRealText: true, reason: '文件上有假字', confidence: 0.9 },
    };
    expect(judgePanel(g, { alignmentItems: null }).ok).toBe(false);
  });

  it('检查没返回（模型没给/解析失败）→ 视作通过，绝不阻塞出图', () => {
    expect(judgePanel({ ...okGate, textInImage: null }, { alignmentItems: null }).ok).toBe(true);
  });
});
