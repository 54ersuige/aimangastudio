/**
 * 系列创作业务路由（5 步创作流程 + 自然语言改写 + 续写）。
 *
 * 本轮架构修复要点：
 *   - P1-5 反馈闭环：worldview/characters/generate 接收可选 hint（用户修改意见），
 *     连同上一版内容一起注入 prompt —— 此前用户的意见被直接丢弃，重生成只是重掷骰子；
 *   - P1-6 任务模型：图片密集型端点立即返回 taskId，后台执行，前端轮询
 *     GET /api/tasks/:id —— 此前单请求串行出 8 格图最长十几分钟，必然被链路超时掐断；
 *   - P1-8 输出校验：模型 JSON 输出经 zod 校验；幻觉角色 ID 过滤并告警
 *     （此前静默跳过导致该分镜无参考图、角色一致性无声失效）；分镜 index 规整为连续；
 *   - P2-9 跨章上下文：breakdown/continue 统一用「全局页游标」收集最近 3 页（跨章），
 *     修复章节边界处剧情断裂；
 *   - P2-13 角色合并保护：重生成只替换 AI 角色，手工添加的角色（source=manual）保留，
 *     同名 AI 角色复用原 ID 以维持既有分镜引用；
 *   - 图片落盘：生图结果写入 data/images/，JSON 只存路径（配合 series-store 迁移）；
 *   - 生成审计：每次文/图生成的完整 prompt 落盘 logs/generations.jsonl。
 */
import { Router } from 'express';
import { z } from 'zod';
import { getConfig } from './config.js';
import * as agnes from './providers/agnes.js';
import * as deepseek from './providers/deepseek.js';
import * as gemini from './providers/gemini.js';
import * as step from './providers/step.js';
import * as minimax from './providers/minimax.js';
import * as openaiCompatible from './providers/openai-compatible.js';
import type { TextRequest, ImageRequest } from './utils.js';
import { sendError, logGeneration } from './utils.js';
import { withDnaImagePrompt, withDnaTextPrompt } from './dna-inject.js';
import { runTask, getTask, DuplicateTaskError } from './task-queue.js';
import { saveDataUrlImage, resolveImageData } from './image-store.js';
import {
  listSeries,
  getSeries,
  createSeries,
  updateSeries,
  deleteSeries,
  addCharacter,
  updateCharacter,
  removeCharacter,
  setChapters,
  updatePage,
} from './series-store.js';
import type {
  Worldview,
  Series,
  SeriesCharacter,
  Chapter,
  Panel,
  SeriesPage,
} from './series-store.js';
import type { DnaKey } from '../shared/types.js';
import { getDna, isValidDnaKey as isValidDnaKeyStrict, DNA_KEYS } from './dna/registry.js';

const router = Router();

function getTextProvider(config: { provider: string }) {
  switch (config.provider) {
    case 'gemini': return gemini;
    case 'agnes': return agnes;
    case 'deepseek': return deepseek;
    case 'openai-compatible': return openaiCompatible;
    default: throw new Error(`Unsupported text provider: ${config.provider}`);
  }
}

function getImageProvider(config: { provider: string }) {
  switch (config.provider) {
    case 'gemini': return gemini;
    case 'step': return step;
    case 'minimax': return minimax;
    case 'agnes': return agnes;
    case 'openai-compatible': return openaiCompatible;
    default: throw new Error(`Unsupported image provider: ${config.provider}`);
  }
}

type ModelConfigForText = ReturnType<typeof getConfig>['text'];
type ModelConfigForImage = ReturnType<typeof getConfig>['image'];

// ── 结构化 JSON 调用（带 zod 输出校验）────────────────────────────────────

async function callStructuredJson<T>(
  prompt: string,
  systemInstruction: string,
  schema: Record<string, unknown>,
  opts: {
    dnaKey: DnaKey;
    temperature?: number;
    validate?: (raw: unknown) => T;
    logKind?: string;
    logMeta?: Record<string, unknown>;
  },
): Promise<T> {
  const config = getConfig().text;
  const provider = getTextProvider(config);
  const req: TextRequest = withDnaTextPrompt({
    prompt,
    systemInstruction,
    jsonMode: true,
    jsonSchema: schema,
    temperature: opts.temperature,
  }, { dnaKey: opts.dnaKey });
  logGeneration(opts.logKind || 'structured-text', { model: config.model, prompt, systemInstruction, dnaKey: opts.dnaKey, ...opts.logMeta });
  const result = await provider.generateText(config, req);
  const cleaned = result.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`模型输出不是合法 JSON：${cleaned.slice(0, 200)}…`);
  }
  if (opts.validate) {
    try {
      return opts.validate(parsed);
    } catch (e: any) {
      throw new Error(`模型输出未通过校验：${e.message}`);
    }
  }
  return parsed as T;
}

// ── 模型输出 zod 校验器 ──────────────────────────────────────────────────

const WorldviewZ = z.object({
  summary: z.string().min(1),
  background: z.string().min(1),
  era: z.string().min(1),
  artStyle: z.string().min(1),
  paletteMood: z.string().min(1),
});

const CharacterListZ = z.object({
  characters: z.array(z.object({
    name: z.string().min(1),
    role: z.enum(['protagonist', 'antagonist', 'supporting']),
    description: z.string().default(''),
    appearance: z.string().min(1),
    voiceTone: z.string().default(''),
  })).min(1).max(6),
});

const ChapterListZ = z.object({
  chapters: z.array(z.object({
    title: z.string().min(1),
    summary: z.string().default(''),
    pageCount: z.number().int().min(1).max(12),
  })).min(1).max(8),
});

const PanelBreakdownZ = z.object({
  title: z.string().default(''),
  sceneDescription: z.string().default(''),
  panels: z.array(z.object({
    index: z.number().int(),
    description: z.string().min(1),
    dialogue: z.string().optional().default(''),
    characterIds: z.array(z.string()).optional().default([]),
  })).min(1).max(8),
});

const PanelRewriteZ = z.object({
  description: z.string().min(1),
  dialogue: z.string().optional().default(''),
  characterIds: z.array(z.string()).optional().default([]),
});

/**
 * 取系列的 DNA key —— 双重兜底：
 *  - series.dnaKey 应在启动迁移时已填默认值 'new-yorker-noir'
 *  - 路由层再校验一次，防止 series 字段被污染（错误 key → 立即抛错，
 *    不允许静默回退到默认 —— 那会让用户不知不觉切换风格）
 */
function seriesDnaKey(series: Series): DnaKey {
  const k = series.dnaKey;
  if (!k || !isValidDnaKeyStrict(k)) {
    throw new Error(`系列 ${series.id} 的 dnaKey 非法: "${k}"。请检查启动迁移逻辑。`);
  }
  return k;
}

/** DNA 禁用风格词（出现时仅告警，真正硬约束在生图 negative prompt）。 */
const FORBIDDEN_STYLE_WORDS = /日漫|二次元|赛博朋克|霓虹|高饱和|anime|manga|cyberpunk|neon|水彩|油画/i;

function warnStyleWords(where: string, text: string): void {
  if (FORBIDDEN_STYLE_WORDS.test(text)) {
    console.warn(`[series-routes] ${where} 输出中出现 DNA 禁用风格词（已记录，生图侧由 negative prompt 兜底）：${text}`);
  }
}

/**
 * 分镜后处理：过滤幻觉角色 ID、index 规整为 1..n 连续、去重。
 * 返回 null 表示没有可用分镜。
 */
function sanitizePanels(
  panels: { index: number; description: string; dialogue?: string; characterIds: string[] }[],
  validCharIds: Set<string>,
  logCtx: string,
): Panel[] | null {
  const usable = panels.filter(p => p.description && p.description.trim());
  if (usable.length === 0) return null;
  const sorted = [...usable].sort((a, b) => a.index - b.index);
  return sorted.map((p, i) => {
    const unique = Array.from(new Set(p.characterIds || []));
    const ok = unique.filter(id => validCharIds.has(id));
    if (ok.length < unique.length) {
      console.warn(`[series-routes] ${logCtx}：第 ${p.index} 格出现 ${unique.length - ok.length} 个幻觉角色 ID，已过滤：${unique.filter(id => !validCharIds.has(id)).join(',')}`);
    }
    return {
      index: i + 1,
      description: p.description.trim(),
      dialogue: (p.dialogue || '').trim(),
      characterIds: ok,
    };
  });
}

// ── 页面查找与跨章上下文 ─────────────────────────────────────────────────

function findPage(series: Series, pageId: string): { chapter: Chapter; page: SeriesPage } | null {
  for (const ch of series.chapters) {
    const p = ch.pages.find(pp => pp.id === pageId);
    if (p) return { chapter: ch, page: p };
  }
  return null;
}

/**
 * 全局页游标：按全系列顺序收集目标页之前（可选含目标页）的最近 count 页，
 * 跨章节边界 —— 修复「续写时上一章结尾不在上下文」「breakdown 对前文一无所知」。
 */
function buildRecentContext(series: Series, pageId: string, includeTarget: boolean, count = 3): string {
  const flat: { ch: Chapter; p: SeriesPage }[] = [];
  for (const ch of series.chapters) for (const p of ch.pages) flat.push({ ch, p });
  const idx = flat.findIndex(x => x.p.id === pageId);
  if (idx < 0) return '';
  const end = includeTarget ? idx + 1 : idx;
  const slice = flat.slice(Math.max(0, end - count), end).filter(x => x.p.panels.length > 0);
  if (slice.length === 0) return '（这是故事的开头，没有前文。）';
  return slice.map(x =>
    `第 ${x.p.pageNumber} 页（${x.ch.title}）：${x.p.title}\n` +
    `场景：${x.p.sceneDescription}\n` +
    `分镜：\n${x.p.panels.map(pn => `  ${pn.index}. ${pn.description}${pn.dialogue ? `（对白："${pn.dialogue}"）` : ''}`).join('\n')}`
  ).join('\n\n');
}

// ── 分镜出图（generate / regenerate / rewrite 共用）──────────────────────

async function generatePanelImages(
  series: Series,
  sceneDescription: string,
  panels: Panel[],
  logCtx: string,
  dnaKey: DnaKey,
): Promise<string[]> {
  // 世界观是分镜出图的硬前置 —— 画风 artStyle / paletteMood 由世界观提供。
  // 调用方（生成/重生成/续写整页）已确保 worldview 存在；这里再兜底一次以防路由层后续改动遗漏。
  if (!series.worldview) {
    throw new Error('请先生成世界观，再出图');
  }
  const config = getConfig().image;
  const imageProvider = getImageProvider(config);
  const style = series.worldview.artStyle;
  const mood = series.worldview.paletteMood;
  const charMap = new Map(series.characters.map(c => [c.id, c]));
  const sorted = [...panels].sort((a, b) => a.index - b.index);
  const paths: string[] = [];
  for (const panel of sorted) {
    const refImages: { data: string; mimeType: string }[] = [];
    const charDescs: string[] = [];
    for (const charId of panel.characterIds) {
      const c = charMap.get(charId);
      if (!c) continue;
      charDescs.push(`- ${c.name}：${c.appearance}`);
      const data = resolveImageData(c.referenceImage);
      if (data) refImages.push({ data, mimeType: 'image/png' });
    }
    const charText = charDescs.length > 0 ? `\n出场角色（参考图已提供）：\n${charDescs.join('\n')}` : '';
    const dialogueText = panel.dialogue ? `\n对白/旁白："${panel.dialogue}"` : '';
    const prompt = `单幅画面（standalone illustration，禁止多格拼接）。画风与色调遵循前述系统规范；系列基调参考：${style}，${mood}（若与系统规范冲突，以系统规范为准）。\n场景：${sceneDescription}\n画面内容：${panel.description}${charText}${dialogueText}\n要求：单人单场景，画面聚焦于这一格的描述内容；如有人物，必须严格按参考图的脸部/服装/发型/年龄特征绘制；不要输出多格拼接图，不要输出页边距文字水印。`;
    const img = await imageProvider.generateImage(config, withDnaImagePrompt({
      prompt,
      referenceImages: refImages.length > 0 ? refImages : undefined,
      aspectRatio: '3:4',
    }, { dnaKey }));
    logGeneration('panel-image', { seriesId: series.id, ctx: logCtx, model: config.model, prompt, dnaKey });
    // 图片落盘，JSON 只存路径
    paths.push(saveDataUrlImage(img.image));
  }
  return paths;
}

// ========== 系列 CRUD ==========

router.get('/series', (_req, res) => {
  res.json({ series: listSeries() });
});

router.post('/series', (req, res) => {
  const schema = z.object({
    title: z.string().min(1).max(100),
    logline: z.string().min(1).max(2000),
    /**
     * 创建系列时锁定的 DNA key。非法值会被 createSeries 内部降级到 config.dnaKey。
     * 创建后该字段在系列上冻结，不允许 PATCH 修改（防风格漂移）。
     */
    dnaKey: z.enum(DNA_KEYS as unknown as [DnaKey, ...DnaKey[]]).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, parsed.error.message);
  const series = createSeries(parsed.data as { title: string; logline: string; dnaKey?: string });
  res.json({ series });
});

router.get('/series/:id', (req, res) => {
  const series = getSeries(req.params.id);
  if (!series) return sendError(res, 404, 'Series not found');
  res.json({ series });
});

/**
 * PATCH 端点 —— 显式拒绝 style / dnaKey 字段。
 * 设计：dnaKey 在创建时冻结（防风格漂移）；style 字段已从 Series 整体移除。
 * 只允许改 title / logline 这类"项目元数据"。
 */
router.patch('/series/:id', (req, res) => {
  const schema = z.object({
    title: z.string().min(1).max(100).optional(),
    logline: z.string().min(1).max(2000).optional(),
  }).strict();
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, parsed.error.message);
  const series = updateSeries(req.params.id, parsed.data);
  if (!series) return sendError(res, 404, 'Series not found');
  res.json({ series });
});

router.delete('/series/:id', (req, res) => {
  const ok = deleteSeries(req.params.id);
  if (!ok) return sendError(res, 404, 'Series not found');
  res.json({ success: true });
});

// ========== 任务轮询（P1-6）==========

router.get('/tasks/:taskId', (req, res) => {
  const task = getTask(req.params.taskId);
  if (!task) return sendError(res, 404, '任务不存在（服务可能已重启），请重新发起生成');
  res.json({ task });
});

// ========== Step 1: 世界观 ==========

const WorldviewSchema = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: '一句话世界观简介' },
    background: { type: 'string', description: '世界背景故事，2-3 段' },
    era: { type: 'string', description: '时代设定，必须是现实当代或近代中国，如"2020 年代上海"' },
    artStyle: { type: 'string', description: '美术风格关键词，必须在系统规范内细化：New Yorker 单幅插画 × Adrian Tomine 都市写实细线 × 独立 Graphic Novel，如"New Yorker 式细线写实 + 大量留白"' },
    paletteMood: { type: 'string', description: '色调氛围，必须是暖色印刷感：如"奶油黄/燕麦底色 + 粉赭红棕点缀，低饱和"' },
  },
  required: ['summary', 'background', 'era', 'artStyle', 'paletteMood'],
} as const;

router.post('/series/:id/worldview/generate', async (req, res) => {
  const series = getSeries(req.params.id);
  if (!series) return sendError(res, 404, 'Series not found');
  const dnaKey = seriesDnaKey(series);
  const dna = getDna(dnaKey);
  // P1-5：接收用户对上一版的修改意见
  const bodySchema = z.object({ hint: z.string().max(2000).optional() });
  const body = bodySchema.safeParse(req.body || {});
  const hint = body.success ? body.data.hint?.trim() : undefined;
  try {
    const prevBlock = series.worldview
      ? `\n\n上一版世界观（用户要求在其基础上修改，不要推倒重来）：\n${JSON.stringify(series.worldview, null, 2)}\n`
      : '';
    const hintBlock = hint
      ? `\n\n用户对上一版的修改意见（本次生成必须逐条体现）：${hint}\n`
      : '';
    const prompt = `用户想创作的漫画：\n标题：${series.title}\n一句话简介：${series.logline}${prevBlock}${hintBlock}\n请根据这些信息设计一个详细的世界观设定。\n\n【画风硬约束】本系列画风已被系统 Art Direction 锁定为：${dna.VISUAL_DEFINITION.trim()}。你输出的 artStyle 与 paletteMood 必须在该范围内细化，严禁出现 ${dna.VISUAL_FORBIDDEN.slice(0, 8).join('、')} 等词。era 与世界观必须符合本系列的题材方向。`;
    const worldview = await callStructuredJson<Worldview>(
      prompt,
      '你是一位资深漫画编辑，擅长世界设定。请输出严格的 JSON 格式。',
      WorldviewSchema as Record<string, unknown>,
      {
        dnaKey,
        logKind: 'worldview',
        logMeta: { seriesId: series.id, hint },
        validate: (raw): Worldview => {
          const v = WorldviewZ.parse(raw);
          warnStyleWords('worldview artStyle', v.artStyle);
          warnStyleWords('worldview paletteMood', v.paletteMood);
          return v;
        },
      },
    );
    updateSeries(series.id, { worldview });
    res.json({ worldview });
  } catch (e: any) {
    sendError(res, 502, e.message || 'Worldview generation failed');
  }
});

// ========== Step 2: 角色 ==========

const CharacterSchema = {
  type: 'object',
  properties: {
    characters: {
      type: 'array',
      minItems: 1,
      maxItems: 6,
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          role: { type: 'string', enum: ['protagonist', 'antagonist', 'supporting'] },
          description: { type: 'string', description: '角色背景和性格，1-2 句' },
          appearance: { type: 'string', description: '外貌详细描述，用于 AI 生图，2-3 句' },
          voiceTone: { type: 'string', description: '说话风格，如"冷峻简洁"' },
        },
        required: ['name', 'role', 'description', 'appearance', 'voiceTone'],
      },
    },
  },
  required: ['characters'],
} as const;

router.post('/series/:id/characters/generate', async (req, res) => {
  const series = getSeries(req.params.id);
  if (!series) return sendError(res, 404, 'Series not found');
  if (!series.worldview) return sendError(res, 400, '请先生成世界观');
  const dnaKey = seriesDnaKey(series);
  const worldview = series.worldview; // 闭包内使用，收窄类型
  const bodySchema = z.object({ hint: z.string().max(2000).optional() });
  const body = bodySchema.safeParse(req.body || {});
  const hint = body.success ? body.data.hint?.trim() : undefined;

  // 每个角色要出参考图，整体耗时数分钟 —— 走后台任务
  let taskId: string;
  try {
    taskId = runTask(`series:${series.id}:characters`, 'characters-generate', async () => {
      try {
        const prevBlock = series.characters.filter(c => c.source !== 'manual').length > 0
          ? `\n\n上一版角色（用户要求在其基础上修改，同名角色尽量保持人设连续性）：\n${series.characters.map(c => `- ${c.name}（${c.role}）：${c.description} / 外貌：${c.appearance}`).join('\n')}\n`
          : '';
        const hintBlock = hint
          ? `\n\n用户对上一版的修改意见（本次生成必须逐条体现）：${hint}\n`
          : '';
        const prompt = `基于以下漫画设定，生成 3-4 个核心角色（必须包含 1 个主角、1-2 个配角、必要时 1 个反派）。${prevBlock}${hintBlock}\n世界观：\n时代：${worldview.era}\n背景：${worldview.background}\n风格：${worldview.artStyle}\n\n故事简介：${series.logline}`;
        const result = await callStructuredJson<z.infer<typeof CharacterListZ>>(
          prompt,
          '你是一位漫画角色设计师。请输出严格的 JSON 格式。',
          CharacterSchema as Record<string, unknown>,
          {
            dnaKey,
            logKind: 'characters',
            logMeta: { seriesId: series.id, hint },
            validate: raw => CharacterListZ.parse(raw),
          },
        );

        const config = getConfig().image;
        const imageProvider = getImageProvider(config);
        // P2-13：同名 AI 角色复用原 ID，维持既有分镜引用
        const oldAi = series.characters.filter(c => c.source !== 'manual');
        const idByName = new Map(oldAi.map(c => [c.name, c.id]));
        const generated: SeriesCharacter[] = [];
        for (const c of result.characters) {
          let referenceImage: string | undefined;
          try {
            const img = await imageProvider.generateImage(config, withDnaImagePrompt({
              prompt: `角色设定图：单人，${c.appearance}。画风与色调遵循前述系统规范；系列基调参考：${worldview.artStyle}，${worldview.paletteMood}（若与系统规范冲突，以系统规范为准）。`,
            }, { dnaKey }));
            logGeneration('character-image', { seriesId: series.id, character: c.name, model: config.model, dnaKey });
            referenceImage = saveDataUrlImage(img.image);
          } catch (imgErr: any) {
            console.warn(`[series-routes] 角色 ${c.name} 参考图生成失败（角色仍会保存）:`, imgErr.message);
          }
          generated.push({
            ...c,
            id: idByName.get(c.name) || crypto.randomUUID(),
            referenceImage,
            source: 'ai',
          });
        }
        // P2-13：只替换 AI 角色，手工添加的角色保留
        const manual = series.characters.filter(c => c.source === 'manual');
        const merged = [...generated, ...manual];
        updateSeries(series.id, { characters: merged });
        return { characters: merged };
      } catch (e: any) {
        throw new Error(e.message || 'Character generation failed');
      }
    });
  } catch (e: any) {
    if (e instanceof DuplicateTaskError) return sendError(res, 409, '角色正在生成中，请稍候');
    return sendError(res, 500, e.message || 'Failed to start task');
  }
  res.json({ taskId });
});

const AddCharacterSchema = z.object({
  name: z.string().min(1),
  role: z.enum(['protagonist', 'antagonist', 'supporting']),
  description: z.string().min(1),
  appearance: z.string().min(1),
  voiceTone: z.string().default(''),
  autoGenerateImage: z.boolean().default(true),
});

router.post('/series/:id/characters', async (req, res) => {
  const series = getSeries(req.params.id);
  if (!series) return sendError(res, 404, 'Series not found');
  const dnaKey = seriesDnaKey(series);
  const parsed = AddCharacterSchema.safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, parsed.error.message);
  const input = parsed.data;
  let referenceImage: string | undefined;
  if (input.autoGenerateImage) {
    // 手动添加角色时世界观可能尚未生成 —— 没有世界观就不带"系列基调参考"，由 DNA 接管画风。
    const style = series.worldview?.artStyle;
    const mood = series.worldview?.paletteMood;
    try {
      const config = getConfig().image;
      const imageProvider = getImageProvider(config);
      const styleMood = (style && mood) ? `系列基调参考：${style}，${mood}（若与系统规范冲突，以系统规范为准）。` : '';
      const prompt = `角色设定图：单人，${input.appearance}。画风与色调遵循前述系统规范；${styleMood}`;
      const img = await imageProvider.generateImage(config, withDnaImagePrompt({ prompt }, { dnaKey }));
      logGeneration('character-image', { seriesId: series.id, character: input.name, model: config.model, prompt, dnaKey });
      referenceImage = saveDataUrlImage(img.image);
    } catch (e: any) {
      console.warn('Auto image generation failed:', e.message);
    }
  }
  const character = addCharacter(series.id, {
    name: input.name,
    role: input.role,
    description: input.description,
    appearance: input.appearance,
    voiceTone: input.voiceTone,
    referenceImage,
    source: 'manual', // P2-13：手工添加的角色在 AI 重生成时保留
  });
  res.json({ character });
});

router.patch('/series/:id/characters/:characterId', (req, res) => {
  const series = getSeries(req.params.id);
  if (!series) return sendError(res, 404, 'Series not found');
  const schema = z.object({
    name: z.string().optional(),
    role: z.enum(['protagonist', 'antagonist', 'supporting']).optional(),
    description: z.string().optional(),
    appearance: z.string().optional(),
    voiceTone: z.string().optional(),
    referenceImage: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, parsed.error.message);
  const updated = updateCharacter(series.id, req.params.characterId, parsed.data);
  if (!updated) return sendError(res, 404, 'Character not found');
  res.json({ character: updated });
});

router.delete('/series/:id/characters/:characterId', (req, res) => {
  const series = getSeries(req.params.id);
  if (!series) return sendError(res, 404, 'Series not found');
  const ok = removeCharacter(series.id, req.params.characterId);
  if (!ok) return sendError(res, 404, 'Character not found');
  res.json({ success: true });
});

router.post('/series/:id/characters/:characterId/regenerate-image', async (req, res) => {
  const series = getSeries(req.params.id);
  if (!series) return sendError(res, 404, 'Series not found');
  const dnaKey = seriesDnaKey(series);
  const character = series.characters.find(c => c.id === req.params.characterId);
  if (!character) return sendError(res, 404, 'Character not found');
  let taskId: string;
  try {
    taskId = runTask(`character:${character.id}`, 'character-image', async () => {
      try {
        if (!series.worldview) throw new Error('请先生成世界观，再生成角色参考图');
        const config = getConfig().image;
        const imageProvider = getImageProvider(config);
        const style = series.worldview.artStyle;
        const mood = series.worldview.paletteMood;
        const prompt = `角色设定图：单人，${character.appearance}。画风与色调遵循前述系统规范；系列基调参考：${style}，${mood}（若与系统规范冲突，以系统规范为准）。`;
        const img = await imageProvider.generateImage(config, withDnaImagePrompt({ prompt }, { dnaKey }));
        logGeneration('character-image', { seriesId: series.id, character: character.name, model: config.model, prompt, dnaKey });
        const updated = updateCharacter(series.id, character.id, { referenceImage: saveDataUrlImage(img.image) });
        return { character: updated };
      } catch (e: any) {
        throw new Error(e.message || 'Image regeneration failed');
      }
    });
  } catch (e: any) {
    if (e instanceof DuplicateTaskError) return sendError(res, 409, '该角色参考图正在生成中');
    return sendError(res, 500, e.message || 'Failed to start task');
  }
  res.json({ taskId });
});

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
          title: { type: 'string', description: '章节标题，如"第一章 觉醒"' },
          summary: { type: 'string', description: '本章剧情概要，2-3 句' },
          pageCount: { type: 'integer', minimum: 1, maximum: 12, description: '本章页数' },
        },
        required: ['title', 'summary', 'pageCount'],
      },
    },
  },
  required: ['chapters'],
} as const;

router.post('/series/:id/chapters/generate', async (req, res) => {
  const series = getSeries(req.params.id);
  if (!series) return sendError(res, 404, 'Series not found');
  if (!series.worldview) return sendError(res, 400, '请先生成世界观');
  if (series.characters.length === 0) return sendError(res, 400, '请先生成角色');
  const dnaKey = seriesDnaKey(series);
  const targetPageCount = Math.max(4, Math.min(60, Number(req.body?.targetPageCount || 12)));
  try {
    const prompt = `基于以下漫画设定，把故事拆分成章节和页面。\n\n世界观：\n时代：${series.worldview.era}\n背景：${series.worldview.background}\n\n故事简介：${series.logline}\n\n角色：${series.characters.map(c => `${c.name}（${c.role}）`).join('、')}\n\n目标总页数：约 ${targetPageCount} 页。请合理拆分章节。`;
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
    // 构造 Chapter 与空 Page（页码由 setChapters 全局连续编号）
    const chapters: Chapter[] = result.chapters.map(ch => ({
      id: crypto.randomUUID(),
      title: ch.title,
      summary: ch.summary,
      pageCount: ch.pageCount,
      pages: Array.from({ length: ch.pageCount }, (_, i) => ({
        id: crypto.randomUUID(),
        pageNumber: i + 1,
        title: `第 ${i + 1} 页`,
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

// ========== Step 4: 单页分镜 + 页面生成 ==========

const PanelBreakdownSchema = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    sceneDescription: { type: 'string', description: '本页整体场景描述，1-2 句' },
    panels: {
      type: 'array',
      minItems: 2,
      maxItems: 8,
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer' },
          description: { type: 'string', description: '单格画面描述' },
          dialogue: { type: 'string', description: '对白或旁白，无则空字符串' },
          characterIds: {
            type: 'array',
            items: { type: 'string' },
            description: '出场角色 ID 列表',
          },
        },
        required: ['index', 'description', 'characterIds'],
      },
    },
  },
  required: ['title', 'sceneDescription', 'panels'],
} as const;

router.post('/series/:id/pages/:pageId/breakdown', async (req, res) => {
  const series = getSeries(req.params.id);
  if (!series) return sendError(res, 404, 'Series not found');
  const found = findPage(series, req.params.pageId);
  if (!found) return sendError(res, 404, 'Page not found');
  const dnaKey = seriesDnaKey(series);
  const { chapter: targetChapter, page: targetPage } = found;
  try {
    // P2-9：跨章收集最近 3 页前文，AI 不再对之前发生的事一无所知
    const recentContext = buildRecentContext(series, targetPage.id, false, 3);
    const prompt = `为以下漫画页面拆出 2-8 个分镜。\n\n系列：${series.title}\n世界观：${series.worldview?.era} / ${series.worldview?.artStyle}\n章节：${targetChapter.title} - ${targetChapter.summary}\n\n角色库：\n${series.characters.map(c => `- id=${c.id} 名字=${c.name}（${c.role}）外貌=${c.appearance}`).join('\n')}\n\n前文剧情（保持连续，不要重复已发生的情节）：\n${recentContext}\n\n当前页：第 ${targetPage.pageNumber} 页（这是"${targetChapter.title}"中的内容）\n请把这一页拆成 2-8 个分镜，每个分镜必须指定出场的角色 ID。`;
    const result = await callStructuredJson<z.infer<typeof PanelBreakdownZ>>(
      prompt,
      '你是一位漫画分镜师。请输出严格的 JSON 格式。',
      PanelBreakdownSchema as Record<string, unknown>,
      {
        dnaKey,
        logKind: 'breakdown',
        logMeta: { seriesId: series.id, pageId: targetPage.id },
        validate: raw => PanelBreakdownZ.parse(raw),
      },
    );
    // P1-8：幻觉角色 ID 过滤 + index 规整
    const validIds = new Set(series.characters.map(c => c.id));
    const panels = sanitizePanels(result.panels, validIds, `breakdown 第${targetPage.pageNumber}页`);
    if (!panels) return sendError(res, 502, '模型未返回有效分镜，请重试');
    const allCharIds = new Set<string>();
    panels.forEach(p => p.characterIds.forEach(id => allCharIds.add(id)));
    const updated = updatePage(series.id, targetChapter.id, targetPage.id, {
      title: result.title || targetPage.title,
      sceneDescription: result.sceneDescription,
      panels,
      characterIds: Array.from(allCharIds),
    });
    res.json({ page: updated });
  } catch (e: any) {
    sendError(res, 502, e.message || 'Page breakdown failed');
  }
});

router.post('/series/:id/pages/:pageId/generate', async (req, res) => {
  const series = getSeries(req.params.id);
  if (!series) return sendError(res, 404, 'Series not found');
  const found = findPage(series, req.params.pageId);
  if (!found) return sendError(res, 404, 'Page not found');
  const dnaKey = seriesDnaKey(series);
  const { chapter: targetChapter, page: targetPage } = found;
  if (targetPage.panels.length === 0) return sendError(res, 400, '请先生成分镜');
  if (targetPage.status === 'generating') return sendError(res, 409, '该页正在生成中，请稍候');
  // 同步置为 generating：利用单线程原子性挡住并发重复点击
  updatePage(series.id, targetChapter.id, targetPage.id, { status: 'generating', errorMessage: undefined });

  let taskId: string;
  try {
    taskId = runTask(`page:${targetPage.id}`, 'page-generate', async () => {
      try {
        const paths = await generatePanelImages(series, targetPage.sceneDescription, targetPage.panels, `generate 第${targetPage.pageNumber}页`, dnaKey);
        const updatedPanels = [...targetPage.panels]
          .sort((a, b) => a.index - b.index)
          .map((p, i) => ({ ...p, imageUrl: paths[i] }));
        const updated = updatePage(series.id, targetChapter.id, targetPage.id, {
          panels: updatedPanels,
          status: 'done',
        });
        return { page: updated };
      } catch (e: any) {
        updatePage(series.id, targetChapter.id, targetPage.id, { status: 'error', errorMessage: e.message });
        throw e;
      }
    });
  } catch (e: any) {
    if (e instanceof DuplicateTaskError) {
      return sendError(res, 409, '该页正在生成中，请稍候');
    }
    updatePage(series.id, targetChapter.id, targetPage.id, { status: 'error', errorMessage: e.message });
    return sendError(res, 500, e.message || 'Failed to start task');
  }
  res.json({ taskId });
});

// 单个分镜重生（整页重画）
router.post('/series/:id/pages/:pageId/regenerate', async (req, res) => {
  const series = getSeries(req.params.id);
  if (!series) return sendError(res, 404, 'Series not found');
  const found = findPage(series, req.params.pageId);
  if (!found) return sendError(res, 404, 'Page not found');
  const dnaKey = seriesDnaKey(series);
  const { chapter: targetChapter, page: targetPage } = found;
  if (targetPage.panels.length === 0) return sendError(res, 400, '请先生成分镜');
  if (targetPage.status === 'generating') return sendError(res, 409, '该页正在生成中，请稍候');
  updatePage(series.id, targetChapter.id, targetPage.id, { status: 'generating', errorMessage: undefined });

  let taskId: string;
  try {
    taskId = runTask(`page:${targetPage.id}`, 'page-regenerate', async () => {
      try {
        const paths = await generatePanelImages(series, targetPage.sceneDescription, targetPage.panels, `regenerate 第${targetPage.pageNumber}页`, dnaKey);
        const updatedPanels = [...targetPage.panels]
          .sort((a, b) => a.index - b.index)
          .map((p, i) => ({ ...p, imageUrl: paths[i] }));
        const updated = updatePage(series.id, targetChapter.id, targetPage.id, {
          panels: updatedPanels,
          status: 'done',
          errorMessage: undefined,
        });
        return { page: updated };
      } catch (e: any) {
        updatePage(series.id, targetChapter.id, targetPage.id, { status: 'error', errorMessage: e.message });
        throw e;
      }
    });
  } catch (e: any) {
    if (e instanceof DuplicateTaskError) {
      return sendError(res, 409, '该页正在生成中，请稍候');
    }
    updatePage(series.id, targetChapter.id, targetPage.id, { status: 'error', errorMessage: e.message });
    return sendError(res, 500, e.message || 'Failed to start task');
  }
  res.json({ taskId });
});

// ========== 自然语言改写单页 ==========

const PageRewriteSchema = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    sceneDescription: { type: 'string' },
    panels: {
      type: 'array',
      minItems: 2,
      maxItems: 8,
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer' },
          description: { type: 'string' },
          dialogue: { type: 'string' },
          characterIds: { type: 'array', items: { type: 'string' } },
        },
        required: ['index', 'description', 'characterIds'],
      },
    },
  },
  required: ['title', 'sceneDescription', 'panels'],
} as const;

router.post('/series/:id/pages/:pageId/rewrite', async (req, res) => {
  const series = getSeries(req.params.id);
  if (!series) return sendError(res, 404, 'Series not found');
  const found = findPage(series, req.params.pageId);
  if (!found) return sendError(res, 404, 'Page not found');
  const dnaKey = seriesDnaKey(series);
  const { chapter: targetChapter, page: targetPage } = found;

  const schema = z.object({
    instruction: z.string().min(1).max(2000),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, parsed.error.message);
  if (targetPage.status === 'generating') return sendError(res, 409, '该页正在生成中，请稍候');
  updatePage(series.id, targetChapter.id, targetPage.id, { status: 'generating', errorMessage: undefined });

  let taskId: string;
  try {
    taskId = runTask(`page:${targetPage.id}`, 'page-rewrite', async () => {
      try {
        // 1) 文字模型按用户指令重写分镜
        const rewritePrompt = `用户在修改第 ${targetPage.pageNumber} 页（章节：${targetChapter.title}）。\n\n用户原始内容：\n页标题：${targetPage.title}\n场景：${targetPage.sceneDescription}\n当前分镜：\n${targetPage.panels.map(p => `${p.index}. ${p.description}${p.dialogue ? `（对白："${p.dialogue}"）` : ''} → 角色：${p.characterIds.join(',') || '无'}`).join('\n')}\n\n用户的新指令：${parsed.data.instruction}\n\n请输出改写后的页面（保留原分镜数量或合理调整），characterIds 必须从下列 ID 中选：${series.characters.map(c => `${c.id}=${c.name}`).join('，')}。`;
        const rewritten = await callStructuredJson<z.infer<typeof PanelBreakdownZ>>(
          rewritePrompt,
          '你是一位漫画编剧。用户要修改当前页，请根据指令输出新的分镜描述。严格输出 JSON。',
          PageRewriteSchema as Record<string, unknown>,
          {
            dnaKey,
            temperature: 0.8,
            logKind: 'page-rewrite',
            logMeta: { seriesId: series.id, pageId: targetPage.id, instruction: parsed.data.instruction },
            validate: raw => PanelBreakdownZ.parse(raw),
          },
        );
        const validIds = new Set(series.characters.map(c => c.id));
        const panels = sanitizePanels(rewritten.panels, validIds, `rewrite 第${targetPage.pageNumber}页`);
        if (!panels) throw new Error('模型未返回有效分镜');
        const allCharIds = new Set<string>();
        panels.forEach(p => p.characterIds.forEach(id => allCharIds.add(id)));
        updatePage(series.id, targetChapter.id, targetPage.id, {
          title: rewritten.title || targetPage.title,
          sceneDescription: rewritten.sceneDescription,
          panels,
          characterIds: Array.from(allCharIds),
        });
        // 2) 按新分镜重新出图
        const fresh = getSeries(series.id);
        const freshFound = fresh ? findPage(fresh, targetPage.id) : null;
        if (!freshFound) throw new Error('页面数据丢失');
        const paths = await generatePanelImages(series, rewritten.sceneDescription, panels, `rewrite 第${targetPage.pageNumber}页`, dnaKey);
        const updatedPanels = [...panels]
          .sort((a, b) => a.index - b.index)
          .map((p, i) => ({ ...p, imageUrl: paths[i] }));
        const updated = updatePage(series.id, targetChapter.id, targetPage.id, {
          panels: updatedPanels,
          status: 'done',
        });
        return { page: updated };
      } catch (e: any) {
        updatePage(series.id, targetChapter.id, targetPage.id, { status: 'error', errorMessage: e.message });
        throw e;
      }
    });
  } catch (e: any) {
    if (e instanceof DuplicateTaskError) {
      updatePage(series.id, targetChapter.id, targetPage.id, { status: targetPage.status, errorMessage: undefined });
      return sendError(res, 409, '该页正在生成中，请稍候');
    }
    updatePage(series.id, targetChapter.id, targetPage.id, { status: 'error', errorMessage: e.message });
    return sendError(res, 500, e.message || 'Failed to start task');
  }
  res.json({ taskId });
});

// ========== 单分镜自然语言改写 ==========

const PanelRewriteSchema = {
  type: 'object',
  properties: {
    description: { type: 'string' },
    dialogue: { type: 'string' },
    characterIds: { type: 'array', items: { type: 'string' } },
  },
  required: ['description'],
} as const;

router.post('/series/:id/pages/:pageId/panels/:panelIndex/rewrite', async (req, res) => {
  const series = getSeries(req.params.id);
  if (!series) return sendError(res, 404, 'Series not found');
  const found = findPage(series, req.params.pageId);
  if (!found) return sendError(res, 404, 'Page not found');
  const dnaKey = seriesDnaKey(series);
  const { chapter: targetChapter, page: targetPage } = found;

  const panelIndex = Number(req.params.panelIndex);
  const targetPanel = targetPage.panels.find(p => p.index === panelIndex);
  if (!targetPanel) return sendError(res, 404, 'Panel not found');

  const schema = z.object({ instruction: z.string().min(1).max(2000) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, parsed.error.message);
  if (targetPage.status === 'generating') return sendError(res, 409, '该页正在生成中，请稍候');

  let taskId: string;
  try {
    taskId = runTask(`page:${targetPage.id}`, 'panel-rewrite', async () => {
      try {
        // 1) 文字模型重写这一格的描述
        const rewritePrompt = `当前是漫画第 ${targetPage.pageNumber} 页（章节：${targetChapter.title}）中的第 ${panelIndex} 格。\n\n原描述：${targetPanel.description}\n${targetPanel.dialogue ? `原对白："${targetPanel.dialogue}"` : ''}\n\n用户的新指令：${parsed.data.instruction}\n\n请改写这一格的画面描述、对白、出场角色（characterIds 仅从下列 ID 中选：${series.characters.map(c => `${c.id}=${c.name}`).join('，')}）。严格输出 JSON。`;
        const rewritten = await callStructuredJson<z.infer<typeof PanelRewriteZ>>(
          rewritePrompt,
          '你是一位漫画分镜师。用户要修改单格画面，请输出新的描述。严格输出 JSON。',
          PanelRewriteSchema as Record<string, unknown>,
          {
            dnaKey,
            temperature: 0.8,
            logKind: 'panel-rewrite',
            logMeta: { seriesId: series.id, pageId: targetPage.id, panelIndex, instruction: parsed.data.instruction },
            validate: raw => PanelRewriteZ.parse(raw),
          },
        );
        const validIds = new Set(series.characters.map(c => c.id));
        const okIds = Array.from(new Set(rewritten.characterIds || [])).filter(id => validIds.has(id));
        if (okIds.length < (rewritten.characterIds || []).length) {
          console.warn(`[series-routes] panel-rewrite：过滤 ${(rewritten.characterIds || []).length - okIds.length} 个幻觉角色 ID`);
        }
        // 2) 重新出这一格的图
        if (!series.worldview) throw new Error('请先生成世界观，再生成图像');
        const config = getConfig().image;
        const imageProvider = getImageProvider(config);
        const style = series.worldview.artStyle;
        const mood = series.worldview.paletteMood;
        const charMap = new Map(series.characters.map(c => [c.id, c]));
        const refImages: { data: string; mimeType: string }[] = [];
        const charDescs: string[] = [];
        for (const charId of okIds) {
          const c = charMap.get(charId);
          if (!c) continue;
          charDescs.push(`- ${c.name}：${c.appearance}`);
          const data = resolveImageData(c.referenceImage);
          if (data) refImages.push({ data, mimeType: 'image/png' });
        }
        const charText = charDescs.length > 0 ? `\n出场角色（参考图已提供）：\n${charDescs.join('\n')}` : '';
        const dialogueText = rewritten.dialogue ? `\n对白/旁白："${rewritten.dialogue}"` : '';
        const prompt = `单幅画面（standalone illustration，禁止多格拼接）。画风与色调遵循前述系统规范；系列基调参考：${style}，${mood}（若与系统规范冲突，以系统规范为准）。\n场景：${targetPage.sceneDescription}\n画面内容：${rewritten.description}${charText}${dialogueText}\n要求：单人单场景；如有人物必须严格按参考图的脸部/服装/发型绘制；不要多格拼接。`;
        const img = await imageProvider.generateImage(config, withDnaImagePrompt({
          prompt,
          referenceImages: refImages.length > 0 ? refImages : undefined,
          aspectRatio: '3:4',
        }, { dnaKey }));
        logGeneration('panel-image', { seriesId: series.id, ctx: `panel-rewrite p${targetPage.pageNumber}#${panelIndex}`, model: config.model, prompt, dnaKey });
        // 3) 替换原 panel
        const updatedPanels = targetPage.panels.map(p =>
          p.index === panelIndex
            ? { ...p, description: rewritten.description, dialogue: rewritten.dialogue || '', characterIds: okIds, imageUrl: saveDataUrlImage(img.image) }
            : p,
        );
        const updated = updatePage(series.id, targetChapter.id, targetPage.id, { panels: updatedPanels, status: 'done', errorMessage: undefined });
        const panel = updatedPanels.find(p => p.index === panelIndex);
        return { panel };
      } catch (e: any) {
        throw new Error(e.message || 'Panel rewrite failed');
      }
    });
  } catch (e: any) {
    if (e instanceof DuplicateTaskError) return sendError(res, 409, '该页正在处理中，请稍候');
    return sendError(res, 500, e.message || 'Failed to start task');
  }
  res.json({ taskId });
});

// ========== 一键续写：基于已完成的页自动生成下一个空白页的草稿 ==========

router.post('/series/:id/pages/:pageId/continue', async (req, res) => {
  const series = getSeries(req.params.id);
  if (!series) return sendError(res, 404, 'Series not found');
  const found = findPage(series, req.params.pageId);
  if (!found) return sendError(res, 404, 'Page not found');
  const dnaKey = seriesDnaKey(series);
  const { chapter: targetChapter, page: targetPage } = found;

  // 找全局顺序的下一页（先当前章节，再下一章节）
  const flat: { ch: Chapter; p: SeriesPage }[] = [];
  for (const ch of series.chapters) for (const p of ch.pages) flat.push({ ch, p });
  const idx = flat.findIndex(x => x.p.id === targetPage.id);
  const next = flat[idx + 1];
  if (!next) return sendError(res, 400, '已经是最后一页，没有可续写的下一页');
  if (next.p.status === 'done' || next.p.panels.length > 0) {
    return sendError(res, 400, '下一页已经有内容，请直接编辑或重生成');
  }

  try {
    // P2-9：跨章收集最近 3 页（含当前页）作为上下文
    const contextText = buildRecentContext(series, targetPage.id, true, 3);
    const continuePrompt = `你正在为连载漫画《${series.title}》续写下一页。\n\n世界观：${series.worldview?.era} / ${series.worldview?.artStyle}\n当前章节：${next.ch.title} - ${next.ch.summary}\n\n已知角色：\n${series.characters.map(c => `- id=${c.id} 名字=${c.name}（${c.role}）外貌=${c.appearance}`).join('\n')}\n\n前几页剧情（按顺序，保持连续，不要重复已发生的情节）：\n${contextText}\n\n现在要写第 ${next.p.pageNumber} 页。请输出 2-8 个分镜，让故事自然承接。characterIds 仅从上述 ID 中选。`;
    const breakdown = await callStructuredJson<z.infer<typeof PanelBreakdownZ>>(
      continuePrompt,
      '你是一位漫画编剧。请输出严格的 JSON 格式。',
      PanelBreakdownSchema as Record<string, unknown>,
      {
        dnaKey,
        temperature: 0.8,
        logKind: 'continue',
        logMeta: { seriesId: series.id, pageId: next.p.id },
        validate: raw => PanelBreakdownZ.parse(raw),
      },
    );
    const validIds = new Set(series.characters.map(c => c.id));
    const panels = sanitizePanels(breakdown.panels, validIds, `continue 第${next.p.pageNumber}页`);
    if (!panels) return sendError(res, 502, '模型未返回有效分镜，请重试');
    const allCharIds = new Set<string>();
    panels.forEach(p => p.characterIds.forEach(id => allCharIds.add(id)));
    const updated = updatePage(series.id, next.ch.id, next.p.id, {
      title: breakdown.title || next.p.title,
      sceneDescription: breakdown.sceneDescription,
      panels,
      characterIds: Array.from(allCharIds),
      status: 'draft',
    });
    res.json({ page: updated });
  } catch (e: any) {
    sendError(res, 502, e.message || 'Continue generation failed');
  }
});

export default router;
