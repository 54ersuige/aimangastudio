import { z } from 'zod';
import dotenv from 'dotenv';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '../.env') });

export const TextProviderSchema = z.enum(['gemini', 'deepseek', 'agnes', 'openai-compatible']);
export const ImageProviderSchema = z.enum(['gemini', 'step', 'minimax', 'agnes', 'openai-compatible']);

export const ModelConfigSchema = z.object({
  text: z.object({
    provider: TextProviderSchema,
    model: z.string().default('deepseek-v4-flash'),
    apiKey: z.string().optional(),
    baseUrl: z.string().optional(),
    timeout: z.number().int().min(1000).default(60000),
    extraParams: z.record(z.any()).default({}),
  }).default({
    provider: 'deepseek',
    model: 'deepseek-v4-flash',
    timeout: 60000,
    extraParams: {},
  }),
  image: z.object({
    provider: ImageProviderSchema,
    model: z.string().default('image-01-live'),
    apiKey: z.string().optional(),
    baseUrl: z.string().optional(),
    timeout: z.number().int().min(1000).default(120000),
    extraParams: z.record(z.any()).default({}),
  }).default({
    provider: 'minimax',
    model: 'image-01-live',
    timeout: 120000,
    extraParams: {},
  }),
});

export type ModelConfig = z.infer<typeof ModelConfigSchema>;

const CONFIG_PATH = resolve(process.cwd(), 'runtime-config.json');

function loadDefaultsFromEnv(): ModelConfig {
  return {
    text: {
      provider: (process.env.TEXT_PROVIDER as any) || 'gemini',
      model: process.env.TEXT_MODEL || 'gemini-2.5-flash',
      apiKey: process.env.TEXT_API_KEY || process.env.DEEPSEEK_API_KEY || process.env.AGNES_API_KEY || process.env.GEMINI_API_KEY || undefined,
      baseUrl: process.env.TEXT_BASE_URL || undefined,
      timeout: Number(process.env.TEXT_TIMEOUT || '60000'),
      extraParams: process.env.TEXT_EXTRA_PARAMS ? JSON.parse(process.env.TEXT_EXTRA_PARAMS) : {},
    },
    image: {
      provider: (process.env.IMAGE_PROVIDER as any) || 'gemini',
      model: process.env.IMAGE_MODEL || 'gemini-2.5-flash-image-preview',
      apiKey: process.env.IMAGE_API_KEY || process.env.STEP_API_KEY || process.env.MINIMAX_API_KEY || process.env.AGNES_API_KEY || process.env.GEMINI_API_KEY || undefined,
      baseUrl: process.env.IMAGE_BASE_URL || undefined,
      timeout: Number(process.env.IMAGE_TIMEOUT || '120000'),
      extraParams: process.env.IMAGE_EXTRA_PARAMS ? JSON.parse(process.env.IMAGE_EXTRA_PARAMS) : {},
    },
  };
}

export function getConfig(): ModelConfig {
  const defaults = loadDefaultsFromEnv();
  if (!existsSync(CONFIG_PATH)) {
    return defaults;
  }
  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
    return ModelConfigSchema.parse({ ...defaults, ...raw });
  } catch (e) {
    console.warn('Failed to load runtime config, using env defaults:', e);
    return defaults;
  }
}

export function saveConfig(config: ModelConfig): ModelConfig {
  const validated = ModelConfigSchema.parse(config);
  writeFileSync(CONFIG_PATH, JSON.stringify(validated, null, 2));
  return validated;
}

export function getProviderApiKey(config: { apiKey?: string }): string {
  const key = config.apiKey;
  if (!key) {
    throw new Error('API key is not configured for the selected provider.');
  }
  return key;
}
