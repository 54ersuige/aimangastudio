export type TextProvider = 'gemini' | 'deepseek' | 'minimax' | 'agnes' | 'openai-compatible';
export type ImageProvider = 'gemini' | 'step' | 'minimax' | 'agnes' | 'openai-compatible';
// 2026-09-03：视觉（多模态）provider —— 与 server/config.ts VisionProviderSchema 同步。
// limb-guard 巡检"多胳膊/多手指"用，专做图像内容理解。
// 2026-09-10：加入 deepseek —— DeepSeek V4.1 Flash 原生多模态（id: deepseek-flash），
// 可作视觉模型；已实测 image_url + json_object 均可用。
export type VisionProvider = 'gemini' | 'minimax' | 'agnes' | 'deepseek' | 'openai-compatible';

/**
 * DNA key —— 系统支持的视觉风格预设。改这里必须同步 server/dna/registry.ts。
 * 创建系列时锁定；用户不可在运行时自由拼接（防风格漂移）。
 */
export type DnaKey = 'graphic-novel-ink' | 'new-yorker-noir' | 'shonen-vintage' | 'cinematic-realism';

/** DNA 元数据（前端展示用）。 */
export interface DnaMeta {
  key: DnaKey;
  name: string;
  tagline: string;
  genres: string[];
}

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

// 2026-09-03：视觉模型独立配置接口。结构与 Text 相同 + 一个 enabled 开关。
// enabled=false 时 limb-guard 直接跳过（视作图片通过）。
export interface VisionModelConfig {
  enabled: boolean;
  provider: VisionProvider;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  timeout: number;
  extraParams: Record<string, unknown>;
}

export interface ModelConfig {
  text: TextModelConfig;
  image: ImageModelConfig;
  /** 2026-09-03：第三档，视觉（多模态）模型独立配置。 */
  vision: VisionModelConfig;
  /** 默认 DNA key。新建系列时使用；已创建系列的 dnaKey 在 series 字段上冻结。 */
  dnaKey?: DnaKey;
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

// 2026-09-03：vision 兜底默认。enabled=false 保证新装应用不会自动启用 limb-guard
// （用户没填视觉模型 key 时不能让 limb-guard 报 500）。
export const DEFAULT_VISION_CONFIG: VisionModelConfig = {
  enabled: false,
  provider: 'gemini',
  model: 'gemini-2.5-flash',
  apiKey: '',
  baseUrl: '',
  // 2026-09-10：与 server/config.ts 同步提到 90s —— 推理型视觉模型思考耗时会超过 30s。
  timeout: 90000,
  extraParams: {},
};

export const DEFAULT_DNA_KEY: DnaKey = 'graphic-novel-ink';

export const DEFAULT_MODEL_CONFIG: ModelConfig = {
  text: DEFAULT_TEXT_CONFIG,
  image: DEFAULT_IMAGE_CONFIG,
  vision: DEFAULT_VISION_CONFIG,
  dnaKey: DEFAULT_DNA_KEY,
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
    // 2026-09-03：vision 同样兜底 merge，老数据没有 vision 字段时走默认值。
    // 重要：partial.vision 没有 enabled 字段时要补默认 false，避免 undefined 误判为 true。
    vision: partial.vision
      ? { ...DEFAULT_VISION_CONFIG, ...partial.vision, enabled: partial.vision.enabled ?? DEFAULT_VISION_CONFIG.enabled }
      : DEFAULT_VISION_CONFIG,
    dnaKey: (partial.dnaKey as DnaKey | undefined) || DEFAULT_DNA_KEY,
  };
}

export function getServerUrl(): string {
  if (typeof process !== 'undefined' && process.env.SERVER_URL) {
    return process.env.SERVER_URL;
  }
  return '';
}
