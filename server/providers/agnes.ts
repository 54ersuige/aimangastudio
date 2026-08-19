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
