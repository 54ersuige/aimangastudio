import type { ModelConfig } from '../config.js';
import { getProviderApiKey } from '../config.js';
import type { ImageRequest, ImageResponse } from '../utils.js';
import { abortableFetch, base64FromDataUrl } from '../utils.js';

// step-image-edit-2 支持的尺寸白名单
const STEP_ALLOWED_SIZES = [
  '1024x1024',
  '768x1360',   // 9:16 竖版
  '896x1184',   // 3:4 竖版
  '1360x768',   // 16:9 横版
  '1184x896',   // 4:3 横版
];

/**
 * 在白名单中挑一个最接近请求 size 的尺寸
 * 优先按宽高比匹配，其次按面积
 */
function pickClosestSize(reqW: number, reqH: number): string {
  const reqRatio = reqW / reqH;
  let best = STEP_ALLOWED_SIZES[0];
  let bestScore = Number.POSITIVE_INFINITY;
  for (const s of STEP_ALLOWED_SIZES) {
    const [w, h] = s.split('x').map(Number);
    const ratio = w / h;
    // 比例差 + 归一化面积差
    const ratioDiff = Math.abs(Math.log(ratio) - Math.log(reqRatio));
    const areaDiff = Math.abs(w * h - reqW * reqH) / (reqW * reqH);
    const score = ratioDiff * 2 + areaDiff;
    if (score < bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return best;
}

export async function generateImage(config: ModelConfig['image'], req: ImageRequest): Promise<ImageResponse> {
  const apiKey = getProviderApiKey(config);
  const baseUrl = (config.baseUrl || 'https://api.stepfun.com/v1').replace(/\/$/, '');

  // Build a prompt that includes reference image descriptions if available.
  let prompt = req.prompt;
  if (req.referenceImages && req.referenceImages.length > 0) {
    prompt += '\n\nReference images are provided as base64 data.';
  }

  const body: Record<string, unknown> = {
    model: config.model || 'step-image-edit-2',
    prompt,
    response_format: 'b64_json',
    ...config.extraParams,
  };

  if (req.size) {
    const requested = `${req.size.width}x${req.size.height}`;
    body.size = STEP_ALLOWED_SIZES.includes(requested)
      ? requested
      : pickClosestSize(req.size.width, req.size.height);
  }

  // step-image-edit-2 may accept a list of reference images via extraParams.
  if (req.referenceImages && req.referenceImages.length > 0) {
    body.reference_images = req.referenceImages.map((img: { data: string; mimeType: string }) => {
      const { data, mimeType } = base64FromDataUrl(img.data);
      return { data, mime_type: mimeType };
    });
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
    throw new Error(`Step API error ${res.status}: ${text}`);
  }

  const data = await res.json() as {
    data?: Array<{ b64_json?: string; url?: string }>;
  };
  const first = data.data?.[0];
  if (!first) {
    throw new Error('No image returned from Step API.');
  }

  if (first.b64_json) {
    return { image: `data:image/png;base64,${first.b64_json}` };
  }

  if (first.url) {
    const imageRes = await fetch(first.url);
    if (!imageRes.ok) {
      throw new Error(`Failed to download Step image: ${imageRes.statusText}`);
    }
    const buffer = Buffer.from(await imageRes.arrayBuffer());
    return { image: `data:image/png;base64,${buffer.toString('base64')}` };
  }

  throw new Error('No image data returned from Step API.');
}
