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
  provider: 'agnes',
  model: 'agnes-2.5-flash',
  apiKey: '',
  baseUrl: 'https://apihub.agnes-ai.cn/v1',
  timeout: 60000,
  extraParams: {},
};

export const DEFAULT_IMAGE_CONFIG: ImageModelConfig = {
  provider: 'agnes',
  model: 'agnes-image-2.1-flash',
  apiKey: '',
  baseUrl: 'https://apihub.agnes-ai.cn/v1',
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
