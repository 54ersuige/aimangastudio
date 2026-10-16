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

/** 每话批次数区间。由上面两个格数区间除以每批格数得出，不独立拍数字。 */
export const BATCHES_PER_EPISODE_MIN = PANELS_PER_EPISODE_MIN / PANELS_PER_BATCH; // 2
export const BATCHES_PER_EPISODE_MAX = PANELS_PER_EPISODE_MAX / PANELS_PER_BATCH; // 3

/**
 * 把「用户想要的总批次数」夹进真正可达的区间。
 *
 * chapterCount 传具体话数 → 夹进「该话数」的区间；
 * chapterCount 传 undefined（话数由模型决定）→ 只夹进「1-8 话全都可能」的全局区间。
 *
 * 2026-10-16 实测的三个自相矛盾（模型只能取其中最松的一条，于是要么被 schema 拒、
 * 要么输出与 prompt 不符）：
 *   - append 端点 prompt 要 4 批，schema 只允许到 3
 *   - generate-chapters 要 pageCount 之和 = 话数×4，而每话最多 3 → 永远达不到
 *   - 手动编辑能设 pageCount=8（48 格），但没有任何校验管得住
 * 根源都是同一个：**总数/范围是各处手写的字面量，没人算它可不可达。**
 */
export function feasibleTotalBatches(
  requested: number,
  chapterCount?: number,
  chapterCountMin = 1,
  chapterCountMax = 8,
): number {
  const lo = (chapterCount ?? chapterCountMin) * BATCHES_PER_EPISODE_MIN;
  const hi = (chapterCount ?? chapterCountMax) * BATCHES_PER_EPISODE_MAX;
  const hardLo = chapterCountMin * BATCHES_PER_EPISODE_MIN;
  const hardHi = chapterCountMax * BATCHES_PER_EPISODE_MAX;
  const want = Number.isFinite(requested) ? Math.round(requested) : lo;
  return Math.max(hardLo, Math.min(hardHi, Math.max(lo, Math.min(hi, want))));
}

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
 * summary 是否**过密**（内容远超该话容量）。
 *
 * 2026-10-16 实跑四话：拍数 23 / 26 / 41 / 33，需求一律是 18。
 * 判据只卡下限「够不够」，完全不卡上限，于是模型写得越猛越"好"。
 * 代价是拆解时画面点塞不进格，或被静默丢弃。
 *
 * 刻意**不拦截**，只提示：加严就等于把用户重新推进
 * 「频繁报错、停滞不前」（[[review-thresholds-relaxed]] 里他明确要求避免的）。
 * 密度偏高本身不产出坏结果，只是提醒用户拆解时可能要取舍。
 */
export function checkChapterDensity(
  summary: string,
  pageCount: number,
): string | null {
  const need = panelsForPageCount(pageCount);
  const have = estimatedPanels(summary);
  if (have <= need * DENSITY_WARN_RATIO) return null;
  return `这一话内容密度偏高：按每格 ${CHARS_PER_PANEL} 字估计约 ${have} 拍，`
    + `而本话只有 ${need} 格容量（超出约 ${Math.round((have / need - 1) * 100)}%）。`
    + `拆解时画面点会塞不进格，建议要么把 pageCount 调大（最多 ${BATCHES_PER_EPISODE_MAX} 批），`
    + `要么把 summary 里优先级低的内容删掉。`;
}

/**
 * 超过容量多少倍开始提示过密。
 *
 * 实跑四话的比值是 1.28 / 1.44 / 1.83 / 2.28（中位约 1.6）。
 * 定 1.5 是照着这组数据来的：18 格塞 27 拍意味着三成画面点会在拆解时被丢掉，
 * 值得提醒；1.28 那两话（多 4-8 拍）属于"写得细"，不打扰用户。
 */
export const DENSITY_WARN_RATIO = 1.5;

/**
 * 规划 prompt 里的公共约束段。
 * 三处入口（生成本季话目 / 扩写下一章 / 从剧情大纲切话目）共用同一段，
 * 避免同一个规则写在三个地方然后各自漂移。
 *
 * ⚠ 这里所有数字都由上面的常量算出来，不许手写。
 * 2026-10-16 教训：这段曾经手写「pageCount=2 需 ≥120 字，pageCount=3 需 ≥180 字」，
 * 而 checkChapterCapacity 实际要的是 240 / 360 —— **差整整一倍**。
 * 模型照着 prompt 写必然被校验打回，一轮轮重来直到停滞。
 * 「规则写在文档里」不够，数字还必须和代码对得上。
 */
export const CHAPTER_CAPACITY_RULE = [
  '',
  '【本话容量与戏剧张力 · 硬要求】',
  `一页 = ${PANELS_PER_BATCH} 格。summary 必须能拆出**恰好 pageCount × ${PANELS_PER_BATCH} 个画面点**，每个画面点一句话。`,
  `按每格 ${CHARS_PER_PANEL} 字估算：pageCount=${BATCHES_PER_EPISODE_MIN} 需 ≥${BATCHES_PER_EPISODE_MIN * PANELS_PER_BATCH * CHARS_PER_PANEL} 字，pageCount=${BATCHES_PER_EPISODE_MAX} 需 ≥${BATCHES_PER_EPISODE_MAX * PANELS_PER_BATCH * CHARS_PER_PANEL} 字。`,
  '',
  '这一话是「一天一条长图」，要撑得起戏剧张力，因此：',
  '1. summary 只写事情**够演满这些格**的量 —— 事必须大到装得下，不是刚好够讲完一件小事。',
  '2. 必须有明确的冲突或转折（谁施压、谁反抗、代价是什么），不要平铺直叙。',
  '3. **主角必须做出至少一个主动的选择或反抗** —— 不能整话都在被动承受、跟着走、看着别人。',
  '   反例（不合格）：他小跑才跟上、手心出汗、被带着走。',
  '4. **必须有一样东西处在风险里**（他的位置、某个人对他的看法、某个他瞒着的事），',
  '   并让他在本话内真的为此付出一点代价。没有代价就没有冲突，只剩下气氛。',
  '5. 结尾停在一个**未解决**的地方（一句怼回去、被当众甩锅、发现某件事…），',
  '   不要在本话内收干净 —— 收干净了读者就没有追下去的理由。',
  '6. 禁止用重复意思的句子凑字数：宁可少写一句，不要把同一件事说两遍。',
  '7. 不要把「张力」写成暧昧/紧张气氛。暧昧不等于冲突：必须有人真的挡了主角的路，',
  '   或主角真的做了一件让他处境变糟的事。',
  '8. **同一系列里，本话的冲突形态不能和前面几话重复**。',
  '   如果前面几话都是「某人施压 → 主角拒绝 → 付出代价」，这一话就要换一种形态',
  '   （主角先发制人 / 代价落在别人身上 / 误会与真相错位 / 主角赢了但更糟…）。',
  '   套路化的张力不是张力，读者看穿了就不再紧张。',
  `9. 内容不要写超：本话上限就是 pageCount × ${PANELS_PER_BATCH} 个画面点，`,
  `   大约 ${BATCHES_PER_EPISODE_MIN * PANELS_PER_BATCH * CHARS_PER_PANEL}-${BATCHES_PER_EPISODE_MAX * PANELS_PER_BATCH * CHARS_PER_PANEL} 字。`,
  '   写更多不会更好，只会在拆解时被丢弃。',
].join('\n');
