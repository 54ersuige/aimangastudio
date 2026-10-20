import { Router } from 'express';
import { z } from 'zod';
import { sendError } from '../utils.js';
import { getSeries, updateSeries, appendChaptersToArc, setChapters, updateChapter, moveChapter, removeChapter } from '../series-store.js';
import type { Chapter, Arc } from '../series-store.js';
import { callStructuredJson, seriesDnaKey, ChapterListZ } from './helpers.js';
import { CHAPTER_CAPACITY_RULE, checkChapterCapacity, checkChapterDensity, fitPageCount, PANELS_PER_BATCH, BATCHES_PER_EPISODE_MIN, BATCHES_PER_EPISODE_MAX, PANELS_PER_EPISODE_MIN, PANELS_PER_EPISODE_MAX, feasibleTotalBatches } from './chapter-capacity.js';
import { runTask, setTaskProgress, startTaskHeartbeat, DuplicateTaskError } from '../task-queue.js';

const router = Router();

/** 2026-10-15：规划结果必须真的撑得起它自己声明的格数，否则打回重写。 */
function validateChapterCapacity<T extends { chapters: Array<{ title: string; summary: string; pageCount: number }> }>(result: T): T {
  for (const ch of result.chapters) {
    const problem = checkChapterCapacity(ch.summary, ch.pageCount);
    if (problem) throw new Error(problem);
  }
  return result;
}

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
          summary: { type: 'string', description: '本话剧情概要。必须能拆出恰好 pageCount×6 个画面点（每点一句话），且要有戏剧张力、结尾留未解决的悬念' },
          pageCount: { type: 'integer', minimum: 2, maximum: 3, description: `本话内部批次数（每批固定 ${PANELS_PER_BATCH} 格，即 12-18 格）` },
        },
        required: ['title', 'summary', 'pageCount'],
      },
    },
  },
  required: ['chapters'],
} as const;

/**
 * 季骨架 schema（2026-10-20）。
 *
 * 「生成本季话目」拆成两步后的第 1 步产物：只出**标题 + 批次 + 一句话梗概**，
 * 不出 summary。输出量小（~200 字），调用几十秒就够 ——
 * 目的是先把「这一季分几话、每话讲什么事」定下来，让后面逐话生成有据可依。
 */
const ArcOutlineSchema = {
  type: 'object',
  properties: {
    chapters: {
      type: 'array',
      minItems: 1,
      maxItems: 8,
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '话标题：本话那件完整的事的极短概括（2-8 字）。禁止包含「章/卷/话/页」等结构字，例："报到""工位风波"' },
          pageCount: { type: 'integer', minimum: BATCHES_PER_EPISODE_MIN, maximum: BATCHES_PER_EPISODE_MAX, description: `本话内部批次数（每批固定 ${PANELS_PER_BATCH} 格，即 ${PANELS_PER_EPISODE_MIN}-${PANELS_PER_EPISODE_MAX} 格）` },
          gist: { type: 'string', description: '本话要讲的那件事，一句话（20-40 字）。话与话之间不能是同一件事' },
        },
        required: ['title', 'pageCount', 'gist'],
      },
    },
  },
  required: ['chapters'],
} as const;

/**
 * 单话正文 schema（2026-10-20）。
 * 与「扩写下一话」用的是同一套结构 —— 逐话生成就该复用同一条路径，
 * 而不是再发明一种格式。
 */
const ChapterDetailSchema = {
  type: 'object',
  properties: {
    chapter: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '话标题：2-8 字。禁止包含「章/卷/话/页」等结构字' },
        summary: { type: 'string', description: `本话剧情概要。必须能拆出恰好 pageCount×${PANELS_PER_BATCH} 个画面点（每点一句话），且要有戏剧张力、结尾留未解决的悬念` },
        pageCount: { type: 'integer', minimum: BATCHES_PER_EPISODE_MIN, maximum: BATCHES_PER_EPISODE_MAX, description: `本话内部批次数（每批固定 ${PANELS_PER_BATCH} 格，即 ${PANELS_PER_EPISODE_MIN}-${PANELS_PER_EPISODE_MAX} 格）` },
      },
      required: ['title', 'summary', 'pageCount'],
    },
  },
  required: ['chapter'],
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
  // 2026-10-16：原先是 plannedChapterCount * 4，而每话最多 3 批 —— 总数永远达不到，
  // prompt 与 schema 互相矛盾。现在按可达区间夹一次。
  const totalPages = feasibleTotalBatches(Number(req.body?.targetPageCount ?? arc.plannedChapterCount * BATCHES_PER_EPISODE_MAX), arc.plannedChapterCount, arc.plannedChapterCount, arc.plannedChapterCount);
  const hint = String(req.body?.hint ?? '').trim().slice(0, 2000) || undefined;
  // 2026-10-16：改走 task 队列。
  // 实测这次调用要转 8 分钟（推理型模型一话 60~120s，4 话 + 一次整轮重写）。
  // 同步等在后端 HTTP 连接上，前端只有一个不会动的「生成中…」——
  // 用户据此以为没反应又连点两次，第二次反而撞上 409，局面彻底乱套。
  // 现在立刻返回 taskId，前端轮询进度；同 key 并发点击由 DuplicateTaskError 挡住。
  let taskId: string;
  try {
    taskId = runTask(`arc-chapters:${arc.id}`, 'arc-chapters', async (tid) => {
      const w = series.worldview!;
      // 前情提要：所有前置 arc 的 chapter summary 列表
      const priorArcs = (series.arcs ?? []).filter(a => a.index < arc.index);
      const priorBlock = priorArcs.length > 0
        ? `\n\n前情提要（这些已经发生，不能重复）：\n${priorArcs.map(a => `【${a.title}】\n${a.chapters.map(c => `- ${c.title}：${c.summary}`).join('\n')}`).join('\n\n')}\n`
        : '';
      const plotOutline = w.plotOutline ?? w.background;
      const conflicts = w.conflicts ?? [];
      const conflictsBlock = conflicts.length > 0 ? `\n核心矛盾：${conflicts.join('；')}` : '';
      const worldBlock = `\n\n世界观：\n时代：${w.era}\n背景：${w.background}\n风格：${w.artStyle}\n\n故事简介：${series.logline}\n\n角色：${series.characters.map(c => `${c.name}（${c.role}）`).join('、')}`;

      // ============================================================
      // 2026-10-20：整季一次性生成 → 骨架 + 逐话生成
      // ============================================================
      //
      // 旧做法：一次模型调用出完整季（4 话 × 360+ 字 = 1440+ 字 JSON）。
      // 代价是**一荣俱荣**：任何一话不过容量校验 → 整季作废重来，
      // 而这一次调用本身就要 5~8 分钟（推理型模型）——
      // 用户等的是 N 倍的赌注，输一次全没。
      //
      // 实测翻车现场（2026-10-19）：4 话里第 3 话 summary 写了 353 字、
      // 门槛 360 字，差 7 个字 → 整季重来 → 又遇 529 过载 → 全盘失败。
      //
      // 新做法拆成两步：
      //   1. 骨架：一次轻量调用，只出 N 话的「标题 + 批次 + 一句话梗概」。
      //      输出量小（~200 字），30~60 秒就够。
      //   2. 正文：逐话各调一次，每次只写 1 话的 summary。
      //      输出量 ÷N，**失败只重做那一话**，前面的成果不受牵连。
      //
      // 代价是多一次调用；换来的是「失败不隔离」这个最大痛点被拆掉。
      const outlinePrompt = `为连载「${series.title}」的季 "${arc.title}"（${arc.premise}）规划 ${arc.plannedChapterCount} 话的骨架。${priorBlock}\n\n剧情总纲：${plotOutline}${conflictsBlock}${worldBlock}\n\n本季计划话数：${arc.plannedChapterCount} 话。请拆成 ${arc.plannedChapterCount} 话，每话一件完整的事（有起承转合），话与话之间剧情要推进、不能重复同一件事。话标题禁止包含「章/卷/话/页」等结构字；每话 pageCount（内部批次数）${BATCHES_PER_EPISODE_MIN}-${BATCHES_PER_EPISODE_MAX}，之和 ≈ ${totalPages}。每话给一句 gist（本话要讲的那件事，20-40 字）。${hint ? `\n\n用户修改意见：${hint}` : ''}`;
      const outline = await callStructuredJson<{ chapters: Array<{ title: string; pageCount: number; gist: string }> }>(
        outlinePrompt,
        '你是一位漫画编剧。请输出严格的 JSON 格式。',
        ArcOutlineSchema as Record<string, unknown>,
        {
          dnaKey,
          logKind: 'arc-outline',
          logMeta: { seriesId: series.id, arcId: arc.id, targetPageCount: totalPages },
          // 骨架输出很小，3 分钟绰绰有余（旧的 480s 是为整季一次性生成设的）
          timeoutMs: 180000,
          onProgress: () => setTaskProgress(tid, 5),
          heartbeat: { from: 0, to: 9, durationMs: 60000 },
          onHeartbeatStart: (h) => startTaskHeartbeat(tid, h.from, h.to, h.durationMs),
        },
      );
      const plannedChapters = outline.chapters ?? [];
      if (plannedChapters.length === 0) throw new Error('季骨架为空，未能生成任何话目');
      setTaskProgress(tid, 10);

      // —— 第 2 步：逐话生成正文 ——
      const N = plannedChapters.length;
      const bodyStart = 10;
      const bodyEnd = 99;
      const step = (bodyEnd - bodyStart) / N;
      const written: Array<{ title: string; summary: string; pageCount: number }> = [];

      for (let i = 0; i < N; i++) {
        const planned = plannedChapters[i];
        const base = bodyStart + step * i;
        // 已写完的话 → 让这一话承接上一话结尾（连贯性）
        const writtenBlock = written.length > 0
          ? `\n\n本季已写完的话（承接它们的结尾继续推进，不要重复）：\n${written.map((c, ci) => `- 第 ${ci + 1} 话《${c.title}》：${c.summary}`).join('\n')}\n`
          : '';
        // 全部话的计划 → 让这一话知道自己该讲哪件、不越界
        const planList = plannedChapters.map((p, pi) => `${pi + 1}. ${p.title} —— ${p.gist}`).join('\n');
        const detailPrompt = `为连载「${series.title}」的季 "${arc.title}"（${arc.premise}）写第 ${i + 1} 话（共 ${N} 话）。${priorBlock}${writtenBlock}\n\n本季各话规划（你只写第 ${i + 1} 话，别的不要写）：\n${planList}\n\n剧情总纲：${plotOutline}${conflictsBlock}${worldBlock}\n\n本话要做的事：${planned.gist}\n\n请只输出第 ${i + 1} 话的 chapter。话标题禁止包含「章/卷/话/页」等结构字。${CHAPTER_CAPACITY_RULE}`;
        const one = await callStructuredJson<{ chapter: { title: string; summary: string; pageCount: number } }>(
          detailPrompt,
          '你是一位漫画编剧。请输出严格的 JSON 格式。',
          ChapterDetailSchema as Record<string, unknown>,
          {
            dnaKey,
            logKind: 'arc-chapter-body',
            logMeta: { seriesId: series.id, arcId: arc.id, chapterIndex: i + 1 },
            // 单话 —— 与「扩写下一话」同量级，5 分钟够
            timeoutMs: 300000,
            validate: raw => {
              const v = z.object({ chapter: z.object({ title: z.string().min(1), summary: z.string().min(1), pageCount: z.number().int().min(BATCHES_PER_EPISODE_MIN).max(BATCHES_PER_EPISODE_MAX) }) }).parse(raw);
              // 2026-10-20：容量不足时**自动降到写得起的档位**（3 批 → 2 批），
              // 而不是作废重做。换模型后实测：写得短的模型每话都要重试，
              // 但它写出的长度撑 12 格完全够 —— 该调整的是格数，不是内容。
              const fitted = fitPageCount(v.chapter.summary, v.chapter.pageCount);
              if (fitted === null) {
                // 连 2 批都撑不住 → 真的写太少，让模型重写
                throw new Error(checkChapterCapacity(v.chapter.summary, BATCHES_PER_EPISODE_MIN)!);
              }
              if (fitted !== v.chapter.pageCount) {
                console.log(
                  `[arc-chapters] summary ${v.chapter.summary.length} 字撑不起 ${v.chapter.pageCount} 批，`
                  + `自动降为 ${fitted} 批（${fitted * PANELS_PER_BATCH} 格）`,
                );
                v.chapter.pageCount = fitted;
              }
              return v;
            },
            onProgress: (attempt, total) => {
              setTaskProgress(tid, Math.round(base + (attempt / total) * step));
            },
            // 单话一次尝试就要 60~120 秒，只在开始时报一次的话进度条会死守不动
            heartbeat: { from: base, to: base + step * 0.9, durationMs: 150000 },
            onHeartbeatStart: (h) => startTaskHeartbeat(tid, h.from, h.to, h.durationMs),
          },
        );
        written.push(one.chapter);
        setTaskProgress(tid, Math.round(base + step));
        console.log(`[arc-chapters] 第 ${i + 1}/${N} 话完成`);
      }
      setTaskProgress(tid, 99);
      const chapters: Chapter[] = written.map(ch => ({
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
      setTaskProgress(tid, 100);
      return { arc, chapters: appended };
    });
  } catch (e: any) {
    if (e instanceof DuplicateTaskError) {
      return sendError(res, 409, '本季正在生成话目，请等它跑完（通常 5~10 分钟）——不用重复点击。');
    }
    return sendError(res, 500, e.message || 'Chapter generation failed');
  }
  res.json({ taskId });
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
  // 2026-10-16：原先默认 4、上限 8，但发出去的 JSON schema 只允许 2-3，
  // prompt 说「4 个批次」而 schema 拒绝 4 —— 每次点「扩写下一章」都可能整轮失败。
  const targetPages = Math.max(
    BATCHES_PER_EPISODE_MIN,
    Math.min(BATCHES_PER_EPISODE_MAX, Number(req.body?.pageCount) || BATCHES_PER_EPISODE_MAX),
  );
  const hint = String(req.body?.hint ?? '').trim().slice(0, 2000) || undefined;
  // 2026-10-16：同 generate-chapters 改走 task 队列（实测单话也要 60~120s）。
  let taskId: string;
  try {
    taskId = runTask(`append-chapter:${arc.id}`, 'append-chapter', async (tid) => {
      const w = series.worldview!;
      const priorChapters = arc.chapters;
      const priorBlock = priorChapters.length > 0
        ? `\n\n本季已生成话目（不要重复，直接续写）：\n${priorChapters.map(c => `- ${c.title}：${c.summary}`).join('\n')}\n`
        : '';
      const priorArcs = (series.arcs ?? []).filter(a => a.index < arc.index);
      const priorArcsBlock = priorArcs.length > 0
        ? `\n\n前季剧情：\n${priorArcs.map(a => `【${a.title}】\n${a.chapters.map(c => `- ${c.title}：${c.summary}`).join('\n')}`).join('\n\n')}\n`
        : '';
      const prompt = `为连载「${series.title}」的 "${arc.title}"（${arc.premise}）续写下一话。${priorArcsBlock}${priorBlock}\n\n世界观：\n时代：${w.era}\n背景：${w.background}\n风格：${w.artStyle}\n\n故事简介：${series.logline}\n\n角色：${series.characters.map(c => `${c.name}（${c.role}）`).join('、')}\n\n请只输出一个 chapter（${targetPages} 个内部批次，每批 ${PANELS_PER_BATCH} 格），summary 必须承接上一话结尾自然推进剧情。话标题禁止包含「章/卷/话/页」等结构字。${hint ? `\n\n用户修改意见：${hint}` : ''}${CHAPTER_CAPACITY_RULE}`;
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
                pageCount: { type: 'integer', minimum: BATCHES_PER_EPISODE_MIN, maximum: BATCHES_PER_EPISODE_MAX },
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
          timeoutMs: 300000,
          onProgress: (attempt, total, phase) => {
            setTaskProgress(tid, Math.round((attempt / total) * 100));
            console.log(`[append-chapter] progress ${Math.round((attempt / total) * 100)}% (${phase})`);
          },
          heartbeat: { from: 0, to: 49, durationMs: 150000 },
          onHeartbeatStart: (h) => startTaskHeartbeat(tid, h.from, h.to, h.durationMs),
          validate: raw => {
            const v = z.object({ chapter: z.object({ title: z.string().min(1), summary: z.string().min(1), pageCount: z.number().int().min(BATCHES_PER_EPISODE_MIN).max(BATCHES_PER_EPISODE_MAX) }) }).parse(raw);
            // 2026-10-20：容量不足时自动降到写得起的档位（见 fitPageCount 注释）
            const fitted = fitPageCount(v.chapter.summary, v.chapter.pageCount);
            if (fitted === null) {
              throw new Error(checkChapterCapacity(v.chapter.summary, BATCHES_PER_EPISODE_MIN)!);
            }
            if (fitted !== v.chapter.pageCount) {
              console.log(
                `[append-chapter] summary ${v.chapter.summary.length} 字撑不起 ${v.chapter.pageCount} 批，`
                + `自动降为 ${fitted} 批（${fitted * PANELS_PER_BATCH} 格）`,
              );
              v.chapter.pageCount = fitted;
            }
            return v;
          },
        },
      );
      setTaskProgress(tid, 99);
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
      setTaskProgress(tid, 100);
      return { arc, chapter: appended?.[0] ?? null };
    });
  } catch (e: any) {
    if (e instanceof DuplicateTaskError) {
      return sendError(res, 409, '本季正在生成下一话，请等它跑完（通常 1~3 分钟）——不用重复点击。');
    }
    return sendError(res, 500, e.message || 'Append chapter failed');
  }
  res.json({ taskId });
});

// 手动编辑：保存 chapter 元数据（标题/剧情摘要/核心冲突/预计页数）
const UpdateChapterSchema = z.object({
  title: z.string().min(1).optional(),
  summary: z.string().optional(),
  conflict: z.string().optional(),
  // 2026-10-16：手动编辑也要受同一条规则约束。
  // 此前是 2-8，等于用户能设出 48 格容量，而没有任何校验管得住 ——
  // 「12-18 格」这个目标只对 AI 生效、对人不生效，是典型的不自洽。
  pageCount: z.number().int().min(BATCHES_PER_EPISODE_MIN).max(BATCHES_PER_EPISODE_MAX).optional(),
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

// -------- 重新规划一话（2026-10-16 新增） --------
//
// 为什么需要它：三个生成端点（生成本季 / 扩写下一章 / 兼容旧端点）全是**新建**，
// 没有任何入口能改写已经存在的某一话。但用户真正反复要做的恰恰是这一件：
// 「这一话太平了，重新给我一版有张力的」。
//
// 两条不能越过的线：
//  1. 不静默丢用户已经出好的图。pageCount 变大就补空批次；变小也不删已有批次，
//     而是把 pageCount 抬回实际批次数，并如实告诉用户。
//  2. 重新规划后，老分镜与新剧情不再对应。返回 stalePanels 让界面明确提示，
//     不能让用户以为那些图还是照着新剧情画的。
router.post('/series/:id/chapters/:chapterId/replan', async (req, res) => {
  const series = getSeries(req.params.id);
  if (!series) return sendError(res, 404, 'Series not found');
  if (!series.worldview) return sendError(res, 400, '请先生成世界观');
  if (series.characters.length === 0) return sendError(res, 400, '请先生成角色');
  const arc = (series.arcs ?? []).find(a => a.chapters.some(c => c.id === req.params.chapterId));
  if (!arc) return sendError(res, 404, 'Chapter not found');
  const chapter = arc.chapters.find(c => c.id === req.params.chapterId)!;
  const dnaKey = seriesDnaKey(series);
  const hint = String(req.body?.hint ?? '').trim().slice(0, 2000) || undefined;
  const keepTitle = req.body?.keepTitle !== false;
  // 2026-10-16：同另两个端点改走 task 队列（实测 62~116s）。
  let taskId: string;
  try {
    taskId = runTask(`replan-chapter:${chapter.id}`, 'replan-chapter', async (tid) => {
      const notes: string[] = [];
      const w = series.worldview!;
      const siblings = arc.chapters.filter(c => c.id !== chapter.id);
      const otherBlock = siblings.length > 0
        ? `\n\n本季其他话（不要重复它们那件事）：\n${siblings.map(c => `- ${c.title}：${c.summary}`).join('\n')}\n`
        : '';
      const prevChapters = arc.chapters.slice(0, arc.chapters.indexOf(chapter));
      const prevBlock = prevChapters.length > 0
        ? `\n\n本话之前已发生（作为前情，不要重复）：\n${prevChapters.map(c => `- ${c.title}：${c.summary}`).join('\n')}\n`
        : '';
      const prompt = `为连载「${series.title}」重新规划其中一话。${otherBlock}${prevBlock}
这一话现在叫「${chapter.title}」，当前剧情概要（**太弱，要推倒重写，不要在它基础上小修小补**）：\n${chapter.summary}

世界观：\n时代：${w.era}\n背景：${w.background}\n风格：${w.artStyle}
故事简介：${series.logline}
角色：${series.characters.map(c => `${c.name}（${c.role}）`).join('、')}

请只输出一个 chapter（${BATCHES_PER_EPISODE_MIN}-${BATCHES_PER_EPISODE_MAX} 个内部批次，每批 ${PANELS_PER_BATCH} 格）。
${keepTitle ? `话标题沿用「${chapter.title}」，不要改。` : '话标题可重新拟定（2-8 字，禁止包含「章/卷/话/页」等结构字）。'}
summary 必须满足下面全部要求：
${CHAPTER_CAPACITY_RULE}
${hint ? `\n用户修改意见：${hint}` : ''}`;
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
                summary: { type: 'string', description: `必须能拆出恰好 pageCount×${PANELS_PER_BATCH} 个画面点，每点一句话，有戏剧张力，结尾留未解决的悬念` },
                pageCount: { type: 'integer', minimum: BATCHES_PER_EPISODE_MIN, maximum: BATCHES_PER_EPISODE_MAX },
              },
              required: ['title', 'summary', 'pageCount'],
            },
          },
          required: ['chapter'],
        } as Record<string, unknown>,
        {
          dnaKey,
          logKind: 'replan-chapter',
          logMeta: { seriesId: series.id, arcId: arc.id, chapterId: chapter.id },
          timeoutMs: 300000,
          onProgress: (attempt, total, phase) => {
            setTaskProgress(tid, Math.round((attempt / total) * 100));
            console.log(`[replan-chapter] progress ${Math.round((attempt / total) * 100)}% (${phase})`);
          },
          heartbeat: { from: 0, to: 49, durationMs: 150000 },
          onHeartbeatStart: (h) => startTaskHeartbeat(tid, h.from, h.to, h.durationMs),
          validate: raw => {
            const v = z.object({ chapter: z.object({
              title: z.string().min(1),
              summary: z.string().min(1),
              pageCount: z.number().int().min(BATCHES_PER_EPISODE_MIN).max(BATCHES_PER_EPISODE_MAX),
            }) }).parse(raw);
            const problem = checkChapterCapacity(v.chapter.summary, v.chapter.pageCount);
            if (problem) throw new Error(problem);
            return v;
          },
        },
      );
      setTaskProgress(tid, 99);
      const next = result.chapter;
      const oldPanels = chapter.pages.reduce((n, p) => n + p.panels.filter(x => x.imageUrl).length, 0);
      const pages = [...chapter.pages];
      // 变大 → 补空批次；变小 → 不删已有批次（那里面有用户已经付过钱的图）
      while (pages.length < next.pageCount) {
        pages.push({
          id: crypto.randomUUID(),
          pageNumber: pages.length + 1,
          title: `第 ${pages.length + 1} 批`,
          sceneDescription: '',
          panels: [],
          characterIds: [],
          status: 'draft' as const,
        });
      }
      if (pages.length !== next.pageCount) {
        notes.push(`保留了你已拆解的 ${pages.length} 个批次（不删除已有分镜），实际容量按 ${pages.length} 批计。`);
      }
      if (oldPanels > 0) {
        notes.push(`这一话已有 ${oldPanels} 格分镜图，它们是照着**旧剧情**画的，重新规划后需要重新拆解才会与新剧情对上。`);
      }
      // 2026-10-16：过密只提示不拦截（加严会把用户重新推进「反复报错、停滞不前」）。
      const density = checkChapterDensity(next.summary, pages.length);
      if (density) notes.push(density);
      const updated = updateChapter(series.id, chapter.id, {
        title: keepTitle ? chapter.title : next.title,
        summary: next.summary,
        pageCount: pages.length,
        pages,
      });
      setTaskProgress(tid, 100);
      return { chapter: updated, notes, stalePanels: oldPanels };
    });
  } catch (e: any) {
    if (e instanceof DuplicateTaskError) {
      return sendError(res, 409, '这一话正在重新规划，请等它跑完（通常 1~3 分钟）——不用重复点击。');
    }
    return sendError(res, 500, e.message || 'Replan failed');
  }
  res.json({ taskId });
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
  // 2026-10-16：话数由模型决定（1-8），原先这里直接要求 pageCount 之和严格等于本值，
  // 模型若选 8 话（最少 16 批）就永远达不到 12 → 只能编或被拒。
  // 改成夹进「1-8 话各自可达」的区间，并且不再要求严格相等。
  const targetPageCount = feasibleTotalBatches(Number(req.body?.targetPageCount ?? 12), undefined, 1, 8);
  try {
    const plotOutline = series.worldview.plotOutline ?? series.worldview.background;
    const conflicts = series.worldview.conflicts ?? [];
    const outlineBlock = `\n\n剧情大纲（按此切话目，**禁止自己重新编剧情**，只做"分段 + 配批"）：\n${plotOutline}`;
    const conflictsBlock = conflicts.length > 0 ? `\n核心矛盾：${conflicts.join('；')}` : '';
    const prompt = `基于以下漫画设定，把剧情大纲拆分成话目。${outlineBlock}${conflictsBlock}\n\n世界观：\n时代：${series.worldview.era}\n背景：${series.worldview.background}\n\n故事简介：${series.logline}\n\n角色：${series.characters.map(c => `${c.name}（${c.role}）`).join('、')}\n\n目标总规模：约 ${targetPageCount} 批（每批 ${PANELS_PER_BATCH} 格，每话 ${BATCHES_PER_EPISODE_MIN}-${BATCHES_PER_EPISODE_MAX} 批 = ${PANELS_PER_EPISODE_MIN}-${PANELS_PER_EPISODE_MAX} 格）。请把剧情大纲对应切分成若干话（每话 ${BATCHES_PER_EPISODE_MIN}-${BATCHES_PER_EPISODE_MAX} 批），话标题禁止包含「章/卷/话/页」等结构字；话标题与 summary 必须与剧情大纲的对应段保持一致；pageCount 之和尽量接近 ${targetPageCount}（话数你自己定，每话 2-3 批，先定话数再分配批次）。${CHAPTER_CAPACITY_RULE}`;
    const result = await callStructuredJson<z.infer<typeof ChapterListZ>>(
      prompt,
      '你是一位漫画编剧。请输出严格的 JSON 格式。',
      ChaptersSchema as Record<string, unknown>,
      {
        dnaKey,
        logKind: 'chapters',
        logMeta: { seriesId: series.id, targetPageCount },
        validate: raw => validateChapterCapacity(ChapterListZ.parse(raw)),
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
