/**
 * 四闸合一回归测试（2026-10-15）。
 *
 * 覆盖两条"静默出错代价最大"的路径：
 *  1. **缓存键** —— 键算错一次，就会把上一张图的评审结论套到这一张图上，
 *     用户看到"审核通过了"但实际没审。缓存键少算一项 = 静默返回错误结论。
 *  2. **判定规则** —— 阈值一改就可能白花钱重画，或放过该重画的图。
 *     规则从拆分版搬到 judgePanel，必须测住"没变"。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildGateKey,
  clearGateCache,
  judgePanel,
  needsLimbRepair,
  gateToAuditFields,
  LIMB_CONFIDENCE_FLOOR,
  type PanelGateResult,
} from './panel-gate.js';
import type { LimbAudit } from './limb-guard.js';
import type { PanelReview, DimensionKey } from './audit/comic-reviewer.js';

const IMG_A = 'data:image/png;base64,AAAA';
const IMG_B = 'data:image/png;base64,BBBB';
const REF_A = 'data:image/png;base64,RRRR';
const REF_B = 'data:image/png;base64,SSSS';

function baseInput(overrides: Partial<Parameters<typeof buildGateKey>[0]> = {}) {
  return {
    imageDataUrl: IMG_A,
    sceneDescription: '雨夜便利店',
    panelDescription: '林澈站在柜台后',
    characterSummaries: ['林澈（male，young_adult）：灰色卫衣'],
    referenceImages: [REF_A],
    worldview: 'new-yorker-noir · 冷',
    expectedGender: 'male' as const,
    alignmentItems: ['柜台上的空咖啡杯'],
    focusDimensions: null,
    previousReview: null,
    ...overrides,
  };
}

beforeEach(() => clearGateCache());

describe('buildGateKey', () => {
  it('同输入 → 同键', () => {
    expect(buildGateKey(baseInput())).toBe(buildGateKey(baseInput()));
  });

  it('换图 → 换键（否则会把 A 图的评审套到 B 图上）', () => {
    expect(buildGateKey(baseInput())).not.toBe(buildGateKey(baseInput({ imageDataUrl: IMG_B })));
  });

  it('换参考图 → 换键（D1/D6 是拿参考图比对出来的）', () => {
    expect(buildGateKey(baseInput())).not.toBe(
      buildGateKey(baseInput({ referenceImages: [REF_B] })),
    );
  });

  it('换对齐清单 → 换键', () => {
    expect(buildGateKey(baseInput())).not.toBe(
      buildGateKey(baseInput({ alignmentItems: ['空调口被吹起的纸角'] })),
    );
  });

  it('换期望性别 → 换键', () => {
    expect(buildGateKey(baseInput())).not.toBe(
      buildGateKey(baseInput({ expectedGender: 'female' })),
    );
  });

  it('换分镜描述 → 换键', () => {
    expect(buildGateKey(baseInput())).not.toBe(
      buildGateKey(baseInput({ panelDescription: '林澈坐在窗边' })),
    );
  });

  it('全量模式 vs 定向复审 → 换键（prompt 不同，结论不可互借）', () => {
    expect(buildGateKey(baseInput({ focusDimensions: null }))).not.toBe(
      buildGateKey(baseInput({ focusDimensions: ['D1_character_consistency'] })),
    );
  });

  it('previousReview 变化不换键 —— 它只决定"没复核的维度填什么"，不影响本次该问什么', () => {
    const prev = { dimensions: { D1_character_consistency: { score: 3, reason: 'x' } } } as unknown as PanelReview;
    expect(buildGateKey(baseInput({ focusDimensions: ['D1_character_consistency'] }))).toBe(
      buildGateKey(baseInput({ focusDimensions: ['D1_character_consistency'], previousReview: prev })),
    );
  });
});

describe('judgePanel —— 判定规则与拆分版一致', () => {
  const okGate: PanelGateResult = { limb: null, gender: null, review: null, alignment: null, cached: false };

  function limbAudit(patch: Partial<LimbAudit> = {}): LimbAudit {
    return {
      people: 1, hands: 2, arms: 2,
      abnormal: true, reason: '左手多出一根手指',
      regions: [{ x: 0.3, y: 0.5, w: 0.1, h: 0.1, label: 'hand' }],
      confidence: 0.9,
      ...patch,
    };
  }

  function review(overall: number): PanelReview {
    const dims: Record<string, { score: number; reason: string }> = {};
    for (const k of [
      'D1_character_consistency', 'D2_cinematography', 'D3_composition', 'D4_style_consistency',
      'D5_expression_emotion', 'D6_outfit_consistency', 'D7_scene_continuity', 'D8_visual_pacing',
    ] as DimensionKey[]) dims[k] = { score: overall / 10, reason: '' };
    return { dimensions: dims as any, overall, topIssue: '构图松散', verdict: 'revise', confidence: 0.8 };
  }

  it('四闸全 null → 通过（fail-open）', () => {
    expect(judgePanel(okGate, { alignmentItems: null }).ok).toBe(true);
  });

  it('limb 异常且置信度达标 → 不通过', () => {
    const g = { ...okGate, limb: limbAudit() };
    const v = judgePanel(g, { alignmentItems: null });
    expect(v.ok).toBe(false);
    expect(v.reasons.join()).toMatch(/limb/);
  });

  it(`limb 置信度 ${LIMB_CONFIDENCE_FLOOR} 以下 → 视作通过（低置信度误报会白丢一张好图）`, () => {
    const g = { ...okGate, limb: limbAudit({ confidence: LIMB_CONFIDENCE_FLOOR - 0.01 }) };
    expect(judgePanel(g, { alignmentItems: null }).ok).toBe(true);
  });

  it('gender mismatch → 不通过', () => {
    const g = {
      ...okGate,
      gender: {
        observedGenders: ['female'] as const,
        expectedGender: 'male' as const,
        mismatch: true, mismatchIndices: [0],
        reason: '图中有 1 个人物性别与预期不符（预期 male）',
        confidence: 0.9,
      },
    } as unknown as PanelGateResult;
    expect(judgePanel(g, { alignmentItems: null }).ok).toBe(false);
  });

  it('review overall 70 → 通过 / 69 → 不通过（REGENERATE_THRESHOLD=70 未被改动）', () => {
    expect(judgePanel({ ...okGate, review: review(70) }, { alignmentItems: null }).ok).toBe(true);
    expect(judgePanel({ ...okGate, review: review(69) }, { alignmentItems: null }).ok).toBe(false);
  });

  it('alignment 缺一项 → 不通过；无清单时 alignment 判定被跳过', () => {
    const missingGate = {
      ...okGate,
      alignment: { ok: false, items: ['a', 'b'], missing: ['b'], reason: '缺：b', confidence: 0.5 },
    } as PanelGateResult;
    expect(judgePanel(missingGate, { alignmentItems: ['a', 'b'] }).ok).toBe(false);
    // 没有清单 → alignment 不参与判定（否则会拿一个必然为空的 mismatch 卡住出图）
    expect(judgePanel(missingGate, { alignmentItems: null }).ok).toBe(true);
  });

  it('不通过时所有原因都列出来（审计与修正 prompt 靠它）', () => {
    const g: PanelGateResult = {
      ...okGate,
      limb: limbAudit(),
      review: review(50),
      alignment: { ok: false, items: ['a'], missing: ['a'], reason: '缺：a', confidence: 0.3 },
    };
    const v = judgePanel(g, { alignmentItems: ['a'] });
    expect(v.ok).toBe(false);
    expect(v.reasons).toHaveLength(3);
    expect(v.reasons.join('；')).toMatch(/limb.*review.*alignment/);
  });
});

describe('needsLimbRepair', () => {
  const okGate: PanelGateResult = { limb: null, gender: null, review: null, alignment: null, cached: false };
  const withRegions: LimbAudit = {
    people: 1, hands: 2, arms: 2, abnormal: true, reason: '多一条手臂',
    regions: [{ x: 0.4, y: 0.4, w: 0.1, h: 0.1, label: 'arm' }],
    confidence: 0.9,
  };

  it('异常 + 有 bbox → 触发 inpaint', () => {
    expect(needsLimbRepair({ ...okGate, limb: withRegions })).not.toBeNull();
  });

  it('异常但没有 bbox → 不触发（局部修补无从下手，整张重画更划算）', () => {
    expect(needsLimbRepair({ ...okGate, limb: { ...withRegions, regions: [] } })).toBeNull();
  });

  it('低置信度异常 → 不触发', () => {
    expect(needsLimbRepair({ ...okGate, limb: { ...withRegions, confidence: 0.4 } })).toBeNull();
  });

  it('正常 → 不触发', () => {
    expect(needsLimbRepair({ ...okGate, limb: { ...withRegions, abnormal: false } })).toBeNull();
  });
});

describe('gateToAuditFields —— 审计字段必须每轮全覆盖', () => {
  const empty: PanelGateResult = { limb: null, gender: null, review: null, alignment: null, cached: false };

  const dirtyGate: PanelGateResult = {
    ...empty,
    limb: { people: 1, hands: 3, arms: 3, abnormal: true, reason: '多一条手臂', regions: [], confidence: 0.9 },
    gender: {
      observedGenders: ['female'], expectedGender: 'male',
      mismatch: true, mismatchIndices: [0], reason: '性别与预期不符', confidence: 0.9,
    },
    review: {
      dimensions: {} as any, overall: 55, topIssue: '人物走形',
      verdict: 'reject', confidence: 0.8,
    },
    alignment: { ok: false, items: ['a'], missing: ['a'], reason: '缺：a', confidence: 0.4 },
  };

  it('四闸全 null → 四个字段全 null', () => {
    const f = gateToAuditFields(empty, null);
    expect(f.limbGuard).toBeNull();
    expect(f.genderAudit).toBeNull();
    expect(f.review).toBeNull();
    expect(f.alignmentAudit).toBeNull();
  });

  it('有结果 → 原样翻译', () => {
    const f = gateToAuditFields(dirtyGate, ['a']);
    expect(f.limbGuard?.abnormal).toBe(true);
    expect(f.genderAudit?.mismatch).toBe(true);
    expect(f.genderAudit?.expected).toBe('male');
    expect(f.review?.overall).toBe(55);
    expect(f.alignmentAudit?.missing).toEqual(['a']);
  });

  it('第二轮闸只回了一半 → 前半段必须被清空，不能残留上一轮的结论', () => {
    // 这就是本次修的真 bug：原先写成 `if (gate.gender) genderAudit = ...`，
    // 第 1 轮判定"性别不符"、第 2 轮图已修好但闸没回 gender 块，
    // 于是审计把"性别不符"记在了那张其实没问题的图上。
    const halfGate: PanelGateResult = { ...empty, review: dirtyGate.review };
    const f = gateToAuditFields(halfGate, null);
    expect(f.genderAudit).toBeNull();
    expect(f.limbGuard).toBeNull();
    expect(f.alignmentAudit).toBeNull();
    expect(f.review?.overall).toBe(55);
  });

  it('同一函数连续两次调用互不影响（纯函数，没有隐式残留）', () => {
    const first = gateToAuditFields(dirtyGate, ['a']);
    const second = gateToAuditFields(empty, null);
    expect(first.genderAudit?.mismatch).toBe(true);
    expect(second.genderAudit).toBeNull();
  });

  it('inpaint 修补失败的诊断信息并进 limb reason', () => {
    const f = gateToAuditFields(dirtyGate, null, 'inpaint 失败退回原图');
    expect(f.limbGuard?.reason).toContain('多一条手臂');
    expect(f.limbGuard?.reason).toContain('inpaint 失败退回原图');
  });

  it('alignment 的 items 优先取本轮抽取的清单', () => {
    const f = gateToAuditFields(dirtyGate, ['桌角', '纸角']);
    expect(f.alignmentAudit?.items).toEqual(['桌角', '纸角']);
  });
});
