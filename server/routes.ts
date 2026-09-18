import { Router } from 'express';
import { z } from 'zod';
import { getConfig, saveConfig, type ModelConfig } from './config.js';
import * as gemini from './providers/gemini.js';
import * as deepseek from './providers/deepseek.js';
import * as agnes from './providers/agnes.js';
import * as step from './providers/step.js';
import * as minimax from './providers/minimax.js';
import * as openaiCompatible from './providers/openai-compatible.js';
import type { ImageRequest, TextRequest } from './utils.js';
import { sendError, logGeneration } from './utils.js';
import { withDnaImagePrompt, withDnaTextPrompt, resolveDnaKey } from './dna-inject.js';
import { listDna, DNA_KEYS } from './dna/registry.js';
import { readRecentAudits, computeDriftScore, computeDimensionAverages } from './audit/panel-audit.js';
import { getLegacyCharacters } from './series-store.js';

const router = Router();

function getTextProvider(config: ModelConfig['text']) {
  switch (config.provider) {
    case 'gemini':
      return gemini;
    case 'deepseek':
      return deepseek;
    case 'minimax':
      return minimax;
    case 'agnes':
      return agnes;
    case 'openai-compatible':
      return openaiCompatible;
    default:
      throw new Error(`Unsupported text provider: ${config.provider}`);
  }
}

function getImageProvider(config: ModelConfig['image']) {
  switch (config.provider) {
    case 'gemini':
      return gemini;
    case 'step':
      return step;
    case 'minimax':
      return minimax;
    case 'agnes':
      return agnes;
    case 'openai-compatible':
      return openaiCompatible;
    default:
      throw new Error(`Unsupported image provider: ${config.provider}`);
  }
}

router.get('/config', (_req, res) => {
  // Do not expose raw API keys to the frontend in production; however for local
  // deployment the user needs to see/edit them. We send masked keys.
  const config = getConfig();
  res.json({
    text: { ...config.text, apiKey: maskKey(config.text.apiKey) },
    image: { ...config.image, apiKey: maskKey(config.image.apiKey) },
    // 2026-09-03：视觉模型独立配置带回前端（同样掩码 apiKey）。
    vision: { ...config.vision, apiKey: maskKey(config.vision.apiKey) },
    dnaKey: config.dnaKey,
  });
});

/**
 * 返回所有可用的 DNA 预设清单（前端 ModelConfigModal 用）。
 * 只暴露元数据，不暴露 prompt 正文（避免 prompt 被前端修改）。
 */
router.get('/dna', (_req, res) => {
  res.json({ list: listDna() });
});

function maskKey(key?: string): string | undefined {
  if (!key) return undefined;
  if (key.length <= 8) return '***';
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

const UpdateConfigSchema = z.object({
  text: z.object({
    provider: z.enum(['gemini', 'deepseek', 'minimax', 'agnes', 'openai-compatible']),
    model: z.string(),
    apiKey: z.string().optional(),
    baseUrl: z.string().optional(),
    timeout: z.number().int().min(1000),
    extraParams: z.record(z.any()),
  }).optional(),
  image: z.object({
    provider: z.enum(['gemini', 'step', 'minimax', 'agnes', 'openai-compatible']),
    model: z.string(),
    apiKey: z.string().optional(),
    baseUrl: z.string().optional(),
    timeout: z.number().int().min(1000),
    extraParams: z.record(z.any()),
  }).optional(),
  // 2026-09-03：视觉模型独立 schema，与 text/image 同形。
  // enabled 字段：false 时 limb-guard 直接跳过，不会因 key 缺失报 500。
  vision: z.object({
    enabled: z.boolean().optional(),
    provider: z.enum(['gemini', 'minimax', 'agnes', 'deepseek', 'openai-compatible']),
    model: z.string(),
    apiKey: z.string().optional(),
    baseUrl: z.string().optional(),
    timeout: z.number().int().min(1000),
    extraParams: z.record(z.any()),
  }).optional(),
  /**
   * 默认 DNA key。改这里只影响「此后新建」的系列；已存在系列的 dnaKey 已冻结（防风格漂移）。
   */
  dnaKey: z.enum(DNA_KEYS as unknown as [string, ...string[]]).optional(),
});

router.post('/config', (req, res) => {
  const parsed = UpdateConfigSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendError(res, 400, `Invalid config: ${parsed.error.message}`);
  }

  const current = getConfig();
  // 校验 DNA key 合法性 —— enum 已放宽为 [string, ...string[]] 以跟随 DNA_KEYS 单一事实来源，
  // 但写入 ModelConfig 时仍需收窄到注册表允许的字面量。
  const nextDnaKey: ModelConfig['dnaKey'] = (parsed.data.dnaKey && (DNA_KEYS as readonly string[]).includes(parsed.data.dnaKey))
    ? (parsed.data.dnaKey as ModelConfig['dnaKey'])
    : current.dnaKey;
  const next: ModelConfig = {
    text: { ...current.text, ...(parsed.data.text || {}) },
    image: { ...current.image, ...(parsed.data.image || {}) },
    // 2026-09-03：vision 字段同样合并。enabled 一并吃过来（默认 false → 用户改了 model 没开 enabled 仍走跳过）。
    vision: { ...current.vision, ...(parsed.data.vision || {}) },
    dnaKey: nextDnaKey,
  };

  // 前端 /config 返回的是掩码 key（maskKey，如 `sk-Ab..cD`）。
  // 若前台把掩码 key 原样传回（未修改），需保留服务端已存的真实 key；
  // 仅当用户填入了新的完整 key（与掩码不相等）时才覆盖。
  const maskMatch = (candidate?: string, masked?: string) => Boolean(candidate && masked && candidate === masked);
  if (parsed.data.text?.apiKey) {
    if (!maskMatch(parsed.data.text.apiKey, maskKey(current.text.apiKey))) {
      next.text.apiKey = parsed.data.text.apiKey;
    } else {
      next.text.apiKey = current.text.apiKey;
    }
  }
  if (parsed.data.image?.apiKey) {
    if (!maskMatch(parsed.data.image.apiKey, maskKey(current.image.apiKey))) {
      next.image.apiKey = parsed.data.image.apiKey;
    } else {
      next.image.apiKey = current.image.apiKey;
    }
  }
  // 2026-09-03：vision.apiKey 同样处理掩码回写。
  if (parsed.data.vision?.apiKey) {
    if (!maskMatch(parsed.data.vision.apiKey, maskKey(current.vision.apiKey))) {
      next.vision.apiKey = parsed.data.vision.apiKey;
    } else {
      next.vision.apiKey = current.vision.apiKey;
    }
  }

  saveConfig(next);
  res.json({ success: true });
});

const TextRequestSchema = z.object({
  prompt: z.string(),
  systemInstruction: z.string().optional(),
  jsonMode: z.boolean().optional(),
  jsonSchema: z.record(z.any()).optional(),
  temperature: z.number().optional(),
  maxTokens: z.number().int().optional(),
  referenceImages: z.array(z.object({ data: z.string(), mimeType: z.string() })).optional(),
  // P2-11：仅创作类调用注入 DNA（约 8KB 的画风宪法 + 叙事规则）。
  // 默认 false —— 闲聊/问答不再无差别背负全套指令。
  withDna: z.boolean().optional(),
  /**
   * 指定 DNA key。优先级 withDna=true 时才生效；未指定时使用 config.dnaKey。
   * 通用接口（非系列路由）允许覆盖默认 DNA，但 series 业务路由总是用 series.dnaKey。
   */
  dnaKey: z.enum(DNA_KEYS as unknown as [string, ...string[]]).optional(),
});

router.post('/text', async (req, res) => {
  const parsed = TextRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendError(res, 400, `Invalid request: ${parsed.error.message}`);
  }

  try {
    const cfg = getConfig();
    const config = cfg.text;
    const provider = getTextProvider(config);
    const { withDna, dnaKey: reqDnaKey, ...rest } = parsed.data;
    const textReq = withDna
      ? withDnaTextPrompt(rest as TextRequest, { dnaKey: resolveDnaKey(reqDnaKey ?? cfg.dnaKey) })
      : (rest as TextRequest);
    const result = await provider.generateText(config, textReq);
    res.json(result);
  } catch (e: any) {
    console.error('Text generation failed:', e);
    sendError(res, 502, e.message || 'Text generation failed');
  }
});

const ImageRequestSchema = z.object({
  prompt: z.string(),
  referenceImages: z.array(z.object({ data: z.string(), mimeType: z.string() })).optional(),
  aspectRatio: z.string().optional(),
  size: z.object({ width: z.number(), height: z.number() }).optional(),
  /**
   * 指定 DNA key。默认使用 config.dnaKey。
   * 通用出图接口（playground / 调试）允许选 DNA，但 series 业务路由总是用 series.dnaKey。
   */
  dnaKey: z.enum(DNA_KEYS as unknown as [string, ...string[]]).optional(),
});

router.post('/image', async (req, res) => {
  const parsed = ImageRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendError(res, 400, `Invalid request: ${parsed.error.message}`);
  }

  try {
    const cfg = getConfig();
    const config = cfg.image;
    const provider = getImageProvider(config);
    const { dnaKey: reqDnaKey, ...rest } = parsed.data;
    const effectiveKey = resolveDnaKey(reqDnaKey ?? cfg.dnaKey);
    const imageReq = withDnaImagePrompt(rest as ImageRequest, { dnaKey: effectiveKey });
    logGeneration('playground-image', { model: config.model, prompt: imageReq.prompt, dnaKey: effectiveKey });
    const result = await provider.generateImage(config, imageReq);
    res.json(result);
  } catch (e: any) {
    console.error('Image generation failed:', e);
    sendError(res, 502, e.message || 'Image generation failed');
  }
});

// ========== 2026-09-07 反馈层 P4：审计 API（供 UI 审计 Tab + 红条用）==========

/**
 * GET /api/audit/recent?limit=100
 * 返回最近的 panel 出图审计记录（按 ts 倒序）。
 * UI 的"审计 Tab"直接读这个。
 */
router.get('/audit/recent', (req, res) => {
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
  const records = readRecentAudits(limit);
  res.json({ records, count: records.length });
});

/**
 * GET /api/audit/drift-score?seriesId=xxx
 * 返回指定 series 的连载质量分（0-100）。无 review 数据时返回 null。
 */
router.get('/audit/drift-score', (req, res) => {
  const seriesId = String(req.query.seriesId || '');
  if (!seriesId) return sendError(res, 400, 'seriesId is required');
  const score = computeDriftScore(seriesId);
  res.json({ seriesId, score });
});

/**
 * GET /api/audit/dimensions?seriesId=xxx
 * 返回 8 维评审各自的平均分（0-10，1 位小数）。无数据时各维为 null。
 */
router.get('/audit/dimensions', (req, res) => {
  const seriesId = String(req.query.seriesId || '');
  if (!seriesId) return sendError(res, 400, 'seriesId is required');
  const averages = computeDimensionAverages(seriesId);
  res.json({ seriesId, dimensions: averages });
});

/**
 * GET /api/audit/legacy-list
 * 返回所有 legacy 角色（缺必填字段），UI 顶部红条用。
 */
router.get('/audit/legacy-list', (_req, res) => {
  const list = getLegacyCharacters();
  res.json({ list, count: list.length });
});

export default router;
