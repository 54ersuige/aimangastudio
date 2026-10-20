/**
 * 角色 ID 泄漏与性别锚点的回归测试（2026-10-20）。
 *
 * 事故现场（一整条因果链）：
 *  1. 拆解 prompt 的角色库只给「id + 名字 + 定位 + 40 字简介」，
 *     **一个性别字都没有** → 模型不知道田经理是男是女，写了「她站在陆远工位」；
 *  2. 模型只能靠 id 认人 → 把 id 照抄进 description（「田经理（27ce402a）」）；
 *  3. 出图时 i2i 参考图因 503 不可用 → 只能靠描述文字 →
 *     英文的 F/M token 压不住中文的「她」→ male 的田经理被画成了女性。
 *
 * 这条测试锁住「描述里不能出现角色 ID」这条底线。
 */
import { describe, it, expect } from 'vitest';
import { stripCharacterIds } from './prompts.js';

describe('stripCharacterIds —— 描述里不能有角色 ID', () => {
  it('去掉括号里的 id 及其附带的短说明', () => {
    const s = '田经理（27ce402a，深藏青西装三件套）手持一份文件，从左侧闯入画面。';
    const out = stripCharacterIds(s);
    expect(out).not.toContain('27ce402a');
    expect(out).toContain('田经理');
    expect(out).toContain('手持一份文件');
  });

  it('去掉裸 id', () => {
    const out = stripCharacterIds('陆远 7245a507-1111-2222-3333-444444444444 站在窗前。');
    expect(out).not.toContain('7245a507');
    expect(out).toContain('陆远');
  });

  it('完整 uuid 形式的裸 id 也去掉', () => {
    const out = stripCharacterIds('田经理 4581d1af-e2b3-4c5d-8e9f-0a1b2c3d4e5f 站在左侧');
    expect(out).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
  });

  it('不动正常文字（不能误伤）', () => {
    const s = '清晨，陆远（7245a507 不是）站在工位前，手里拿着一份未核实的报告。';
    const out = stripCharacterIds(s);
    expect(out).toContain('站在工位前');
    expect(out).toContain('未核实的报告');
  });

  it('长度不足 8 位的十六进制串不删（可能是正常编号）', () => {
    const s = '第 3 批第 2 格，工位 12 号。';
    expect(stripCharacterIds(s)).toBe(s);
  });

  it('空串安全', () => {
    expect(stripCharacterIds('')).toBe('');
  });
});
