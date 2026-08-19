import type { ModelConfig } from './modelConfig';
import { getServerUrl } from './modelConfig';

function apiUrl(path: string): string {
  const base = getServerUrl();
  return base ? `${base}${path}` : path;
}

async function postJson<T>(path: string, body: unknown, timeout = 60000): Promise<T> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(apiUrl(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      let message = `Request failed: ${response.status}`;
      try {
        const parsed = JSON.parse(text);
        if (parsed.error) message = parsed.error;
      } catch {
        message = text || message;
      }
      throw new Error(message);
    }

    return (await response.json()) as T;
  } finally {
    clearTimeout(id);
  }
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(apiUrl(path));
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

export interface TextGenerationRequest {
  prompt: string;
  systemInstruction?: string;
  jsonMode?: boolean;
  jsonSchema?: Record<string, unknown>;
  temperature?: number;
  maxTokens?: number;
  referenceImages?: { data: string; mimeType: string }[];
}

export interface TextGenerationResponse {
  text: string;
}

export interface ImageGenerationRequest {
  prompt: string;
  referenceImages?: { data: string; mimeType: string }[];
  aspectRatio?: string;
  size?: { width: number; height: number };
}

export interface ImageGenerationResponse {
  image: string;
}

export async function generateText(
  req: TextGenerationRequest,
  timeout = 60000,
): Promise<TextGenerationResponse> {
  return postJson<TextGenerationResponse>('/api/text', req, timeout);
}

export async function generateImage(
  req: ImageGenerationRequest,
  timeout = 120000,
): Promise<ImageGenerationResponse> {
  return postJson<ImageGenerationResponse>('/api/image', req, timeout);
}

export async function fetchServerConfig(): Promise<{ text: ModelConfig['text']; image: ModelConfig['image'] }> {
  return getJson('/api/config');
}

export async function updateServerConfig(config: ModelConfig): Promise<{ success: boolean }> {
  return postJson('/api/config', config, 30000);
}
