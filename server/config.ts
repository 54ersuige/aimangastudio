import { z } from 'zod';
import dotenv from 'dotenv';
import { existsSync, readFileSync, writeFileSync, statSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { DNA_KEYS } from './dna/registry.js';

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));

// 路径基于模块真实位置而非 process.cwd() —— 从任意目录启动都不会找错文件
dotenv.config({ path: resolve(SERVER_DIR, '../.env') });

export const TextProviderSchema = z.enum(['gemini', 'deepseek', 'agnes', 'openai-compatible']);
export const ImageProviderSchema = z.enum(['gemini', 'step', 'minimax', 'agnes', 'openai-compatible']);

export const DnaKeySchema = z.enum(DNA_KEYS);

export const ModelConfigSchema = z.object({
  text: z.object({
    provider: TextProviderSchema,
    model: z.string().default('agnes-2.5-flash'),
    apiKey: z.string().optional(),
    baseUrl: z.string().optional(),
    timeout: z.number().int().min(1000).default(60000),
    extraParams: z.record(z.any()).default({}),
  }).default({
    provider: 'agnes',
    model: 'agnes-2.5-flash',
    timeout: 60000,
    extraParams: {},
  }),
  image: z.object({
    provider: ImageProviderSchema,
    model: z.string().default('agnes-image-2.1-flash'),
    apiKey: z.string().optional(),
    baseUrl: z.string().optional(),
    timeout: z.number().int().min(1000).default(120000),
    extraParams: z.record(z.any()).default({}),
  }).default({
    provider: 'agnes',
    model: 'agnes-image-2.1-flash',
    timeout: 120000,
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
      timeout: Number(process.env.TEXT_TIMEOUT || '60000'),
      extraParams: process.env.TEXT_EXTRA_PARAMS ? JSON.parse(process.env.TEXT_EXTRA_PARAMS) : {},
    },
    image: {
      provider: (process.env.IMAGE_PROVIDER as any) || 'agnes',
      model: process.env.IMAGE_MODEL || 'agnes-image-2.1-flash',
      apiKey: process.env.IMAGE_API_KEY || process.env.AGNES_API_KEY || process.env.STEP_API_KEY || process.env.MINIMAX_API_KEY || process.env.GEMINI_API_KEY || undefined,
      baseUrl: process.env.IMAGE_BASE_URL || 'https://apihub.agnes-ai.cn/v1',
      timeout: Number(process.env.IMAGE_TIMEOUT || '120000'),
      extraParams: process.env.IMAGE_EXTRA_PARAMS ? JSON.parse(process.env.IMAGE_EXTRA_PARAMS) : {},
    },
    dnaKey: (process.env.DEFAULT_DNA_KEY as any) || 'new-yorker-noir',
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
