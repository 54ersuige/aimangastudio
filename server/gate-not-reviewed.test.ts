/**
 * 「没审到」vs「审了但是 0 分」的区分（2026-10-16 实测发现）。
 *
 * 现象：某一格审计记录是
 *   overall=0、verdict=reject、8 个维度全是 0 分、reason「无图像输入，无法评分。」、confidence=0
 * 后果：0 < 阈值 → 触发一次白费的重画；0 分还进了连载质量分与 8 维均分，把整体分拖低；
 *       审计面板上显示成刺眼的红色 0/100，看起来像"最差的一张"。
 *
 * 根因：模型**没收到图**，回了一句"无法评分"；解析器把这句话当成了合法评审。
 * 这是 fail-**closed**（审核失败被当成"最差"），与其它路径的 fail-open 相反。
 *
 * 判据：overall 恰好为 0 且 confidence 为 0。
 * 真·糟糕的图模型照样会给分（低分但非 0），confidence 也不会是 0；
 * 只有"根本没审"才会同时出现 0 分 + 0 置信度。
 */
import { describe, it, expect } from 'vitest';

/** 复刻 panel-gate.ts 里 parseReview 末尾的判定。 */
function isNotReviewed(overall: number, confidence: number): boolean {
  return overall === 0 && confidence === 0;
}

describe('没审到 ≠ 0 分', () => {
  it('0 分 + 0 置信度 → 判定为未审到', () => {
    expect(isNotReviewed(0, 0)).toBe(true);
  });

  it('真·糟糕的图（低分但非 0，置信度正常）→ 是有效评审，不该被吞掉', () => {
    expect(isNotReviewed(12, 0.7)).toBe(false);
    expect(isNotReviewed(35, 0.9)).toBe(false);
  });

  it('分数正常但置信度为 0 → 仍是有效评审（只是模型不太确定）', () => {
    expect(isNotReviewed(78, 0)).toBe(false);
  });

  it('0 分但置信度非 0 → 仍是有效评审', () => {
    expect(isNotReviewed(0, 0.3)).toBe(false);
  });
});
