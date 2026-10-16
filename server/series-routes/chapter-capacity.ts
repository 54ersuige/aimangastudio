/**
 * 「一话该有多少内容」的唯一判据（2026-10-15）。
 *
 * ## 为什么要单独立一个模块
 * 用户的发布模型：**一话 = 一天 = 一条长图 = 一次发布**。
 * 所以「12-18 格」不是一个体量美学指标，而是
 * **这一话要够不够演完一件有戏剧张力的事**。
 *
 * ## 病根（实测数据）
 * 规划出来的 summary 固定 100 字上下（104 / 104 / 102 / 101），
 * 而 pageCount 固定给 3（→ 18 格容量）。
 * 实测《报到》那 6 格与 summary 里的 6 句话**一一对应，一格不差**：
 *   报到 → 电梯玻璃倒影 → 前台递工牌 → 看见靠窗工位 → 周敏扫一眼 → 坐下
 * 也就是说 **summary 的信息量只够撑 1 批（6 格），容量却预留了 3 批**，
 * 剩下 12 格是**没有剧情可写的空批次**。
 *
 * 界面还会把「已填 6 格」当成「只规划了 6 格」，于是显示
 * 「低于每话目标 12-18 格 —— 剧情没讲完」，把用户往硬编内容的坑里推。
 *
 * ## 判据
 * 一个 summary 撑不撑得起 N 格，看的是**可数的画面点**，不是字数。
 * 100 字能写 6 个画面点；18 格需要约 18 个。
 * 按句读句子太脆（模型爱写长句），改用「画面点估计」：
 *   beats ≈ summary 字数 / 每格预算字数
 * 每格给 20 字是实测偏保守的估计（104 字 → 5.2 拍 → 判为"只够 1 批"，
 * 与实际观察到的 6 拍吻合）。
 */

/** 每格分镜在 summary 里占用的字数预算。 */
export const CHARS_PER_PANEL = 20;

/** 每批固定 6 格。 */
export const PANELS_PER_BATCH = 6;

/** 每话的目标格数区间（公众号单条长图的常规体量）。 */
export const PANELS_PER_EPISODE_MIN = 12;
export const PANELS_PER_EPISODE_MAX = 18;

/** 由 pageCount 推出该话需要多少格。 */
export function panelsForPageCount(pageCount: number): number {
  return pageCount * PANELS_PER_BATCH;
}

/** summary 能撑起多少格（粗估）。 */
export function estimatedPanels(summary: string): number {
  return Math.floor((summary || '').trim().length / CHARS_PER_PANEL);
}

/** summary 撑不撑得起 pageCount × 6 格。 */
export function summaryCoversPageCount(summary: string, pageCount: number): boolean {
  return estimatedPanels(summary) >= panelsForPageCount(pageCount);
}

/**
 * 校验规划结果，必要时给出可执行的返工指令。
 * 返回 null = 通过；返回字符串 = 不通过，且该字符串是要塞回给模型的理由。
 */
export function checkChapterCapacity(
  summary: string,
  pageCount: number,
): string | null {
  const need = panelsForPageCount(pageCount);
  const have = estimatedPanels(summary);
  if (have >= need) return null;
  const suggested = Math.max(
    1,
    Math.ceil(need * CHARS_PER_PANEL),
  );
  return [
    `这一话规划了 ${pageCount} 批（${need} 格），但 summary 只有 ${(summary || '').length} 字，`,
    `按每格 ${CHARS_PER_PANEL} 字估计只够演 ${have} 格 —— 剩下 ${need - have} 格没有剧情可写。`,
    `请把这件事写大一点：summary 至少 ${suggested} 字，并且必须能拆出**恰好 ${need} 个画面点**，`,
    `每个画面点一句话（一句 = 一格），点与点之间要有推进（不是同一个意思换句话说）。`,
    `并且这一话要有戏剧张力 —— 有明确的冲突或转折，结尾停在一个**未解决**的地方`,
    `（一句怼回去、被当众甩锅、发现某件事…），不要在本话内收干净。`,
  ].join('');
}

/**
 * 规划 prompt 里的公共约束段。
 * 三处入口（生成本季话目 / 扩写下一章 / 从剧情大纲切话目）共用同一段，
 * 避免同一个规则写在三个地方然后各自漂移。
 */
export const CHAPTER_CAPACITY_RULE = [
  '',
  '【本话容量与戏剧张力 · 硬要求】',
  '一页 = 6 格。summary 必须能拆出**恰好 pageCount × 6 个画面点**，每个画面点一句话。',
  '按每格 20 字估算：pageCount=2 需 ≥120 字，pageCount=3 需 ≥180 字。',
  '',
  '这一话是「一天一条长图」，要撑得起戏剧张力，因此：',
  '1. summary 只写事情**够演满这些格**的量 —— 事必须大到装得下，不是刚好够讲完一件小事。',
  '2. 必须有明确的冲突或转折（谁施压、谁反抗、代价是什么），不要平铺直叙。',
  '3. 结尾停在一个**未解决**的地方（一句怼回去、被当众甩锅、发现某件事…），',
  '   不要在本话内收干净 —— 收干净了读者就没有追下去的理由。',
  '4. 禁止用重复意思的句子凑字数：宁可少写一句，不要把同一件事说两遍。',
].join('\n');
