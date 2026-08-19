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
import { sendError } from './utils.js';
import { withDnaImagePrompt, withDnaTextPrompt } from './dna-inject.js';

const router = Router();

function getTextProvider(config: ModelConfig['text']) {
  switch (config.provider) {
    case 'gemini':
      return gemini;
    case 'deepseek':
      return deepseek;
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
  });
});

function maskKey(key?: string): string | undefined {
  if (!key) return undefined;
  if (key.length <= 8) return '***';
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

const UpdateConfigSchema = z.object({
  text: z.object({
    provider: z.enum(['gemini', 'deepseek', 'agnes', 'openai-compatible']),
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
});

router.post('/config', (req, res) => {
  const parsed = UpdateConfigSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendError(res, 400, `Invalid config: ${parsed.error.message}`);
  }

  const current = getConfig();
  const next: ModelConfig = {
    text: { ...current.text, ...(parsed.data.text || {}) },
    image: { ...current.image, ...(parsed.data.image || {}) },
  };

  // When the frontend sends a masked key, preserve the original unless it changed.
  if (parsed.data.text?.apiKey?.includes('***')) {
    next.text.apiKey = current.text.apiKey;
  }
  if (parsed.data.image?.apiKey?.includes('***')) {
    next.image.apiKey = current.image.apiKey;
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
});

router.post('/text', async (req, res) => {
  const parsed = TextRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendError(res, 400, `Invalid request: ${parsed.error.message}`);
  }

  try {
    const config = getConfig().text;
    const provider = getTextProvider(config);
    const textReq = withDnaTextPrompt(parsed.data as TextRequest);
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
});

router.post('/image', async (req, res) => {
  const parsed = ImageRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendError(res, 400, `Invalid request: ${parsed.error.message}`);
  }

  try {
    const config = getConfig().image;
    const provider = getImageProvider(config);
    const imageReq = withDnaImagePrompt(parsed.data as ImageRequest);
    const result = await provider.generateImage(config, imageReq);
    res.json(result);
  } catch (e: any) {
    console.error('Image generation failed:', e);
    sendError(res, 502, e.message || 'Image generation failed');
  }
});

// Video generation is currently only supported by Agnes.
// Streams progress as SSE so the frontend can update the UI while polling.
const VideoRequestSchema = z.object({
  prompt: z.string().min(1),
  referenceImage: z
    .object({ data: z.string(), mimeType: z.string() })
    .optional()
    .transform((v) => (v ? { data: v.data, mimeType: v.mimeType } : undefined)),
  timeoutMs: z.number().int().min(5000).max(60 * 60 * 1000).optional(),
});

router.post('/video', async (req, res) => {
  const parsed = VideoRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendError(res, 400, `Invalid request: ${parsed.error.message}`);
  }

  const config = getConfig().image;
  if (config.provider !== 'agnes') {
    return sendError(
      res,
      400,
      `Video generation currently only supports the 'agnes' provider. ` +
        `Please switch the image/video model to Agnes in 模型配置 (model: ${config.model}).`,
    );
  }

  // Server-Sent Events for progress streaming.
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const sendEvent = (data: Record<string, unknown>) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const result = await agnes.generateVideo(config, parsed.data.prompt, {
      ...(parsed.data.referenceImage ? { referenceImage: parsed.data.referenceImage } : {}),
      timeoutMs: parsed.data.timeoutMs,
      onProgress: (status) => sendEvent({ type: 'progress', status }),
    });
    sendEvent({ type: 'done', video: result.video, contentType: result.contentType });
    res.end();
  } catch (e: any) {
    console.error('Video generation failed:', e);
    sendEvent({ type: 'error', error: e.message || 'Video generation failed' });
    res.end();
  }
});

export default router;
