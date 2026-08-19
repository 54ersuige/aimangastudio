export type TextProvider = 'gemini' | 'deepseek' | 'agnes' | 'openai-compatible';
export type ImageProvider = 'gemini' | 'step' | 'minimax' | 'agnes' | 'openai-compatible';

export interface TextModelConfig {
  provider: TextProvider;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  timeout: number;
  extraParams: Record<string, unknown>;
}

export interface ImageModelConfig {
  provider: ImageProvider;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  timeout: number;
  extraParams: Record<string, unknown>;
}

export interface ModelConfig {
  text: TextModelConfig;
  image: ImageModelConfig;
}

export const DEFAULT_TEXT_CONFIG: TextModelConfig = {
  provider: 'deepseek',
  model: 'deepseek-v4-flash',
  apiKey: '',
  baseUrl: 'https://api.deepseek.com',
  timeout: 60000,
  extraParams: {},
};

export const DEFAULT_IMAGE_CONFIG: ImageModelConfig = {
  provider: 'minimax',
  model: 'image-01-live',
  apiKey: '',
  baseUrl: 'https://api.minimaxi.chat/v1',
  timeout: 120000,
  extraParams: {},
};

export const DEFAULT_MODEL_CONFIG: ModelConfig = {
  text: DEFAULT_TEXT_CONFIG,
  image: DEFAULT_IMAGE_CONFIG,
};

const LOCAL_STORAGE_KEY = 'aimangastudio_model_config';

export function loadModelConfig(): ModelConfig {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return DEFAULT_MODEL_CONFIG;
    const parsed = JSON.parse(raw);
    return mergeWithDefaults(parsed);
  } catch {
    return DEFAULT_MODEL_CONFIG;
  }
}

export function saveModelConfig(config: ModelConfig): void {
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(config));
}

function mergeWithDefaults(partial: Partial<ModelConfig>): ModelConfig {
  return {
    text: { ...DEFAULT_TEXT_CONFIG, ...partial.text },
    image: { ...DEFAULT_IMAGE_CONFIG, ...partial.image },
  };
}

export function getServerUrl(): string {
  if (typeof process !== 'undefined' && process.env.SERVER_URL) {
    return process.env.SERVER_URL;
  }
  return '';
}
