/**
 * 分镜描述补全的回归测试（2026-10-20）。
 *
 * 前提澄清（这条决定了整个设计）：
 * **分镜是 AI 拆的、补全是流程的一部分，用户只做审核、不写分镜。**
 *
 * 所以补全失败绝不能变成"请你自己去补" —— 那是给用户派活。
 * 正确行为是：**系统自己多试几轮**；实在补不进去，
 * 也只提示"这一格审核时留意"，不派待办。
 *
 * 这条测试锁两件事：
 *  1. 补全结果够长才采纳（不够长 → 下一轮再试，不能带着短描述就去出图）；
 *  2. 重试只处理**还没补够**的格（补够的不该被反复重写）。
 */
import { describe, it, expect } from 'vitest';
import { adoptExtended } from './prompts.js';

describe('adoptExtended —— 够长才采纳', () => {
  it('够长就采纳（这是这一格的最终描述）', () => {
    const ext = '陆远独自站在闸机外左侧，右手停在读卡区上方，读卡器红灯亮着。'.repeat(2);
    const adopted = adoptExtended('原文很短', ext);
    expect(adopted).not.toBeNull();
    expect(adopted).toBe(ext.trim());
  });

  it('不够长 → 返回 null（交给下一轮，不带着短描述去出图）', () => {
    // 这是最关键的一条：原来一轮补不够就 continue，
    // 那格就带着 40 字的描述出图 → 画面失焦 → 用户审核时看不出来对不对。
    expect(adoptExtended('原文', '只写了三十来个字，没写够')).toBeNull();
  });

  it('空字符串 → null', () => {
    expect(adoptExtended('原文', '')).toBeNull();
    expect(adoptExtended('原文', '   ')).toBeNull();
  });

  it('阈值可调（默认 60 字）', () => {
    expect(adoptExtended('x', '补'.repeat(30), 20)).not.toBeNull();
    expect(adoptExtended('x', '补'.repeat(30), 60)).toBeNull();
  });

  it('刚好 60 字算够（边界含等号）', () => {
    expect(adoptExtended('x', '字'.repeat(60))).not.toBeNull();
    expect(adoptExtended('x', '字'.repeat(59))).toBeNull();
  });
});
