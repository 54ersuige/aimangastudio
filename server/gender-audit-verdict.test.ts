/**
 * 性别审计判据的回归测试（2026-10-20）。
 *
 * 病根实测数据（2026-10-20 一天 178 条出图审计）：
 *   25 条判「性别不符」，**全部**是这个模式：
 *     expected=male,  observed=[male, female]     ← 主角(男) + 一个女配角
 *     expected=female, observed=[female, male]     ← 主角(女) + 一个男配角
 *   主角性别**每次都在场**，图是对的。
 *   后果：每条都触发整格重画 → 一天白烧 14 次重画（13 次纯 gender 误报）。
 *
 * 这条测试锁住新判据：**主角在场即通过**。
 */
import { describe, it, expect } from 'vitest';
import { evaluateGenderObserved } from './limb-guard.js';

describe('evaluateGenderObserved —— 主角在场即通过', () => {
  it('主角(男) + 女配角 → 通过（这是 2026-10-20 实测的 25 条误报形态）', () => {
    const v = evaluateGenderObserved(['male', 'female'], 'male');
    expect(v.mismatch).toBe(false);
    expect(v.mismatchIndices).toEqual([]);
    expect(v.reason).toBe('');
  });

  it('主角(女) + 男配角 → 通过', () => {
    expect(evaluateGenderObserved(['female', 'male'], 'female').mismatch).toBe(false);
  });

  it('画面里三个人的情况（男+女+男）→ 通过', () => {
    expect(evaluateGenderObserved(['male', 'female', 'male'], 'male').mismatch).toBe(false);
    expect(evaluateGenderObserved(['female', 'male', 'male'], 'male').mismatch).toBe(false);
  });

  it('只有配角、主角真被画成女性（画面里全是 female）→ 不通过', () => {
    // 这才是真正的性别错误：画面里一个男性都没有，主角肯定被画错了
    const v = evaluateGenderObserved(['female'], 'male');
    expect(v.mismatch).toBe(true);
    expect(v.mismatchIndices).toEqual([0]);
    expect(v.reason).toContain('male');
  });

  it('主角被画成女性 + 还有个女配角（全是 female）→ 仍然不通过', () => {
    const v = evaluateGenderObserved(['female', 'female'], 'male');
    expect(v.mismatch).toBe(true);
  });

  it('全是 ambiguous（判不出性别）→ 不判不通过（fail-open，不折腾用户）', () => {
    const v = evaluateGenderObserved(['ambiguous'], 'male');
    expect(v.mismatch).toBe(false);
  });

  it('空画面（没有人物）→ 不判不通过', () => {
    expect(evaluateGenderObserved([], 'male').mismatch).toBe(false);
  });

  it('expected=ambiguous 时，ambiguous 在场即通过', () => {
    expect(evaluateGenderObserved(['ambiguous'], 'ambiguous').mismatch).toBe(false);
  });

  it('错的人不再被报成「图中有 N 个人物性别不符」', () => {
    // 旧文案会把"配角性别不同"说成"有人性别不符"，误导排查方向
    const v = evaluateGenderObserved(['female'], 'male');
    expect(v.reason).not.toContain('个人物性别与预期不符');
    expect(v.reason).toContain('未出现预期性别');
  });
});
