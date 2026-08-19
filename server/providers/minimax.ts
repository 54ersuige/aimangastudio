import type { ModelConfig } from '../config.js';
import { getProviderApiKey } from '../config.js';
import type { ImageRequest, ImageResponse } from '../utils.js';
import { abortableFetch, base64FromDataUrl } from '../utils.js';

export async function generateImage(config: ModelConfig['image'], req: ImageRequest): Promise<ImageResponse> {
  const apiKey = getProviderApiKey(config);
  const baseUrl = (config.baseUrl || 'https://api.minimaxi.chat/v1').replace(/\/$/, '');

  const body: Record<string, unknown> = {
    model: config.model || 'image-01-live',
    prompt: req.prompt,
    ...config.extraParams,
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
