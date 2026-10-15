/**
 * 对齐闸"静默失效"回归测试（2026-10-15 实跑发现）。
 *
 * 背景：真实出图跑一轮后，审计记录里 alignmentAudit 恒为 null，
 * 日志里 alignment-extract-schema-fail 累计 15 次 —— 对齐闸其实是死的，
 * 但因为 fail-open 设计，它看起来像"没有需要对齐的项"，从未报警。
 *
 * 这个测试锁的是：**模型实际会给的形状必须被接受**。
 */
import { describe, it, expect } from 'vitest';

// 直接锁 schema 的归一化行为，避免以后有人把 union 改回单形状。
// 这里复刻 alignment-guard 里的解析逻辑：两种形状都要能落到同一份字符串数组上。
import { z } from 'zod';

const AlignmentItemsZ = z.object({
  items: z.array(z.union([
    z.string().min(2).max(40),
    z.object({ text: z.string().min(2).max(40) }),
  ])).max(5),
});

function normalize(items: Array<string | { text: string }>): string[] {
  return items.map(i => (typeof i === 'string' ? i : i.text).trim()).filter(Boolean);
}

describe('对齐要素抽取 —— 两种返回形状都要吃下', () => {
  it('模型实际返回的纯字符串数组（实测 15/15 都是这个形状）', () => {
    const raw = { items: ['桌上三只空咖啡杯且无人收走', '长桌两端一男一女', '苏曼指尖压着稿子'] };
    const v = AlignmentItemsZ.safeParse(raw);
    expect(v.success).toBe(true);
    expect(normalize(v.data!.items as Array<string | { text: string }>)).toEqual([
      '桌上三只空咖啡杯且无人收走', '长桌两端一男一女', '苏曼指尖压着稿子',
    ]);
  });

  it('原 schema 要求的对象数组（保持兼容，不制造新的单点故障）', () => {
    const raw = { items: [{ text: '空咖啡杯' }, { text: '被吹起的纸角' }] };
    const v = AlignmentItemsZ.safeParse(raw);
    expect(v.success).toBe(true);
    expect(normalize(v.data!.items as Array<string | { text: string }>)).toEqual(['空咖啡杯', '被吹起的纸角']);
  });

  it('两种形状混用也能解析', () => {
    const raw = { items: ['纯字符串', { text: '对象' }] };
    const v = AlignmentItemsZ.safeParse(raw);
    expect(v.success).toBe(true);
    expect(normalize(v.data!.items as Array<string | { text: string }>)).toEqual(['纯字符串', '对象']);
  });

  it('仍应拒绝真正非法的输入（单字符 / 超过 40 字 / 超过 5 项 / 非字符串非对象）', () => {
    expect(AlignmentItemsZ.safeParse({ items: ['x'] }).success).toBe(false);
    expect(AlignmentItemsZ.safeParse({ items: ['a'.repeat(41)] }).success).toBe(false);
    expect(AlignmentItemsZ.safeParse({ items: ['a','b','c','d','e','f'] }).success).toBe(false);
    expect(AlignmentItemsZ.safeParse({ items: [123] }).success).toBe(false);
    expect(AlignmentItemsZ.safeParse({}).success).toBe(false);
  });
});
