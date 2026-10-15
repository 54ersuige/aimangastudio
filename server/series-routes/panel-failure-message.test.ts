/**
 * 失败文案回归测试（2026-10-15 新增）。
 *
 * 这句文案是并发改造对用户的核心承诺：**部分失败时要说清楚"成功的图已经保住了"**。
 * 否则用户看到红色报错会以为整页白跑，从而把已经付过钱的图重画一遍 ——
 * 那正是这次改造要避免的行为。文案退化了，用户就会重新踩坑。
 */
import { describe, it, expect } from 'vitest';
import { describePanelFailures, type PanelGenFailure } from './prompts.js';

const fail = (panelIndex: number, reason = '三次尝试均失败'): PanelGenFailure => ({ panelIndex, reason });

describe('describePanelFailures', () => {
  it('部分失败：必须同时说清「成功几格已保留」和「可只重试失败格」', () => {
    const msg = describePanelFailures([fail(2), fail(4)], 6);
    expect(msg).toContain('4/6');
    expect(msg).toContain('已生成并保留');
    expect(msg).toContain('第3格');
    expect(msg).toContain('第5格');
    // 关键：告诉用户不用重画整批
    expect(msg).toContain('不必重画整批');
  });

  it('全失败：措辞改为全部失败，不再说「已保留」', () => {
    const msg = describePanelFailures([fail(0), fail(1)], 2);
    expect(msg).toContain('2 格全部失败');
    expect(msg).not.toContain('已保留');
  });

  it('附上首个失败原因，帮用户判断是限流还是描述问题', () => {
    const msg = describePanelFailures([fail(1, '上游 429 限流'), fail(3, '超时')], 6);
    expect(msg).toContain('429');
  });

  it('失败格超过 8 个时折叠列表但保留总数', () => {
    // 必须是**部分**失败 —— 全失败走的是另一条分支，根本不列下标
    const many = Array.from({ length: 12 }, (_, i) => fail(i));
    const msg = describePanelFailures(many, 20);
    expect(msg).toContain('8/20');
    expect(msg).toContain('等 12 格');
    // 只列前 8 个下标
    expect(msg).toContain('第8格');
    expect(msg).not.toContain('第9格');
  });

  it('单格失败也给出可操作文案', () => {
    const msg = describePanelFailures([fail(0)], 1);
    expect(msg).toContain('1 格全部失败');
  });
});
