import type { Response as ExpressResponse } from 'express';
import { appendFileSync, mkdirSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const LOG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'logs');
const GEN_LOG_PATH = join(LOG_DIR, 'generations.jsonl');

/**
 * 生成审计日志：每次文/图生成把完整 prompt 落盘为 JSONL。
 * 排查「这张图当时是怎么生成的 / 画风为什么不对」时可直接回溯。
 */
export function logGeneration(kind: string, payload: Record<string, unknown>): void {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    appendFileSync(GEN_LOG_PATH, JSON.stringify({ ts: new Date().toISOString(), kind, ...payload }) + '\n');
  } catch {
    // 日志失败不影响主流程
  }
}

export interface TextRequest {
  prompt: string;
  systemInstruction?: string;
  jsonMode?: boolean;
  jsonSchema?: Record<string, unknown>;
  temperature?: number;
  maxTokens?: number;
  referenceImages?: { data: string; mimeType: string }[];
}

export interface TextResponse {
  text: string;
}

export interface ImageRequest {
  prompt: string;
  referenceImages?: { data: string; mimeType: string }[];
  aspectRatio?: string;
  size?: { width: number; height: number };
  /**
   * 请求级额外参数（如 negative_prompt）。
   * Provider 构建请求体时应展开在 config.extraParams 之后（请求级覆盖配置级），
   * 否则 DNA 注入的负面提示词等会静默丢失。
   */
  extraParams?: Record<string, unknown>;
}

export interface ImageResponse {
  image: string; // data URL
}

export function sendError(res: ExpressResponse, status: number, message: string) {
  res.status(status).json({ error: message });
}

export function base64FromDataUrl(dataUrl: string): { data: string; mimeType: string } {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    throw new Error('Invalid data URL');
  }
  return { mimeType: match[1], data: match[2] };
}

export function abortableFetch(input: RequestInfo, init: RequestInit & { timeout?: number }): Promise<globalThis.Response> {
  const { timeout = 60000, ...rest } = init;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  return fetch(input, { ...rest, signal: controller.signal }).finally(() => clearTimeout(id));
}

export function stripThinkingTags(text: string): string {
  // Some reasoning models wrap final answer in <think>...</think>; remove it.
  return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}
