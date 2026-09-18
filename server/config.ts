import { z } from 'zod';
import dotenv from 'dotenv';
import { existsSync, readFileSync, writeFileSync, statSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { DNA_KEYS } from './dna/registry.js';

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));

// 路径基于模块真实位置而非 process.cwd() —— 从任意目录启动都不会找错文件
dotenv.config({ path: resolve(SERVER_DIR, '../.env') });

export const TextProviderSchema = z.enum(['gemini', 'deepseek', 'minimax', 'agnes', 'openai-compatible']);
export const ImageProviderSchema = z.enum(['gemini', 'step', 'minimax', 'agnes', 'openai-compatible']);
// 2026-09-03 新增：视觉（多模态）模型独立配置。
// limb-guard 巡检「多胳膊/多手指」时用，专做图像内容理解（看图说话 / 结构化打分）。
// 不复用 text provider —— 文本模型多为纯文本（如早期 deepseek），没有 image_url 输入能力。
// 2026-09-10：加入 deepseek —— DeepSeek V4.1 Flash 为原生多模态模型（模型 id: deepseek-flash），
// 已实测支持 image_url + json_object，可作为视觉模型使用。
export const VisionProviderSchema = z.enum(['gemini', 'minimax', 'agnes', 'deepseek', 'openai-compatible']);

export const DnaKeySchema = z.enum(DNA_KEYS);

export const ModelConfigSchema = z.object({
  text: z.object({
    provider: TextProviderSchema,
    model: z.string().default('agnes-2.5-flash'),
    apiKey: z.string().optional(),
    baseUrl: z.string().optional(),
    timeout: z.number().int().min(1000).default(180000),
    extraParams: z.record(z.any()).default({}),
  }).default({
    provider: 'agnes',
    model: 'agnes-2.5-flash',
    timeout: 180000,
    extraParams: {},
  }),
  image: z.object({
    provider: ImageProviderSchema,
    model: z.string().default('agnes-image-2.1-flash'),
    apiKey: z.string().optional(),
    baseUrl: z.string().optional(),
    timeout: z.number().int().min(1000).default(240000),
    extraParams: z.record(z.any()).default({}),
  }).default({
    provider: 'agnes',
    model: 'agnes-image-2.1-flash',
    timeout: 240000,
    extraParams: {},
  }),
  // 2026-09-03 新增：视觉模型独立配置。与 text/image 并列第三档。
  // 2026-09-07 引擎层 P2：enabled 默认改 true —— limb-guard 是图片一致性的关键防线，
  // 不应默关。无 vision key 时 limb-guard 内部只打 warning 不阻塞（见 limb-guard.ts）。
  vision: z.object({
    enabled: z.boolean().default(true),
    provider: VisionProviderSchema.default('gemini'),
    model: z.string().default('gemini-2.5-flash'),
    apiKey: z.string().optional(),
    baseUrl: z.string().optional(),
    // 2026-09-10：默认 30s → 90s。推理型多模态模型（DeepSeek V4.1 Flash）的思考 token
    // 会把耗时推到 30s 以上，30s 会导致评审请求被掐断、JSON 截断。
    timeout: z.number().int().min(1000).default(90000),
    extraParams: z.record(z.any()).default({}),
  }).default({
    enabled: true,
    provider: 'gemini',
    model: 'gemini-2.5-flash',
    timeout: 90000,
    extraParams: {},
  }),
  /**
   * 默认 DNA key。新建系列、/api/text、/api/image 未指定 dnaKey 时使用。
   * 创建系列后该字段被冻结到 series.dnaKey，不再受全局变更影响（防风格漂移）。
   */
  dnaKey: DnaKeySchema.default('new-yorker-noir'),
});

export type ModelConfig = z.infer<typeof ModelConfigSchema>;

const CONFIG_PATH = resolve(SERVER_DIR, 'runtime-config.json');

/** 配置缓存：按 mtime 失效。此前每个请求都 existsSync+readFileSync+zod parse。 */
let configCache: { mtime: number; value: ModelConfig } | null = null;

function loadDefaultsFromEnv(): ModelConfig {
  return {
    text: {
      provider: (process.env.TEXT_PROVIDER as any) || 'agnes',
      model: process.env.TEXT_MODEL || 'agnes-2.5-flash',
      apiKey: process.env.TEXT_API_KEY || process.env.AGNES_API_KEY || process.env.DEEPSEEK_API_KEY || process.env.GEMINI_API_KEY || undefined,
      baseUrl: process.env.TEXT_BASE_URL || 'https://apihub.agnes-ai.cn/v1',
      timeout: Number(process.env.TEXT_TIMEOUT || '180000'),
      extraParams: process.env.TEXT_EXTRA_PARAMS ? JSON.parse(process.env.TEXT_EXTRA_PARAMS) : {},
    },
    image: {
      provider: (process.env.IMAGE_PROVIDER as any) || 'agnes',
      model: process.env.IMAGE_MODEL || 'agnes-image-2.1-flash',
      apiKey: process.env.IMAGE_API_KEY || process.env.AGNES_API_KEY || process.env.STEP_API_KEY || process.env.MINIMAX_API_KEY || process.env.GEMINI_API_KEY || undefined,
      baseUrl: process.env.IMAGE_BASE_URL || 'https://apihub.agnes-ai.cn/v1',
      timeout: Number(process.env.IMAGE_TIMEOUT || '240000'),
      extraParams: process.env.IMAGE_EXTRA_PARAMS ? JSON.parse(process.env.IMAGE_EXTRA_PARAMS) : {},
    },
    // 2026-09-07：视觉模型默认从 env 兜底。
    // vision.enabled 默认 true（代码层已加固），无 key 时 limb-guard 内部打 warning。
    vision: {
      // 没显式 VISION_ENABLED 时按"开启"处理 —— 但没有 apiKey 时 limb-guard 自身会跳过。
      enabled: process.env.VISION_ENABLED === undefined
        ? true
        : (process.env.VISION_ENABLED.toLowerCase() === 'true' || process.env.VISION_ENABLED === '1'),
      provider: (process.env.VISION_PROVIDER as any) || 'gemini',
      model: process.env.VISION_MODEL || 'gemini-2.5-flash',
      // 2026-09-10：DEEPSEEK_API_KEY 加入兜底链 —— DeepSeek V4.1 Flash 已是多模态模型，
      // 可复用 text provider 的同一把 key 作视觉巡检。
      apiKey: process.env.VISION_API_KEY || process.env.GEMINI_API_KEY || process.env.DEEPSEEK_API_KEY || undefined,
      baseUrl: process.env.VISION_BASE_URL || '',
      // 2026-09-10：30s 对推理型视觉模型不够（思考 token 会拉长耗时），兜底提到 90s。
      timeout: Number(process.env.VISION_TIMEOUT || '90000'),
      extraParams: process.env.VISION_EXTRA_PARAMS ? JSON.parse(process.env.VISION_EXTRA_PARAMS) : {},
    },
    dnaKey: (process.env.DEFAULT_DNA_KEY as any) || 'graphic-novel-ink',
  };
}

export function getConfig(): ModelConfig {
  let mtime = 0;
  try {
    mtime = statSync(CONFIG_PATH).mtimeMs;
  } catch {
    // 配置文件不存在，走 env 默认值
  }
  if (configCache && configCache.mtime === mtime) return configCache.value;

  const defaults = loadDefaultsFromEnv();
  let value: ModelConfig;
  if (!existsSync(CONFIG_PATH)) {
    value = defaults;
  } else {
    try {
      const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
      value = ModelConfigSchema.parse({ ...defaults, ...raw });
    } catch (e) {
      console.warn('Failed to load runtime config, using env defaults:', e);
      value = defaults;
    }
  }
  configCache = { mtime, value };
  return value;
}

export function saveConfig(config: ModelConfig): ModelConfig {
  const validated = ModelConfigSchema.parse(config);
  writeFileSync(CONFIG_PATH, JSON.stringify(validated, null, 2));
  // 写后立即刷新缓存（mtime 可能同毫秒，不能等失效）
  let mtime = 0;
  try { mtime = statSync(CONFIG_PATH).mtimeMs; } catch { /* ignore */ }
  configCache = { mtime, value: validated };
  return validated;
}

export function getProviderApiKey(config: { apiKey?: string }): string {
  const key = config.apiKey;
  if (!key) {
    throw new Error('API key is not configured for the selected provider.');
  }
  return key;
}
