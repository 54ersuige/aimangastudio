/**
 * 契约层回归测试（2026-10-15 新增）。
 *
 * 锁住三件容易被"顺手重构"掉的行为：
 *  1. description 太短是 **repairable 而非 fatal** —— 2026-09-18 的改动。
 *     这条一旦被改回 fatal，LLM 写 50~58 字就会整页卡死（就是线上真实发生过的事故）。
 *  2. `repairable` 的聚合语义：混入任一 fatal 就必须整体不可修复。
 *  3. 出场角色字段不全 → fatal（这条是角色跨页一致性的闸门，不能被放宽）。
 */
import { describe, it, expect } from 'vitest';
import { validatePanel, validateCharacter, auditCharacter } from './validate.js';
import type { SeriesCharacter, Panel } from '../../shared/types.js';

const okChar = (over: Partial<SeriesCharacter> = {}): SeriesCharacter => ({
  id: 'c1',
  name: '林屿',
  role: 'protagonist',
  description: '一个角色',
  appearance: '偏硬的下颌线',
  gender: 'male',
  ageBand: 'young_adult',
  outfit: '灰色连帽卫衣',
  visualAnchors: ['左眼下痣', '银色项链'],
  ...over,
} as SeriesCharacter);

const panel = (over: Partial<Panel> = {}): Panel => ({
  index: 0,
  description: '长'.repeat(60),
  characterIds: [],
  ...over,
} as Panel);

const charMap = (...cs: SeriesCharacter[]) => new Map(cs.map(c => [c.id, c]));

describe('validateCharacter —— 角色必填闸门', () => {
  it('字段齐全时通过', () => {
    expect(validateCharacter(okChar()).ok).toBe(true);
  });

  it('缺 gender / ageBand / outfit / visualAnchors 各自报错', () => {
    const r = validateCharacter({ name: 'X', description: 'd', appearance: 'a' });
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toMatch(/gender/);
    expect(r.errors.join()).toMatch(/ageBand/);
    expect(r.errors.join()).toMatch(/outfit/);
    expect(r.errors.join()).toMatch(/visualAnchors/);
  });

  it('outfit 只有 3 个字也算不合格（防止"服装唯一事实源"被空壳值绕过）', () => {
    const r = validateCharacter(okChar({ outfit: 'T恤' }));
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toMatch(/outfit/);
  });

  it('visualAnchors 只有 1 条不合格（跨页"还是不是这张脸"的锚点）', () => {
    const r = validateCharacter(okChar({ visualAnchors: ['左眼下痣'] }));
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toMatch(/visualAnchors/);
  });

  it('auditCharacter 把不合格角色标成 legacy 而不是抛错', () => {
    expect(auditCharacter(okChar())).toBe('ok');
    expect(auditCharacter({ id: 'x', name: 'X' } as SeriesCharacter)).toBe('legacy');
  });
});

describe('validatePanel —— description 太短必须是 repairable', () => {
  it('description 45 字：报错，但标记为可自动修复，绝不 fatal', () => {
    const r = validatePanel(panel({ description: '短'.repeat(45) }), charMap());
    expect(r.ok).toBe(false);
    expect(r.repairable).toBe(true);
    expect(r.errors.join()).toMatch(/description 太短 45\/60/);
  });

  it('description 恰好 60 字：通过', () => {
    expect(validatePanel(panel({ description: '字'.repeat(60) }), charMap()).ok).toBe(true);
  });

  it('description 为空白：同样走 repairable，不抛', () => {
    const r = validatePanel(panel({ description: '   ' }), charMap());
    expect(r.ok).toBe(false);
    expect(r.repairable).toBe(true);
  });

  it('一次性配角缺性别标签 → repairable（2026-09-08 的放宽）', () => {
    const r = validatePanel(
      panel({ extraCharacters: [{ name: '路人', appearance: '穿灰色外套的人' }] }),
      charMap(),
    );
    expect(r.ok).toBe(false);
    expect(r.repairable).toBe(true);
    expect(r.errors.join()).toMatch(/一次性配角/);
  });
});

describe('validatePanel —— fatal 不能被 repairable 掩盖', () => {
  it('characterId 指向不存在的角色 → 不可修复', () => {
    const r = validatePanel(panel({ characterIds: ['ghost'] }), charMap());
    expect(r.ok).toBe(false);
    expect(r.repairable).toBe(false);
    expect(r.errors.join()).toMatch(/在角色库中不存在/);
  });

  it('出场角色字段不全 → 不可修复', () => {
    const bad = { id: 'c9', name: '缺字段', role: 'supporting' } as SeriesCharacter;
    const r = validatePanel(panel({ characterIds: ['c9'] }), charMap(bad));
    expect(r.ok).toBe(false);
    expect(r.repairable).toBe(false);
    expect(r.errors.join()).toMatch(/出场角色 缺字段 字段不全/);
  });

  it('repairable 与 fatal 混合时，整体判为不可修复（关键聚合语义）', () => {
    const r = validatePanel(
      panel({ description: '短'.repeat(45), characterIds: ['ghost'] }),
      charMap(),
    );
    expect(r.ok).toBe(false);
    // description 太短本可修复，但混入了 fatal → 调用方不得走自动补全后放行
    expect(r.repairable).toBe(false);
  });

  it('出场角色齐全时通过', () => {
    const c = okChar();
    expect(validatePanel(panel({ characterIds: ['c1'] }), charMap(c)).ok).toBe(true);
  });
});
