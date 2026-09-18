import type { ModelConfig } from '../config.js';
import { getProviderApiKey } from '../config.js';
import type { TextRequest, TextResponse, ImageRequest, ImageResponse } from '../utils.js';
import { abortableFetch, stripThinkingTags } from '../utils.js';

const DEFAULT_BASE_URL = 'https://apihub.agnes-ai.cn/v1';

// 2026-09-08：Agnes 网关的 image_url 只接受纯字符串（非 OpenAI 标准 {url} 对象）
type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: string };

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
      // 2026-09-08 修复：Agnes 网关只接受 image_url 为纯字符串（data URL），
      // OpenAI 标准的 { url } 对象格式会被网关静默丢弃 → 模型返回空文本。
      // 实测：{url:{...}} => 空；纯字符串 => 正常识图。详见 tools/test-agnes-raw.mjs。
      userContent.push({ type: 'image_url', image_url: img.data });
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
//
// 2026-09-17：Agnes 图生图（reference images）必须走 multipart /v1/images/edits，
// 不是把 `image` 数组塞进 JSON body。JSON body 带 image 会被网关路由到 LLM 端点
// 并报 "LLM Provider NOT provided"。详见 tools/probe-image-edits2.mjs。
//
// 行为约定：
//   - 无 referenceImages → 继续走 /v1/images/generations（JSON），行为完全不变。
//   - 有 referenceImages → 走 /v1/images/edits（multipart）。Agnes 的 edit 端点
//     字段名是 `image`（OpenAI 兼容），size 等可同步放在 form-data。

function dataUrlToBuffer(dataUrl: string): { buffer: Buffer; mime: string } {
  const m = dataUrl.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
  if (!m) throw new Error('referenceImages[i].data must be a data URL');
  const mime = m[1] || 'image/png';
  const isBase64 = !!m[2];
  const payload = m[3];
  return {
    buffer: isBase64 ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload), 'utf8'),
    mime,
  };
}

export async function generateImage(config: ModelConfig['image'], req: ImageRequest): Promise<ImageResponse> {
  const apiKey = getProviderApiKey(config);
  const baseUrl = getBaseUrl(config);

  const hasRefs = !!(req.referenceImages && req.referenceImages.length > 0);

  // ── 图生图：multipart /v1/images/edits ─────────────────────────────────────
  if (hasRefs) {
    const form = new FormData();
    form.append('model', config.model || 'agnes-image-2.5-flash');
    form.append('prompt', req.prompt);
    form.append('n', String(req.extraParams?.n ?? 1));
    if (req.aspectRatio) {
      form.append('aspect_ratio', req.aspectRatio);
    } else if (req.size) {
      form.append('size', `${req.size.width}x${req.size.height}`);
    }
    for (const [k, v] of Object.entries(config.extraParams || {})) {
      if (v == null) continue;
      form.append(k, typeof v === 'string' ? v : JSON.stringify(v));
    }
    for (const [k, v] of Object.entries(req.extraParams || {})) {
      if (v == null || k === 'n') continue;
      form.append(k, typeof v === 'string' ? v : JSON.stringify(v));
    }
    req.referenceImages!.forEach((img, i) => {
      const { buffer, mime } = dataUrlToBuffer(img.data);
      form.append('image', new Blob([buffer], { type: mime }), `ref-${i}.${mime.split('/')[1] || 'png'}`);
    });

    const res = await abortableFetch(`${baseUrl}/images/edits`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      body: form,
      timeout: config.timeout,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Agnes image-edit API error ${res.status}: ${text}`);
    }
    return await parseAgnesImageResponse(res);
  }

  // ── 纯文生图：JSON /v1/images/generations ──────────────────────────────────
  const body: Record<string, unknown> = {
    model: config.model || 'agnes-image-2.0-flash',
    prompt: req.prompt,
    n: 1,
    ...config.extraParams,
    // 请求级参数（DNA 注入的 negative_prompt 等）覆盖配置级默认值
    ...req.extraParams,
  };

  if (req.aspectRatio) {
    body.aspect_ratio = req.aspectRatio;
  } else if (req.size) {
    body.size = `${req.size.width}x${req.size.height}`;
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
  return await parseAgnesImageResponse(res);
}

async function parseAgnesImageResponse(res: Response): Promise<ImageResponse> {
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
