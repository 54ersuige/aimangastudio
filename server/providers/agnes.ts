import type { ModelConfig } from '../config.js';
import { getProviderApiKey } from '../config.js';
import type { TextRequest, TextResponse, ImageRequest, ImageResponse } from '../utils.js';
import { abortableFetch, stripThinkingTags } from '../utils.js';

const DEFAULT_BASE_URL = 'https://apihub.agnes-ai.cn/v1';

type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

function getBaseUrl(config: { baseUrl?: string }): string {
  return (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
}

// ─────────────────────────────────────────────────────────────────────────────
// Text generation — OpenAI-compatible /v1/chat/completions
// ─────────────────────────────────────────────────────────────────────────────

export async function generateText(config: ModelConfig['text'], req: TextRequest): Promise<TextResponse> {
  const apiKey = getProviderApiKey(config);
  const baseUrl = getBaseUrl(config);

  const messages: Array<{ role: 'system' | 'user'; content: string | ContentPart[] }> = [];
  if (req.systemInstruction) {
    messages.push({ role: 'system', content: req.systemInstruction });
  }

  const userContent: ContentPart[] = [];
  if (req.referenceImages && req.referenceImages.length > 0) {
    for (const img of req.referenceImages) {
      userContent.push({ type: 'image_url', image_url: { url: img.data } });
    }
  }

  if (req.jsonMode && req.jsonSchema) {
    userContent.push({
      type: 'text',
      text: `${req.prompt}\n\nYou must respond with a single valid JSON object matching this schema:\n${JSON.stringify(req.jsonSchema, null, 2)}`,
    });
  } else {
    userContent.push({ type: 'text', text: req.prompt });
  }

  messages.push({ role: 'user', content: userContent });

  const body: Record<string, unknown> = {
    model: config.model || 'agnes-2.5-flash',
    messages,
    stream: false,
    ...config.extraParams,
  };

  if (req.jsonMode) {
    body.response_format = { type: 'json_object' };
  }
  if (req.temperature !== undefined) body.temperature = req.temperature;
  if (req.maxTokens !== undefined) body.max_tokens = req.maxTokens;

  const res = await abortableFetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    timeout: config.timeout,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Agnes text API error ${res.status}: ${text}`);
  }

  const data = await res.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return { text: stripThinkingTags(data.choices?.[0]?.message?.content || '') };
}

// ─────────────────────────────────────────────────────────────────────────────
// Image generation — OpenAI-compatible /v1/images/generations
// ─────────────────────────────────────────────────────────────────────────────

export async function generateImage(config: ModelConfig['image'], req: ImageRequest): Promise<ImageResponse> {
  const apiKey = getProviderApiKey(config);
  const baseUrl = getBaseUrl(config);

  const body: Record<string, unknown> = {
    model: config.model || 'agnes-image-2.1-flash',
    prompt: req.prompt,
    n: 1,
    ...config.extraParams,
  };

  // Prefer aspect_ratio; fall back to width/height for OpenAI-style size param.
  if (req.aspectRatio) {
    body.aspect_ratio = req.aspectRatio;
  } else if (req.size) {
    body.size = `${req.size.width}x${req.size.height}`;
  }

  // Some Agnes image models accept reference images via extra_body.
  if (req.referenceImages && req.referenceImages.length > 0) {
    body.image = req.referenceImages.map((img) => img.data);
  }

  const res = await abortableFetch(`${baseUrl}/images/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    timeout: config.timeout,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Agnes image API error ${res.status}: ${text}`);
  }

  const data = await res.json() as {
    data?: Array<{ b64_json?: string; url?: string }>;
  };
  const first = data.data?.[0];
  if (!first) {
    throw new Error('No image returned from Agnes image API.');
  }

  if (first.b64_json) {
    return { image: `data:image/png;base64,${first.b64_json}` };
  }

  if (first.url) {
    const imageRes = await fetch(first.url);
    if (!imageRes.ok) {
      throw new Error(`Failed to download Agnes image: ${imageRes.statusText}`);
    }
    const buffer = Buffer.from(await imageRes.arrayBuffer());
    return { image: `data:image/png;base64,${buffer.toString('base64')}` };
  }

  throw new Error('No image data returned from Agnes image API.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Video generation — async submit → poll → download
// Agnes video endpoint returns a `video_id`; we poll a query endpoint until
// the task is succeeded/failed, then download the resulting URL.
// ─────────────────────────────────────────────────────────────────────────────

export interface AgnesVideoOptions {
  /** Optional callback fired with each poll status. */
  onProgress?: (status: string) => void;
  /** Polling interval in ms (default 8000). */
  pollIntervalMs?: number;
  /** Max total wait time in ms (default 10 minutes). */
  timeoutMs?: number;
}

interface AgnesSubmitResponse {
  video_id?: string;
  task_id?: string;
  id?: string;
  // Some endpoints return the result inline for fast models:
  status?: string;
  video_url?: string;
  url?: string;
  error?: string | { message?: string };
}

interface AgnesQueryResponse {
  status?: string; // queued | processing | succeeded | failed
  video_url?: string;
  url?: string;
  progress?: number;
  error?: string | { message?: string };
  code?: string;
}

/**
 * Generate a video via Agnes async task API.
 *
 * Endpoints used (configurable via baseUrl):
 *   POST  {baseUrl}/videos                → { id, video_id, status: "queued", ... }
 *   GET   {baseUrl}/videos/{video_id}     → { status, video_url, ... } (task_not_exist on bad id)
 *
 * On success, downloads the video bytes and returns a base64 data URL so
 * callers can do whatever they want with it (same pattern as generateImage).
 */
export async function generateVideo(
  config: ModelConfig['image'], // reuses image config slot for video
  prompt: string,
  options: AgnesVideoOptions & { referenceImage?: { data: string; mimeType: string } } = {},
): Promise<{ video: string; contentType: string }> {
  const apiKey = getProviderApiKey(config);
  const baseUrl = getBaseUrl(config);

  const submitBody: Record<string, unknown> = {
    model: config.model || 'agnes-video-v2.0',
    prompt,
    ...config.extraParams,
  };

  // Reference image (start frame). Agnes accepts URL or base64 data URI.
  if (options.referenceImage) {
    submitBody.image = options.referenceImage.data;
  }

  // ── submit ────────────────────────────────────────────────────────────────
  options.onProgress?.('Submitting video task...');
  const submitRes = await abortableFetch(`${baseUrl}/videos`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(submitBody),
    timeout: config.timeout || 60000,
  });

  if (!submitRes.ok) {
    const text = await submitRes.text();
    let message = text;
    try {
      const j = JSON.parse(text);
      message = j.message || j.error?.message || j.code || text;
    } catch { /* not JSON */ }
    throw new Error(`Agnes video submit failed ${submitRes.status}: ${message}`);
  }

  const submitData = (await submitRes.json()) as AgnesSubmitResponse;

  // Agnes returns 503 with {code: "video_queue_full"} when the queue is busy.
  if ((submitData as any).code === 'video_queue_full') {
    throw new Error(`Agnes video queue is full right now. Please retry in a few minutes.`);
  }

  const videoId = submitData.video_id || submitData.task_id || submitData.id;

  // If the server already returned a URL synchronously (fast path):
  if (submitData.video_url || submitData.url) {
    const url = submitData.video_url || submitData.url!;
    return await downloadVideo(url);
  }

  if (!videoId) {
    throw new Error(`Agnes video submit did not return a task id. Response: ${JSON.stringify(submitData)}`);
  }

  // ── poll ──────────────────────────────────────────────────────────────────
  const pollInterval = options.pollIntervalMs ?? 8000;
  const deadline = Date.now() + (options.timeoutMs ?? 10 * 60 * 1000);
  const progressMessages = [
    'Submitting task...',
    'Casting characters...',
    'Setting up the scene...',
    "Director is shouting 'Action!'...",
    'Rendering frames...',
    'Compositing layers...',
    'Adding final touches...',
  ];
  let pollCount = 0;

  while (Date.now() < deadline) {
    options.onProgress?.(progressMessages[pollCount % progressMessages.length]);
    await sleep(pollInterval);

    const queryRes = await abortableFetch(`${baseUrl}/videos/${encodeURIComponent(videoId)}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
      timeout: Math.min(pollInterval + 5000, 60000),
    });

    if (!queryRes.ok) {
      // Tolerate transient errors during polling; keep trying until deadline.
      pollCount++;
      continue;
    }

    const queryData = (await queryRes.json()) as AgnesQueryResponse;
    const status = (queryData.status || '').toLowerCase();

    if (typeof queryData.progress === 'number') {
      options.onProgress?.(`渲染中 ${Math.round(queryData.progress)}%...`);
    }

    if (status === 'succeeded' || status === 'success' || status === 'completed' || status === 'done') {
      const url = queryData.video_url || queryData.url;
      if (!url) {
        throw new Error(`Agnes video task succeeded but no URL returned: ${JSON.stringify(queryData)}`);
      }
      options.onProgress?.('Fetching video...');
      return await downloadVideo(url);
    }

    if (status === 'failed' || status === 'error' || status === 'cancelled') {
      const errMsg = typeof queryData.error === 'string'
        ? queryData.error
        : queryData.error?.message || JSON.stringify(queryData.error) || status;
      throw new Error(`Agnes video task ${status}: ${errMsg}`);
    }

    pollCount++;
  }

  throw new Error(`Agnes video task timed out after ${Math.round((Date.now() - (deadline - (options.timeoutMs ?? 600000))) / 1000)}s`);
}

async function downloadVideo(url: string): Promise<{ video: string; contentType: string }> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download video: ${res.status} ${res.statusText}`);
  }
  const contentType = res.headers.get('content-type') || 'video/mp4';
  const buffer = Buffer.from(await res.arrayBuffer());
  return {
    video: `data:${contentType};base64,${buffer.toString('base64')}`,
    contentType,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}