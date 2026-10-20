/**
 * 图文对齐门禁的"大 vs 小"分级（2026-10-20）。
 *
 * 病根实测数据（2026-10-20 一天 178 条出图审计）：
 *   32 条触发重画，逐条看下来**绝大多数是细节级缺失**：
 *     - 「屏幕光映在黑色表带上」「浅色甲油反光」   → 反光/映射
 *     - 「指尖因不自然用力而泛白」「嘴角因冷风微缩」 → 微表情/微状态
 *     - 「白衬衫衣摆在夜风中轻微晃动」            → 衣物动态
 *     - 「键盘方向键微微翘起」「桌角咖啡杯沿凝着油花」→ 微小道具细节
 *     - 「陆远站在柜台左侧」                       → 方位歧义（画面左 vs 人物左）
 *     - 「陆远（7245a507）」                       → 内部 ID 混进要素
 *     - 「临时卡将陆远带入小会议室」                → 剧情句，不是画面要素
 *   画面其实是对的，却每次都整格重画。
 *
 * 旧判据是「呈现率 ≥ 60%」—— 呈现率**分不出大小**：
 * 抽 5 项、画对 4 项（其中 1 项是"缺反光"）照样不达标。
 *
 * 新判据：**只有 critical 缺失才拦**，minor 只记录。
 */
import { describe, it, expect } from 'vitest';
import { evaluateAlignmentResults, buildSystemInstruction } from './panel-gate.js';

describe('图文对齐分级 —— 只有大问题才拦', () => {
  it('合一闸 prompt 要求给出 severity，并写明「什么不算 critical」', () => {
    const p = buildSystemInstruction();
    expect(p).toContain('severity');
    expect(p).toContain('critical');
    expect(p).toContain('minor');
    // 必须显式写「不要报什么」—— 只写「要报什么」时模型会把一切看不懂的都报上来
    expect(p).toMatch(/NOT critical/i);
    expect(p).toMatch(/reflection|highlight/i);
  });

  it('critical 缺失 → 不通过（会重画）', () => {
    const v = evaluateAlignmentResults([
      { text: '画面里应该有那把钥匙', present: false, reason: '没有', severity: 'critical' },
      { text: '桌上有反光', present: false, reason: '没反光', severity: 'minor' },
    ]);
    expect(v.ok).toBe(false);
    expect(v.criticalMissing).toEqual(['画面里应该有那把钥匙']);
    expect(v.reason).toContain('那把钥匙');
  });

  it('只有 minor 缺失 → 通过（不浪费一次重画）', () => {
    const v = evaluateAlignmentResults([
      { text: '陆远站在柜台左侧', present: true, reason: '' },
      { text: '桌上有反光', present: false, reason: '没反光', severity: 'minor' },
      { text: '指尖泛白', present: false, reason: '没泛白', severity: 'minor' },
    ]);
    expect(v.ok).toBe(true);
    expect(v.criticalMissing).toEqual([]);
    expect(v.reason).toBe('');
  });

  it('老数据没有 severity 字段时退回呈现率判据（向后兼容）', () => {
    // 呈现率 2/3 = 67% ≥ 60% → 通过（沿用旧行为）
    const v = evaluateAlignmentResults([
      { text: 'a', present: true, reason: '' },
      { text: 'b', present: true, reason: '' },
      { text: 'c', present: false, reason: '缺' },
    ]);
    expect(v.ok).toBe(true);
  });

  it('老数据严重不达标时仍然拦（0% 呈现率）', () => {
    const v = evaluateAlignmentResults([
      { text: 'a', present: false, reason: '缺' },
      { text: 'b', present: false, reason: '缺' },
    ]);
    expect(v.ok).toBe(false);
  });

  it('有 severity 时只看 critical —— 呈现率再高也不改变结论', () => {
    // 4 项里只有 1 项 critical 缺失、其余都画出来了 → 仍然不通过
    const v = evaluateAlignmentResults([
      { text: 'a', present: true, reason: '' },
      { text: 'b', present: true, reason: '' },
      { text: 'c', present: true, reason: '' },
      { text: '关键道具', present: false, reason: '没有', severity: 'critical' },
    ]);
    expect(v.ok).toBe(false);
    expect(v.criticalMissing).toEqual(['关键道具']);
  });
});
