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
 * 阶跃星辰 API 的"字符"按 CJK 单字、英文/数字按词计，与简单 `.length` 不同。
 * 这里用一个保守近似：CJK 区间 [一-鿿]、[぀-ゟ] 等算 1，其它非空白连续段算 1。
 * 这样即便有少量 Unicode 边缘情况也只会比真实计费偏大，永远不会让请求被拒。
 */
function stepCharCount(s: string): number {
  let n = 0;
  let i = 0;
  while (i < s.length) {
    const code = s.charCodeAt(i);
    // CJK Unified Ideographs + Extension A..G + 兼容 + 笔画 + 部首 + 日韩 + 全角
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0x20000 && code <= 0x2a6df) ||
      (code >= 0x2a700 && code <= 0x2b73f) ||
      (code >= 0x2b740 && code <= 0x2b81f) ||
      (code >= 0x2b820 && code <= 0x2ceaf) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0x2f800 && code <= 0x2fa1f) ||
      (code >= 0x3040 && code <= 0x30ff) || // Hiragana + Katakana
      (code >= 0xac00 && code <= 0xd7af) || // Hangul Syllables
      (code >= 0xff00 && code <= 0xffef)    // Fullwidth forms
    ) {
      n += 1;
      i += 1;
    } else if (/\s/.test(s[i])) {
      // 空白不计入字数
      i += 1;
    } else {
      // 连续的拉丁/数字/符号算 1 个"词"
      n += 1;
      while (
        i < s.length &&
        !/\s/.test(s[i]) &&
        !((s.charCodeAt(i) >= 0x4e00 && s.charCodeAt(i) <= 0x9fff))
      ) {
        i += 1;
      }
    }
  }
  return n;
}

/** 按 API 计费规则把字符串截到 limit 字符以内；优先保留尾部场景描述。 */
function clampStepText(text: string, limit: number): string {
  const total = stepCharCount(text);
  if (total <= limit) return text;

  // 从左往右扫描，记录每个"单位"（CJK 单字或拉丁/数字词）的起始偏移；
  // 然后从 total - limit + 1 个单位开始截取，正好保留 limit 个单位。
  const unitStarts: number[] = [];
  let n = 0;
  let i = 0;
  while (i < text.length) {
    const code = text.charCodeAt(i);
    let endOfUnit = i + 1;
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0x3040 && code <= 0x30ff) ||
      (code >= 0xac00 && code <= 0xd7af) ||
      (code >= 0x20000 && code <= 0x2a6df) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0x2f800 && code <= 0x2fa1f) ||
      (code >= 0xff00 && code <= 0xffef)
    ) {
      n += 1;
      endOfUnit = i + 1;
    } else if (/\s/.test(text[i])) {
      i += 1;
      continue;
    } else {
      n += 1;
      endOfUnit = i + 1;
      while (
        endOfUnit < text.length &&
        !/\s/.test(text[endOfUnit]) &&
        !((text.charCodeAt(endOfUnit) >= 0x4e00 && text.charCodeAt(endOfUnit) <= 0x9fff))
      ) {
        endOfUnit += 1;
      }
    }
    i = endOfUnit;
    unitStarts.push(i); // 下一个单位的起始 = 当前单位的结束
  }

  const skipUnits = total - limit;
  if (skipUnits <= 0) return text;
  if (skipUnits >= unitStarts.length) return '';
  let sliceStart = unitStarts[skipUnits];
  // 去掉前导空白
  while (sliceStart < text.length && /\s/.test(text[sliceStart])) sliceStart += 1;
  return text.slice(sliceStart);
}

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

  // 阶跃星辰 step-image-edit-2 限制 prompt 最长 512 字符（CJK 按字、英文按词计）。
  // 我们的 DNA 注入会把大段风格说明拼到 prompt 前部，需要尾部截断以保留场景内容。
  //
  // 2026-09-01 升级：截断前先打印原始长度 + 头/尾样本，让用户能在日志里看到
  // "Step 截断了哪段"。否则失败时只能看到 silent truncation。
  if (stepCharCount(prompt) > 512) {
    console.warn(
      `[step] prompt ${stepCharCount(prompt)} 字符 > 512 上限，将被尾部截断。\n` +
      `  head(120): ${JSON.stringify(prompt.slice(0, 120))}\n` +
      `  tail(120): ${JSON.stringify(prompt.slice(-120))}\n` +
      `  提示：频繁出现这条时应切 image.provider 到 agnes，或缩短 promptTail / 性别年龄段段。`,
    );
  }
  prompt = clampStepText(prompt, 512);

  const body: Record<string, unknown> = {
    model: config.model || 'step-image-edit-2',
    prompt,
    response_format: 'b64_json',
    ...config.extraParams,
  };

  // negative_prompt 也限制 512 字符；cfg_scale=1.0 时底层不消费但仍计长，照样截断。
  const np = body.negative_prompt;
  if (typeof np === 'string') {
    body.negative_prompt = clampStepText(np, 512);
  }

  if (req.size) {
    const requested = `${req.size.width}x${req.size.height}`;
    body.size = STEP_ALLOWED_SIZES.includes(requested)
      ? requested
      : pickClosestSize(req.size.width, req.size.height);
  } else if (req.aspectRatio) {
    // aspectRatio 字符串（'4:5' / '1:1' / '3:4'）→ 选白名单里最接近的尺寸
    const m = req.aspectRatio.match(/^(\d+):(\d+)$/);
    if (m) {
      const w = Number(m[1]);
      const h = Number(m[2]);
      body.size = pickClosestSize(w, h);
    }
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
