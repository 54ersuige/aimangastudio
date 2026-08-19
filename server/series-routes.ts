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
import { sendError } from './utils.js';
import { withDnaImagePrompt, withDnaTextPrompt } from './dna-inject.js';
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
  type Worldview,
  type Series,
  type SeriesCharacter,
  type Chapter,
  type Panel,
} from './series-store.js';

const router = Router();

function getTextProvider(config: ModelConfigForText) {
  switch (config.provider) {
    case 'gemini': return gemini;
    case 'agnes': return agnes;
    case 'deepseek': return deepseek;
    case 'openai-compatible': return openaiCompatible;
    default: throw new Error(`Unsupported text provider: ${config.provider}`);
  }
}

function getImageProvider(config: ModelConfigForImage) {
  switch (config.provider) {
    case 'gemini': return gemini;
    case 'agnes': return agnes;
    case 'step': return step;
    case 'minimax': return minimax;
    case 'openai-compatible': return openaiCompatible;
    default: throw new Error(`Unsupported image provider: ${config.provider}`);
  }
}

type ModelConfigForText = ReturnType<typeof getConfig>['text'];
type ModelConfigForImage = ReturnType<typeof getConfig>['image'];

// Helper: call the configured text model with JSON-mode schema
async function callStructuredJson<T>(prompt: string, systemInstruction: string, schema: Record<string, unknown>, temperature = 0.7): Promise<T> {
  const config = getConfig().text;
  const provider = getTextProvider(config);
  const req: TextRequest = withDnaTextPrompt({
    prompt,
    systemInstruction,
    jsonMode: true,
    jsonSchema: schema,
    temperature,
  });
  const result = await provider.generateText(config, req);
  // 解析 JSON（有时模型会包 markdown 代码块）
  const cleaned = result.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  return JSON.parse(cleaned) as T;
}

// ========== 系列 CRUD ==========

router.get('/series', (_req, res) => {
  res.json({ series: listSeries() });
});

router.post('/series', (req, res) => {
  const schema = z.object({
    title: z.string().min(1).max(100),
    logline: z.string().min(1).max(2000),
    style: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, parsed.error.message);
  const series = createSeries(parsed.data as { title: string; logline: string; style?: string });
  res.json({ series });
});

router.get('/series/:id', (req, res) => {
  const series = getSeries(req.params.id);
  if (!series) return sendError(res, 404, 'Series not found');
  res.json({ series });
});

router.patch('/series/:id', (req, res) => {
  const schema = z.object({
    title: z.string().optional(),
    style: z.string().optional(),
    logline: z.string().optional(),
  });
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
  try {
    const prompt = `用户想创作的漫画：\n标题：${series.title}\n一句话简介：${series.logline}\n用户风格偏好（仅作题材/氛围参考，画风已由系统锁定）：${series.style}\n\n请根据这些信息设计一个详细的世界观设定。\n\n【画风硬约束】本系列画风已被系统 Art Direction 锁定为：New Yorker 单幅叙事 × Adrian Tomine 都市写实 × 欧美独立 Graphic Novel。你输出的 artStyle 与 paletteMood 必须在该范围内细化（细线写实、克制留白、暖色印刷感、低饱和），严禁出现日漫/二次元/赛博朋克/霓虹/高饱和/水彩/油画等词。era 必须是现实世界的当代或近代（不写科幻未来）。`;
    const worldview = await callStructuredJson<Worldview>(
      prompt,
      '你是一位资深漫画编辑，擅长世界设定。请输出严格的 JSON 格式。',
      WorldviewSchema as Record<string, unknown>,
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
  try {
    const prompt = `基于以下漫画设定，生成 3-4 个核心角色（必须包含 1 个主角、1-2 个配角、必要时 1 个反派）。\n\n世界观：\n时代：${series.worldview.era}\n背景：${series.worldview.background}\n风格：${series.worldview.artStyle}\n\n故事简介：${series.logline}`;
    const result = await callStructuredJson<{ characters: Omit<SeriesCharacter, 'id' | 'referenceImage'>[] }>(
      prompt,
      '你是一位漫画角色设计师。请输出严格的 JSON 格式。',
      CharacterSchema as Record<string, unknown>,
    );

    // 为每个角色生成参考图
    const config = getConfig().image;
    const imageProvider = getImageProvider(config);
    const generated: SeriesCharacter[] = [];
    for (const c of result.characters) {
      const imgReq: ImageRequest = withDnaImagePrompt({
        prompt: `角色设定图：单人，${c.appearance}。画风与色调遵循前述系统规范；系列基调参考：${series.worldview.artStyle}，${series.worldview.paletteMood}（若与系统规范冲突，以系统规范为准）。`,
      });
      try {
        const img = await imageProvider.generateImage(config, imgReq);
        generated.push({ ...c, id: crypto.randomUUID(), referenceImage: img.image });
      } catch (imgErr: any) {
        console.warn(`Failed to generate reference image for ${c.name}:`, imgErr.message);
        generated.push({ ...c, id: crypto.randomUUID() });
      }
    }
    // 替换角色列表
    updateSeries(series.id, { characters: generated });
    res.json({ characters: generated });
  } catch (e: any) {
    sendError(res, 502, e.message || 'Character generation failed');
  }
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
  const parsed = AddCharacterSchema.safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, parsed.error.message);
  const input = parsed.data;
  let referenceImage: string | undefined;
  if (input.autoGenerateImage) {
    try {
      const config = getConfig().image;
      const imageProvider = getImageProvider(config);
      const style = series.worldview?.artStyle || series.style;
      const mood = series.worldview?.paletteMood || '';
      const img = await imageProvider.generateImage(config, withDnaImagePrompt({
        prompt: `角色设定图：单人，${input.appearance}。画风与色调遵循前述系统规范；系列基调参考：${style}，${mood}（若与系统规范冲突，以系统规范为准）。`,
      }));
      referenceImage = img.image;
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
  const character = series.characters.find(c => c.id === req.params.characterId);
  if (!character) return sendError(res, 404, 'Character not found');
  try {
    const config = getConfig().image;
    const imageProvider = getImageProvider(config);
    const style = series.worldview?.artStyle || series.style;
    const mood = series.worldview?.paletteMood || '';
    const img = await imageProvider.generateImage(config, withDnaImagePrompt({
      prompt: `角色设定图：单人，${character.appearance}。画风与色调遵循前述系统规范；系列基调参考：${style}，${mood}（若与系统规范冲突，以系统规范为准）。`,
    }));
    const updated = updateCharacter(series.id, character.id, { referenceImage: img.image });
    res.json({ character: updated });
  } catch (e: any) {
    sendError(res, 502, e.message || 'Image regeneration failed');
  }
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
  const targetPageCount = Number(req.body?.targetPageCount || 12);
  try {
    const prompt = `基于以下漫画设定，把故事拆分成章节和页面。\n\n世界观：\n时代：${series.worldview.era}\n背景：${series.worldview.background}\n\n故事简介：${series.logline}\n\n角色：${series.characters.map(c => `${c.name}（${c.role}）`).join('、')}\n\n目标总页数：约 ${targetPageCount} 页。请合理拆分章节。`;
    const result = await callStructuredJson<{ chapters: { title: string; summary: string; pageCount: number }[] }>(
      prompt,
      '你是一位漫画编剧。请输出严格的 JSON 格式。',
      ChaptersSchema as Record<string, unknown>,
    );
    // 构造 Chapter 与空 Page
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
  let targetPage: any = null;
  let targetChapter: any = null;
  for (const ch of series.chapters) {
    const p = ch.pages.find(pp => pp.id === req.params.pageId);
    if (p) { targetPage = p; targetChapter = ch; break; }
  }
  if (!targetPage) return sendError(res, 404, 'Page not found');
  try {
    const prompt = `为以下漫画页面拆出 2-8 个分镜。\n\n系列：${series.title}\n世界观：${series.worldview?.era} / ${series.worldview?.artStyle}\n章节：${targetChapter.title} - ${targetChapter.summary}\n\n角色库：\n${series.characters.map(c => `- id=${c.id} 名字=${c.name}（${c.role}）外貌=${c.appearance}`).join('\n')}\n\n当前页：第 ${targetPage.pageNumber} 页（这是"${targetChapter.title}"中的第 ${targetPage.pageNumber} 页）\n请把这一页拆成 2-8 个分镜，每个分镜必须指定出场的角色 ID。`;
    const result = await callStructuredJson<{ title: string; sceneDescription: string; panels: Omit<Panel, 'imageUrl'>[] }>(
      prompt,
      '你是一位漫画分镜师。请输出严格的 JSON 格式。',
      PanelBreakdownSchema as Record<string, unknown>,
    );
    // 合并出场角色
    const allCharIds = new Set<string>();
    result.panels.forEach(p => p.characterIds.forEach(id => allCharIds.add(id)));
    updatePage(series.id, targetChapter.id, targetPage.id, {
      title: result.title,
      sceneDescription: result.sceneDescription,
      panels: result.panels,
      characterIds: Array.from(allCharIds),
    });
    res.json({ page: { ...targetPage, ...result } });
  } catch (e: any) {
    sendError(res, 502, e.message || 'Page breakdown failed');
  }
});

router.post('/series/:id/pages/:pageId/generate', async (req, res) => {
  const series = getSeries(req.params.id);
  if (!series) return sendError(res, 404, 'Series not found');
  let targetPage: any = null;
  let targetChapter: any = null;
  for (const ch of series.chapters) {
    const p = ch.pages.find(pp => pp.id === req.params.pageId);
    if (p) { targetPage = p; targetChapter = ch; break; }
  }
  if (!targetPage) return sendError(res, 404, 'Page not found');
  if (targetPage.panels.length === 0) return sendError(res, 400, '请先生成分镜');
  updatePage(series.id, targetChapter.id, targetPage.id, { status: 'generating', errorMessage: undefined });
  try {
    const config = getConfig().image;
    const imageProvider = getImageProvider(config);
    const style = series.worldview?.artStyle || series.style;
    const mood = series.worldview?.paletteMood || '';
    // 把角色 id 映射到 character，方便每个分镜用对应参考图
    const charMap = new Map(series.characters.map(c => [c.id, c]));
    // === 单格逐个生成 + 前端拼接策略 ===
    const sortedPanels = [...targetPage.panels].sort((a: Panel, b: Panel) => a.index - b.index);
    const panelImages: string[] = [];
    for (const panel of sortedPanels) {
      // 收集当前分镜出场的角色参考图
      const refImages: { data: string; mimeType: string }[] = [];
      const charDescs: string[] = [];
      for (const charId of panel.characterIds) {
        const c = charMap.get(charId);
        if (!c) continue;
        charDescs.push(`- ${c.name}：${c.appearance}`);
        if (c.referenceImage) refImages.push({ data: c.referenceImage, mimeType: 'image/png' });
      }
      const charText = charDescs.length > 0 ? `\n出场角色（参考图已提供）：\n${charDescs.join('\n')}` : '';
      const dialogueText = panel.dialogue ? `\n对白/旁白："${panel.dialogue}"` : '';
      const prompt = `单幅画面（standalone illustration，禁止多格拼接）。画风与色调遵循前述系统规范；系列基调参考：${style}，${mood}（若与系统规范冲突，以系统规范为准）。\n场景：${targetPage.sceneDescription}\n画面内容：${panel.description}${charText}${dialogueText}\n要求：单人单场景，画面聚焦于这一格的描述内容；如有人物，必须严格按参考图的脸部/服装/发型/年龄特征绘制；不要输出多格拼接图，不要输出页边距文字水印。`;
      const img = await imageProvider.generateImage(config, withDnaImagePrompt({
        prompt,
        referenceImages: refImages.length > 0 ? refImages : undefined,
        aspectRatio: '3:4',
      }));
      panelImages.push(img.image);
    }
    // 写入 page（每张分镜图保存到 panel.imageUrl）
    const updatedPanels = sortedPanels.map((p, i) => ({ ...p, imageUrl: panelImages[i] }));
    updatePage(series.id, targetChapter.id, targetPage.id, {
      panels: updatedPanels,
      status: 'done',
    });
    res.json({ page: { ...targetPage, panels: updatedPanels, status: 'done' } });
  } catch (e: any) {
    updatePage(series.id, targetChapter.id, targetPage.id, { status: 'error', errorMessage: e.message });
    sendError(res, 502, e.message || 'Page generation failed');
  }
});

// 单个分镜重生
router.post('/series/:id/pages/:pageId/regenerate', async (req, res) => {
  const series = getSeries(req.params.id);
  if (!series) return sendError(res, 404, 'Series not found');
  let targetPage: any = null;
  let targetChapter: any = null;
  for (const ch of series.chapters) {
    const p = ch.pages.find(pp => pp.id === req.params.pageId);
    if (p) { targetPage = p; targetChapter = ch; break; }
  }
  if (!targetPage) return sendError(res, 404, 'Page not found');
  try {
    const config = getConfig().image;
    const imageProvider = getImageProvider(config);
    const style = series.worldview?.artStyle || series.style;
    const mood = series.worldview?.paletteMood || '';
    const charMap = new Map(series.characters.map(c => [c.id, c]));
    const sortedPanels = [...targetPage.panels].sort((a: Panel, b: Panel) => a.index - b.index);
    const panelImages: string[] = [];
    for (const panel of sortedPanels) {
      const refImages: { data: string; mimeType: string }[] = [];
      const charDescs: string[] = [];
      for (const charId of panel.characterIds) {
        const c = charMap.get(charId);
        if (!c) continue;
        charDescs.push(`- ${c.name}：${c.appearance}`);
        if (c.referenceImage) refImages.push({ data: c.referenceImage, mimeType: 'image/png' });
      }
      const charText = charDescs.length > 0 ? `\n出场角色（参考图已提供）：\n${charDescs.join('\n')}` : '';
      const dialogueText = panel.dialogue ? `\n对白/旁白："${panel.dialogue}"` : '';
      const prompt = `单幅画面（standalone illustration，禁止多格拼接，重新生成）。画风与色调遵循前述系统规范；系列基调参考：${style}，${mood}（若与系统规范冲突，以系统规范为准）。\n场景：${targetPage.sceneDescription}\n画面内容：${panel.description}${charText}${dialogueText}\n要求：单人单场景，画面聚焦于这一格；如有人物必须严格按参考图绘制；不要多格拼接图。`;
      const img = await imageProvider.generateImage(config, withDnaImagePrompt({
        prompt,
        referenceImages: refImages.length > 0 ? refImages : undefined,
        aspectRatio: '3:4',
      }));
      panelImages.push(img.image);
    }
    const updatedPanels = sortedPanels.map((p, i) => ({ ...p, imageUrl: panelImages[i] }));
    updatePage(series.id, targetChapter.id, targetPage.id, {
      panels: updatedPanels,
      status: 'done',
      errorMessage: undefined,
    });
    res.json({ page: { ...targetPage, panels: updatedPanels, status: 'done' } });
  } catch (e: any) {
    sendError(res, 502, e.message || 'Page regeneration failed');
  }
});

// ========== 自然语言改写单页 ==========
// 用户用一句话告诉 AI「把这一页改成……」，AI 重写所有分镜描述并重新出图
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
  let targetPage: any = null;
  let targetChapter: any = null;
  for (const ch of series.chapters) {
    const p = ch.pages.find(pp => pp.id === req.params.pageId);
    if (p) { targetPage = p; targetChapter = ch; break; }
  }
  if (!targetPage) return sendError(res, 404, 'Page not found');

  const schema = z.object({
    instruction: z.string().min(1).max(2000),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, parsed.error.message);

  try {
    // 1) 用文字模型根据用户指令重写分镜描述
    const rewritePrompt = `用户在修改第 ${targetPage.pageNumber} 页（章节：${targetChapter.title}）。\n\n用户原始需求：\n页标题：${targetPage.title}\n场景：${targetPage.sceneDescription}\n当前分镜：\n${targetPage.panels.map((p: Panel) => `${p.index}. ${p.description}${p.dialogue ? `（对白："${p.dialogue}"）` : ''} → 角色：${p.characterIds.join(',') || '无'}`).join('\n')}\n\n用户的新指令：${parsed.data.instruction}\n\n请输出改写后的页面（保留原分镜数量或合理调整），characterIds 必须从下列 ID 中选：${series.characters.map(c => `${c.id}=${c.name}`).join('，')}。`;
    const rewritten = await callStructuredJson<{
      title: string;
      sceneDescription: string;
      panels: Omit<Panel, 'imageUrl'>[];
    }>(
      rewritePrompt,
      '你是一位漫画编剧。用户要修改当前页，请根据指令输出新的分镜描述。严格输出 JSON。',
      PageRewriteSchema as Record<string, unknown>,
      0.8,
    );
    updatePage(series.id, targetChapter.id, targetPage.id, {
      title: rewritten.title,
      sceneDescription: rewritten.sceneDescription,
      panels: rewritten.panels,
      status: 'generating',
      errorMessage: undefined,
    });
    // 2) 立刻按新分镜重新出图
    const config = getConfig().image;
    const imageProvider = getImageProvider(config);
    const style = series.worldview?.artStyle || series.style;
    const mood = series.worldview?.paletteMood || '';
    const charMap = new Map(series.characters.map(c => [c.id, c]));
    const sortedPanels = [...rewritten.panels].sort((a, b) => a.index - b.index);
    const panelImages: string[] = [];
    for (const panel of sortedPanels) {
      const refImages: { data: string; mimeType: string }[] = [];
      const charDescs: string[] = [];
      for (const charId of panel.characterIds) {
        const c = charMap.get(charId);
        if (!c) continue;
        charDescs.push(`- ${c.name}：${c.appearance}`);
        if (c.referenceImage) refImages.push({ data: c.referenceImage, mimeType: 'image/png' });
      }
      const charText = charDescs.length > 0 ? `\n出场角色（参考图已提供）：\n${charDescs.join('\n')}` : '';
      const dialogueText = panel.dialogue ? `\n对白/旁白："${panel.dialogue}"` : '';
      const prompt = `单幅画面（standalone illustration，禁止多格拼接）。画风与色调遵循前述系统规范；系列基调参考：${style}，${mood}（若与系统规范冲突，以系统规范为准）。\n场景：${rewritten.sceneDescription}\n画面内容：${panel.description}${charText}${dialogueText}\n要求：单人单场景；如有人物必须严格按参考图的脸部/服装/发型绘制；不要多格拼接。`;
      const img = await imageProvider.generateImage(config, withDnaImagePrompt({
        prompt,
        referenceImages: refImages.length > 0 ? refImages : undefined,
        aspectRatio: '3:4',
      }));
      panelImages.push(img.image);
    }
    const updatedPanels = sortedPanels.map((p, i) => ({ ...p, imageUrl: panelImages[i] }));
    updatePage(series.id, targetChapter.id, targetPage.id, {
      panels: updatedPanels,
      status: 'done',
    });
    res.json({ page: { ...targetPage, title: rewritten.title, sceneDescription: rewritten.sceneDescription, panels: updatedPanels, status: 'done' } });
  } catch (e: any) {
    updatePage(series.id, targetChapter.id, targetPage.id, { status: 'error', errorMessage: e.message });
    sendError(res, 502, e.message || 'Page rewrite failed');
  }
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
  let targetPage: any = null;
  let targetChapter: any = null;
  for (const ch of series.chapters) {
    const p = ch.pages.find(pp => pp.id === req.params.pageId);
    if (p) { targetPage = p; targetChapter = ch; break; }
  }
  if (!targetPage) return sendError(res, 404, 'Page not found');

  const panelIndex = Number(req.params.panelIndex);
  const targetPanel = targetPage.panels.find((p: Panel) => p.index === panelIndex);
  if (!targetPanel) return sendError(res, 404, 'Panel not found');

  const schema = z.object({ instruction: z.string().min(1).max(2000) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, parsed.error.message);

  try {
    // 1) 文字模型重写这一格的描述
    const rewritePrompt = `当前是漫画第 ${targetPage.pageNumber} 页（章节：${targetChapter.title}）中的第 ${panelIndex} 格。\n\n原描述：${targetPanel.description}\n${targetPanel.dialogue ? `原对白："${targetPanel.dialogue}"` : ''}\n\n用户的新指令：${parsed.data.instruction}\n\n请改写这一格的画面描述、对白、出场角色（characterIds 仅从下列 ID 中选：${series.characters.map(c => `${c.id}=${c.name}`).join('，')}）。严格输出 JSON。`;
    const rewritten = await callStructuredJson<{ description: string; dialogue?: string; characterIds: string[] }>(
      rewritePrompt,
      '你是一位漫画分镜师。用户要修改单格画面，请输出新的描述。严格输出 JSON。',
      PanelRewriteSchema as Record<string, unknown>,
      0.8,
    );
    // 2) 用该角色参考图重新出图
    const config = getConfig().image;
    const imageProvider = getImageProvider(config);
    const style = series.worldview?.artStyle || series.style;
    const mood = series.worldview?.paletteMood || '';
    const charMap = new Map(series.characters.map(c => [c.id, c]));
    const refImages: { data: string; mimeType: string }[] = [];
    const charDescs: string[] = [];
    for (const charId of rewritten.characterIds) {
      const c = charMap.get(charId);
      if (!c) continue;
      charDescs.push(`- ${c.name}：${c.appearance}`);
      if (c.referenceImage) refImages.push({ data: c.referenceImage, mimeType: 'image/png' });
    }
    const charText = charDescs.length > 0 ? `\n出场角色（参考图已提供）：\n${charDescs.join('\n')}` : '';
    const dialogueText = rewritten.dialogue ? `\n对白/旁白："${rewritten.dialogue}"` : '';
    const prompt = `单幅画面（standalone illustration，禁止多格拼接）。画风与色调遵循前述系统规范；系列基调参考：${style}，${mood}（若与系统规范冲突，以系统规范为准）。\n场景：${targetPage.sceneDescription}\n画面内容：${rewritten.description}${charText}${dialogueText}\n要求：单人单场景；如有人物必须严格按参考图的脸部/服装/发型绘制；不要多格拼接。`;
    const img = await imageProvider.generateImage(config, withDnaImagePrompt({
      prompt,
      referenceImages: refImages.length > 0 ? refImages : undefined,
      aspectRatio: '3:4',
    }));
    // 3) 替换原 panel
    const updatedPanels = targetPage.panels.map((p: Panel) =>
      p.index === panelIndex
        ? { ...p, description: rewritten.description, dialogue: rewritten.dialogue || '', characterIds: rewritten.characterIds, imageUrl: img.image }
        : p,
    );
    updatePage(series.id, targetChapter.id, targetPage.id, { panels: updatedPanels, status: 'done', errorMessage: undefined });
    const updated = updatedPanels.find((p: Panel) => p.index === panelIndex);
    res.json({ panel: updated });
  } catch (e: any) {
    sendError(res, 502, e.message || 'Panel rewrite failed');
  }
});

// ========== 一键续写：基于已完成的页自动生成下一个空白页的草稿 ==========
router.post('/series/:id/pages/:pageId/continue', async (req, res) => {
  const series = getSeries(req.params.id);
  if (!series) return sendError(res, 404, 'Series not found');
  let targetPage: any = null;
  let targetChapter: any = null;
  for (const ch of series.chapters) {
    const p = ch.pages.find(pp => pp.id === req.params.pageId);
    if (p) { targetPage = p; targetChapter = ch; break; }
  }
  if (!targetPage) return sendError(res, 404, 'Page not found');

  // 找当前章节的下一页
  const pageIdx = targetChapter.pages.findIndex((p: any) => p.id === targetPage.id);
  let nextPage: any = targetChapter.pages[pageIdx + 1];
  // 如果是当前章节最后一页，尝试找下一个章节的第一页
  if (!nextPage) {
    const chIdx = series.chapters.findIndex((c: any) => c.id === targetChapter.id);
    const nextChapter = series.chapters[chIdx + 1];
    if (nextChapter) nextPage = nextChapter.pages[0];
  }
  if (!nextPage) return sendError(res, 400, '已经是最后一页，没有可续写的下一页');
  if (nextPage.status === 'done' || nextPage.panels.length > 0) {
    return sendError(res, 400, '下一页已经有内容，请直接编辑或重生成');
  }

  try {
    // 1) 收集前面所有已完成的页作为上下文（最多取最近 3 页）
    const contextPages: any[] = [];
    // 找当前章节前面所有已完成的页
    for (let i = 0; i < pageIdx; i++) {
      const p = targetChapter.pages[i];
      if (p.status === 'done' && p.panels.length > 0) contextPages.push(p);
    }
    contextPages.push(targetPage);
    // 取最近 3 页
    const recentContext = contextPages.slice(-3);

    const contextText = recentContext.map((p: any) =>
      `第 ${p.pageNumber} 页：${p.title}\n场景：${p.sceneDescription}\n分镜：\n${p.panels.map((pn: Panel) => `  ${pn.index}. ${pn.description}${pn.dialogue ? `（对白："${pn.dialogue}"）` : ''}`).join('\n')}`
    ).join('\n\n');

    const continuePrompt = `你正在为连载漫画《${series.title}》续写下一页。\n\n世界观：${series.worldview?.era} / ${series.worldview?.artStyle}\n当前章节：${targetChapter.title} - ${targetChapter.summary}\n\n已知角色：\n${series.characters.map(c => `- id=${c.id} 名字=${c.name}（${c.role}）外貌=${c.appearance}`).join('\n')}\n\n前几页剧情（按顺序）：\n${contextText}\n\n现在要写第 ${nextPage.pageNumber} 页。请输出 2-8 个分镜，让故事自然承接。characterIds 仅从上述 ID 中选。`;
    const breakdown = await callStructuredJson<{ title: string; sceneDescription: string; panels: Omit<Panel, 'imageUrl'>[] }>(
      continuePrompt,
      '你是一位漫画编剧。请输出严格的 JSON 格式。',
      PanelBreakdownSchema as Record<string, unknown>,
      0.8,
    );
    updatePage(series.id, targetChapter.id, nextPage.id, {
      title: breakdown.title,
      sceneDescription: breakdown.sceneDescription,
      panels: breakdown.panels,
      status: 'draft',
    });
    res.json({ page: { ...nextPage, ...breakdown } });
  } catch (e: any) {
    sendError(res, 502, e.message || 'Continue generation failed');
  }
});

export default router;
