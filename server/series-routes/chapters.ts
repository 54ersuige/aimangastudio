import { Router } from 'express';
import { z } from 'zod';
import { sendError } from '../utils.js';
import { getSeries, updateSeries, appendChaptersToArc, setChapters, updateChapter, moveChapter, removeChapter } from '../series-store.js';
import type { Chapter, Arc } from '../series-store.js';
import { callStructuredJson, seriesDnaKey, ChapterListZ } from './helpers.js';

const router = Router();

// ========== Step 3: 章节拆分 ==========

const ChaptersSchema = {
  type: 'object',
  properties: {
    chapters: {
      type: 'array',
      minItems: 1,
      maxItems: 8,
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '话标题：本话那件完整的事的极短概括（2-8 字）。禁止包含「章/卷/话/页」等结构字（序号由系统显示），例："报到""工位风波"' },
          summary: { type: 'string', description: '本话剧情概要，2-3 句' },
          pageCount: { type: 'integer', minimum: 1, maximum: 12, description: '本话内部批次数（每批固定 6 格）' },
        },
        required: ['title', 'summary', 'pageCount'],
      },
    },
  },
  required: ['chapters'],
} as const;

// ========== 季/卷 蓝图 ==========
//
// 新的连载流程：Worldview 给出 arcBlueprints → 用户点「生成季骨架」物化成空 arc
// → 对每个 arc 点「生成本季 chapter」/「扩写下一章」逐季生成。
// 旧的 /chapters/generate 保留以兼容已迁移数据（仅在 chapters 直接挂顶层时可用）。

// -------- 把世界观里的 arcBlueprints 物化成空 arc（一次性） --------
router.post('/series/:id/arcs/generate', async (req, res) => {
  const series = getSeries(req.params.id);
  if (!series) return sendError(res, 404, 'Series not found');
  if (!series.worldview) return sendError(res, 400, '请先生成世界观');
  const blueprints = series.worldview.arcBlueprints ?? [];
  if (blueprints.length === 0) {
    return sendError(res, 400, '世界观未提供季蓝图（arcBlueprints）；请重新生成世界观或手动创建季');
  }
  if (series.arcs && series.arcs.length > 0) {
    return sendError(res, 409, '该系列已有季结构，无需重复创建');
  }
  try {
    const arcs: Arc[] = blueprints.map((b, i) => ({
      id: crypto.randomUUID(),
      index: i + 1,
      title: b.title,
      premise: b.premise,
      plannedChapterCount: b.plannedChapterCount,
      chapters: [],
    }));
    updateSeries(series.id, { arcs });
    res.json({ arcs });
  } catch (e: any) {
    sendError(res, 500, e.message || 'Failed to create arcs');
  }
});

// -------- 一次生成指定 arc 的全部 chapter --------
router.post('/series/:id/arcs/:arcId/generate-chapters', async (req, res) => {
  const series = getSeries(req.params.id);
  if (!series) return sendError(res, 404, 'Series not found');
  if (!series.worldview) return sendError(res, 400, '请先生成世界观');
  if (series.characters.length === 0) return sendError(res, 400, '请先生成角色');
  const arc = (series.arcs ?? []).find(a => a.id === req.params.arcId);
  if (!arc) return sendError(res, 404, 'Arc not found');
  if (arc.chapters.length > 0) {
    return sendError(res, 409, '该季已有 chapter，请改用「扩写下一章」');
  }
  const dnaKey = seriesDnaKey(series);
  const totalPages = Math.max(4, Math.min(120, Number(req.body?.targetPageCount || arc.plannedChapterCount * 4)));
  const hint = String(req.body?.hint ?? '').trim().slice(0, 2000) || undefined;
  try {
    const w = series.worldview;
    // 前情提要：所有前置 arc 的 chapter summary 列表
    const priorArcs = (series.arcs ?? []).filter(a => a.index < arc.index);
    const priorBlock = priorArcs.length > 0
      ? `\n\n前情提要（这些已经发生，不能重复）：\n${priorArcs.map(a => `【${a.title}】\n${a.chapters.map(c => `- ${c.title}：${c.summary}`).join('\n')}`).join('\n\n')}\n`
      : '';
    const plotOutline = w.plotOutline ?? w.background;
    const conflicts = w.conflicts ?? [];
    const conflictsBlock = conflicts.length > 0 ? `\n核心矛盾：${conflicts.join('；')}` : '';
    const prompt = `把季"${arc.title}"（${arc.premise}）拆分成话目。${priorBlock}\n\n剧情总纲：${plotOutline}${conflictsBlock}\n\n世界观：\n时代：${w.era}\n背景：${w.background}\n风格：${w.artStyle}\n\n故事简介：${series.logline}\n\n角色：${series.characters.map(c => `${c.name}（${c.role}）`).join('、')}\n\n本季计划话数：${arc.plannedChapterCount} 话。请按 arc premise 拆出 ${arc.plannedChapterCount} 话，每话一件完整的事（有起承转合），话标题禁止包含「章/卷/话/页」等结构字；每话 pageCount（内部批次数）2-6，之和 ≈ ${totalPages}（AI 自由决定，只要总数在这个范围）。${hint ? `\n\n用户修改意见：${hint}` : ''}`;
    const result = await callStructuredJson<z.infer<typeof ChapterListZ>>(
      prompt,
      '你是一位漫画编剧。请输出严格的 JSON 格式。',
      ChaptersSchema as Record<string, unknown>,
      {
        dnaKey,
        logKind: 'arc-chapters',
        logMeta: { seriesId: series.id, arcId: arc.id, targetPageCount: totalPages },
        validate: raw => ChapterListZ.parse(raw),
      },
    );
    const chapters: Chapter[] = result.chapters.map(ch => ({
      id: crypto.randomUUID(),
      arcId: arc.id,
      title: ch.title,
      summary: ch.summary,
      pageCount: ch.pageCount,
      pages: Array.from({ length: ch.pageCount }, (_, i) => ({
        id: crypto.randomUUID(),
        pageNumber: i + 1, // setChapters/appendChaptersToArc 会按全局重新编号
        title: `第 ${i + 1} 批`,
        sceneDescription: '',
        panels: [],
        characterIds: [],
        status: 'draft' as const,
      })),
    }));
    const appended = appendChaptersToArc(series.id, arc.id, chapters);
    res.json({ arc, chapters: appended });
  } catch (e: any) {
    sendError(res, 502, e.message || 'Chapter generation failed');
  }
});

// -------- 逐章生成：在指定 arc 末尾追加下一章（按 plot 推演） --------
router.post('/series/:id/arcs/:arcId/append-next-chapter', async (req, res) => {
  const series = getSeries(req.params.id);
  if (!series) return sendError(res, 404, 'Series not found');
  if (!series.worldview) return sendError(res, 400, '请先生成世界观');
  if (series.characters.length === 0) return sendError(res, 400, '请先生成角色');
  const arc = (series.arcs ?? []).find(a => a.id === req.params.arcId);
  if (!arc) return sendError(res, 404, 'Arc not found');
  const dnaKey = seriesDnaKey(series);
  const targetPages = Math.max(2, Math.min(8, Number(req.body?.pageCount || 4)));
  const hint = String(req.body?.hint ?? '').trim().slice(0, 2000) || undefined;
  try {
    const w = series.worldview;
    const priorChapters = arc.chapters;
    const priorBlock = priorChapters.length > 0
      ? `\n\n本季已生成话目（不要重复，直接续写）：\n${priorChapters.map(c => `- ${c.title}：${c.summary}`).join('\n')}\n`
      : '';
    const priorArcs = (series.arcs ?? []).filter(a => a.index < arc.index);
    const priorArcsBlock = priorArcs.length > 0
      ? `\n\n前季剧情：\n${priorArcs.map(a => `【${a.title}】\n${a.chapters.map(c => `- ${c.title}：${c.summary}`).join('\n')}`).join('\n\n')}\n`
      : '';
    const prompt = `为连载「${series.title}」的 "${arc.title}"（${arc.premise}）续写下一话。${priorArcsBlock}${priorBlock}\n\n世界观：\n时代：${w.era}\n背景：${w.background}\n风格：${w.artStyle}\n\n故事简介：${series.logline}\n\n角色：${series.characters.map(c => `${c.name}（${c.role}）`).join('、')}\n\n请只输出一个 chapter（约 ${targetPages} 个内部批次，每批 6 格），summary 必须承接上一话结尾自然推进剧情。话标题禁止包含「章/卷/话/页」等结构字。${hint ? `\n\n用户修改意见：${hint}` : ''}`;
    const result = await callStructuredJson<{ chapter: { title: string; summary: string; pageCount: number } }>(
      prompt,
      '你是一位漫画编剧。请输出严格的 JSON 格式。',
      {
        type: 'object',
        properties: {
          chapter: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              summary: { type: 'string' },
              pageCount: { type: 'integer', minimum: 2, maximum: 8 },
            },
            required: ['title', 'summary', 'pageCount'],
          },
        },
        required: ['chapter'],
      } as Record<string, unknown>,
      {
        dnaKey,
        logKind: 'append-chapter',
        logMeta: { seriesId: series.id, arcId: arc.id, pageCount: targetPages },
        validate: raw => {
          const v = z.object({ chapter: z.object({ title: z.string().min(1), summary: z.string().min(1), pageCount: z.number().int().min(2).max(8) }) }).parse(raw);
          return v;
        },
      },
    );
    const newChapter: Chapter = {
      id: crypto.randomUUID(),
      arcId: arc.id,
      title: result.chapter.title,
      summary: result.chapter.summary,
      pageCount: result.chapter.pageCount,
      pages: Array.from({ length: result.chapter.pageCount }, (_, i) => ({
        id: crypto.randomUUID(),
        pageNumber: i + 1,
        title: `第 ${i + 1} 批`,
        sceneDescription: '',
        panels: [],
        characterIds: [],
        status: 'draft' as const,
      })),
    };
    const appended = appendChaptersToArc(series.id, arc.id, [newChapter]);
    res.json({ arc, chapter: appended?.[0] ?? null });
  } catch (e: any) {
    sendError(res, 502, e.message || 'Append chapter failed');
  }
});

// 手动编辑：保存 chapter 元数据（标题/剧情摘要/核心冲突/预计页数）
const UpdateChapterSchema = z.object({
  title: z.string().min(1).optional(),
  summary: z.string().optional(),
  conflict: z.string().optional(),
  pageCount: z.number().int().min(2).max(8).optional(),
  // 公众号发布元数据（一话一件完整的事）
  tagline: z.string().max(80).optional(),
  endingQuote: z.string().max(120).optional(),
  nextPreview: z.string().max(300).optional(),
});

router.patch('/series/:id/chapters/:chapterId', (req, res) => {
  const series = getSeries(req.params.id);
  if (!series) return sendError(res, 404, 'Series not found');
  const parsed = UpdateChapterSchema.safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, parsed.error.message);
  const updated = updateChapter(series.id, req.params.chapterId, parsed.data);
  if (!updated) return sendError(res, 404, 'Chapter not found');
  res.json({ chapter: updated });
});

// —— 公众号发布文案（话级）：AI 生成 副题 / 结尾金句 / 下话预告，保存到章上 ——
const PublishCopySchema = {
  type: 'object',
  properties: {
    tagline: { type: 'string', description: '话头副题：一句话点题，20-40字，安静克制、不说教。' },
    endingQuote: { type: 'string', description: '结尾金句：整话收尾的大字强调句，15-35字，戛然而止带余味。' },
    nextPreview: { type: 'string', description: '下话预告：2-3 句悬念文案（若有下一话则基于其剧情，否则留悬念式展望）。' },
  },
  required: ['tagline', 'endingQuote', 'nextPreview'],
} as const;

router.post('/series/:id/chapters/:chapterId/publish-copy', async (req, res) => {
  const series = getSeries(req.params.id);
  if (!series) return sendError(res, 404, 'Series not found');
  const dnaKey = seriesDnaKey(series);
  // 找到本话与其所在 arc 内的下一话（预告素材）
  let chapter: Chapter | undefined;
  let nextChapter: Chapter | undefined;
  for (const arc of series.arcs ?? []) {
    const idx = arc.chapters.findIndex(c => c.id === req.params.chapterId);
    if (idx === -1) continue;
    chapter = arc.chapters[idx];
    nextChapter = arc.chapters[idx + 1];
    break;
  }
  if (!chapter) {
    const list = series.chapters ?? [];
    const idx = list.findIndex(c => c.id === req.params.chapterId);
    if (idx >= 0) { chapter = list[idx]; nextChapter = list[idx + 1]; }
  }
  if (!chapter) return sendError(res, 404, 'Chapter not found');

  const lastDialogues = chapter.pages.flatMap(p => p.panels).filter(pn => pn.dialogue).slice(-3)
    .map(pn => pn.dialogue).join(' / ');
  const prompt = `为公众号连载漫画的一话写发布文案。\n\n作品：《${series.title}》\n本话：《${chapter.title}》\n剧情概要：${chapter.summary}\n本话结尾的三句对白/旁白（收尾基调参考）：${lastDialogues || '（无）'}\n${nextChapter ? `下一话：《${nextChapter.title}》—— ${nextChapter.summary}` : '（本话是当前已写的最后一话，下话预告写成悬念式展望，不虚构具体剧情标题）'}\n\n要求：\n1. tagline（话头副题）：一句话点题本话，20-40 字，安静克制、不说教，像独立电影的一句话简介。\n2. endingQuote（结尾金句）：整话收尾的大字强调句，15-35 字，戛然而止、带余味，可以从结尾对白里化用但不要照抄。\n3. nextPreview（下话预告）：2-3 句，制造想看下一话的悬念；不要剧透结局式总结。`;
  try {
    const copy = await callStructuredJson<{ tagline: string; endingQuote: string; nextPreview: string }>(
      prompt,
      '你是一位公众号连载漫画的编辑，擅长写克制而有钩子的发布文案。请输出严格的 JSON 格式。',
      PublishCopySchema as Record<string, unknown>,
      {
        dnaKey,
        logKind: 'publish-copy',
        logMeta: { seriesId: series.id, chapterId: chapter.id },
        validate: raw => {
          const v = z.object({
            tagline: z.string().min(5).max(80),
            endingQuote: z.string().min(5).max(120),
            nextPreview: z.string().min(5).max(300),
          }).parse(raw);
          return v;
        },
      },
    );
    const updated = updateChapter(series.id, chapter.id, copy);
    if (!updated) return sendError(res, 500, 'Failed to save publish copy');
    res.json({ chapter: updated });
  } catch (e: any) {
    sendError(res, 502, e.message || 'Publish copy generation failed');
  }
});

// 手动编辑：调整章节顺序
router.post('/series/:id/chapters/:chapterId/move', (req, res) => {
  const series = getSeries(req.params.id);
  if (!series) return sendError(res, 404, 'Series not found');
  const direction = req.body?.direction;
  if (direction !== 'up' && direction !== 'down') {
    return sendError(res, 400, 'direction must be "up" or "down"');
  }
  const ok = moveChapter(series.id, req.params.chapterId, direction);
  if (!ok) return sendError(res, 409, 'Chapter cannot be moved in that direction');
  res.json({ success: true });
});

// 手动编辑：删除一个 chapter（慎用；同时删除其下所有 page）
router.delete('/series/:id/chapters/:chapterId', (req, res) => {
  const series = getSeries(req.params.id);
  if (!series) return sendError(res, 404, 'Series not found');
  const ok = removeChapter(series.id, req.params.chapterId);
  if (!ok) return sendError(res, 404, 'Chapter not found');
  res.json({ success: true });
});

// -------- 兼容旧端点：直接挂顶层的 chapter 生成（无 arc 数据时） --------
router.post('/series/:id/chapters/generate', async (req, res) => {
  const series = getSeries(req.params.id);
  if (!series) return sendError(res, 404, 'Series not found');
  if (!series.worldview) return sendError(res, 400, '请先生成世界观');
  if (series.characters.length === 0) return sendError(res, 400, '请先生成角色');
  // 新流程：series 已有 arc 时，引导用户走新端点
  if (series.arcs && series.arcs.length > 0) {
    return sendError(res, 400, '该系列已升级到季结构，请改用「生成本季章节」/「扩写下一章」');
  }
  const dnaKey = seriesDnaKey(series);
  const targetPageCount = Math.max(4, Math.min(60, Number(req.body?.targetPageCount || 12)));
  try {
    const plotOutline = series.worldview.plotOutline ?? series.worldview.background;
    const conflicts = series.worldview.conflicts ?? [];
    const outlineBlock = `\n\n剧情大纲（按此切话目，**禁止自己重新编剧情**，只做"分段 + 配批"）：\n${plotOutline}`;
    const conflictsBlock = conflicts.length > 0 ? `\n核心矛盾：${conflicts.join('；')}` : '';
    const prompt = `基于以下漫画设定，把剧情大纲拆分成话目。${outlineBlock}${conflictsBlock}\n\n世界观：\n时代：${series.worldview.era}\n背景：${series.worldview.background}\n\n故事简介：${series.logline}\n\n角色：${series.characters.map(c => `${c.name}（${c.role}）`).join('、')}\n\n目标总规模：约 ${targetPageCount} 批（每批 6 格，每话约 2 批 ≈ 15 格）。请把剧情大纲对应切分成若干话（每话 2-6 批），话标题禁止包含「章/卷/话/页」等结构字；话标题与 summary 必须与剧情大纲的对应段保持一致；pageCount 之和 = ${targetPageCount}。`;
    const result = await callStructuredJson<z.infer<typeof ChapterListZ>>(
      prompt,
      '你是一位漫画编剧。请输出严格的 JSON 格式。',
      ChaptersSchema as Record<string, unknown>,
      {
        dnaKey,
        logKind: 'chapters',
        logMeta: { seriesId: series.id, targetPageCount },
        validate: raw => ChapterListZ.parse(raw),
      },
    );
    const chapters: Chapter[] = result.chapters.map(ch => ({
      id: crypto.randomUUID(),
      title: ch.title,
      summary: ch.summary,
      pageCount: ch.pageCount,
      pages: Array.from({ length: ch.pageCount }, (_, i) => ({
        id: crypto.randomUUID(),
        pageNumber: i + 1,
        title: `第 ${i + 1} 批`,
        sceneDescription: '',
        panels: [],
        characterIds: [],
        status: 'draft' as const,
      })),
    }));
    setChapters(series.id, chapters);
    res.json({ chapters });
  } catch (e: any) {
    sendError(res, 502, e.message || 'Chapter generation failed');
  }
});

export default router;
