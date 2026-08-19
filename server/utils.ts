import type { Response as ExpressResponse } from 'express';

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
