import type { ModelConfig } from '../config.js';
import { getProviderApiKey } from '../config.js';
import type { TextRequest, TextResponse, ImageRequest, ImageResponse } from '../utils.js';
import { abortableFetch, base64FromDataUrl, stripThinkingTags } from '../utils.js';

type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

/**
 * 文本生成（Minimax / Chat Completions 兼容接口）。
 * 文档：https://platform.minimaxi.com/document/ChatCompletion
 * 默认 baseUrl：https://api.minimaxi.chat/v1
 * 注意：Minimax 官方默认 model 是 `MiniMax-Text-01` 或 `abab6.5s-chat`；
 *       用户有自己 tokenplan，所以这里只兜底"image-01-live 之外给个文本默认"。
 *       真正的模型名应在 ModelConfigModal 里手动选/填。
 */
export async function generateText(config: ModelConfig['text'], req: TextRequest): Promise<TextResponse> {
  const apiKey = getProviderApiKey(config);
  const baseUrl = (config.baseUrl || 'https://api.minimaxi.com/v1').replace(/\/$/, '');
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

  // model 必填：tokenplan 模型名（如 MiniMax-M3）不属于官方默认清单，
  // 误填兜底模型名会导致 401/404，所以这里不兜底，强制要求用户填写。
  const model = config.model;
  if (!model) throw new Error('请先在模型配置里填写 Minimax 模型名（例如 MiniMax-M3）。');
  const body: Record<string, unknown> = {
    model,
    messages,
    stream: false,
    ...config.extraParams,
  };
  if (req.jsonMode) body.response_format = { type: 'json_object' };
  if (req.temperature !== undefined) body.temperature = req.temperature;
  if (req.maxTokens !== undefined) body.max_tokens = req.maxTokens;

  // 端点选择：tokenplan 走 OpenAI 兼容的 /chat/completions；其它老账号走 minimax 官方 v2。
//  用户可以通过 extraParams.apiVersion = 'v2' 强制使用官方 v2 端点（消息结构不同，会失败）。
const useOfficialV2 = (config.extraParams as any)?.apiVersion === 'v2';
const endpoint = useOfficialV2 ? `${baseUrl}/text/chatcompletion_v2` : `${baseUrl}/chat/completions`;
const res = await abortableFetch(endpoint, {
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
    throw new Error(`Minimax API error ${res.status}: ${text}`);
  }

  const data = await res.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content || '';
  return { text: stripThinkingTags(content) };
}

export async function generateImage(config: ModelConfig['image'], req: ImageRequest): Promise<ImageResponse> {
  const apiKey = getProviderApiKey(config);
  const baseUrl = (config.baseUrl || 'https://api.minimaxi.com/v1').replace(/\/$/, '');

  // 同上：图模型也必须用户填写，避免错误兜底。
  const model = config.model;
  if (!model) throw new Error('请先在模型配置里填写 Minimax 图模型名。');
  const body: Record<string, unknown> = {
    model,
    prompt: req.prompt,
    ...config.extraParams,
    // 请求级参数（DNA 注入的 negative_prompt 等护栏）覆盖配置级默认值
    ...req.extraParams,
  };

  if (req.aspectRatio) {
    body.aspect_ratio = req.aspectRatio;
  }

  if (req.size) {
    body.width = req.size.width;
    body.height = req.size.height;
  }

  if (req.referenceImages && req.referenceImages.length > 0) {
    body.reference_images = req.referenceImages.map((img: { data: string; mimeType: string }) => {
      const { data, mimeType } = base64FromDataUrl(img.data);
      return { data, mime_type: mimeType };
    });
  }

  const res = await abortableFetch(`${baseUrl}/image_generation`, {
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
    throw new Error(`Minimax API error ${res.status}: ${text}`);
  }

  const data = await res.json() as {
    data?: { image?: { image_url?: string; image_b64?: string } };
  };
  const image = data.data?.image;
  if (!image) {
    throw new Error('No image returned from Minimax API.');
  }

  if (image.image_b64) {
    return { image: `data:image/png;base64,${image.image_b64}` };
  }

  if (image.image_url) {
    const imageRes = await fetch(image.image_url);
    if (!imageRes.ok) {
      throw new Error(`Failed to download Minimax image: ${imageRes.statusText}`);
    }
    const buffer = Buffer.from(await imageRes.arrayBuffer());
    return { image: `data:image/png;base64,${buffer.toString('base64')}` };
  }

  throw new Error('No image data returned from Minimax API.');
}
