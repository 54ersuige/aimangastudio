import { GoogleGenAI, Modality, Type } from '@google/genai';
import type { ModelConfig } from '../config.js';
import { getProviderApiKey } from '../config.js';
import type { TextRequest, TextResponse, ImageRequest, ImageResponse } from '../utils.js';
import { base64FromDataUrl } from '../utils.js';

function getClient(config: ModelConfig['text'] | ModelConfig['image']) {
  const apiKey = getProviderApiKey(config);
  return new GoogleGenAI({ apiKey });
}

function base64ToGeminiPart(base64: string, mimeType: string) {
  return {
    inlineData: {
      data: base64FromDataUrl(base64).data,
      mimeType,
    },
  };
}

export async function generateText(config: ModelConfig['text'], req: TextRequest): Promise<TextResponse> {
  const client = getClient(config);
  const model = config.model || 'gemini-2.5-flash';

  const parts: Array<{ text: string } | { inlineData: { data: string; mimeType: string } }> = [];
  let fullPrompt = req.prompt;
  if (req.systemInstruction) {
    fullPrompt = `${req.systemInstruction}\n\n${fullPrompt}`;
  }
  parts.push({ text: fullPrompt });

  if (req.referenceImages) {
    for (const img of req.referenceImages) {
      const { data, mimeType } = base64FromDataUrl(img.data);
      parts.push(base64ToGeminiPart(data, mimeType));
    }
  }

  const requestConfig: Record<string, unknown> = {};
  if (req.jsonMode) {
    requestConfig.responseMimeType = 'application/json';
    if (req.jsonSchema) {
      requestConfig.responseSchema = req.jsonSchema;
    } else {
      requestConfig.responseSchema = { type: Type.OBJECT, properties: { result: { type: Type.STRING } }, required: ['result'] };
    }
  }

  const response = await client.models.generateContent({
    model,
    contents: { parts },
    config: requestConfig,
  });

  return { text: response.text || '' };
}

export async function generateImage(config: ModelConfig['image'], req: ImageRequest): Promise<ImageResponse> {
  const client = getClient(config);
  const model = config.model || 'gemini-2.5-flash-image-preview';

  const parts: Array<{ text: string } | { inlineData: { data: string; mimeType: string } }> = [
    { text: req.prompt },
  ];

  if (req.referenceImages) {
    for (const img of req.referenceImages) {
      const { data, mimeType } = base64FromDataUrl(img.data);
      parts.push(base64ToGeminiPart(data, mimeType));
    }
  }

  const response = await client.models.generateContent({
    model,
    contents: { parts },
    config: {
      responseModalities: [Modality.IMAGE, Modality.TEXT],
    },
  });

  if (!response.candidates?.length) {
    throw new Error('Gemini did not return a valid image response.');
  }

  const responseParts = response.candidates[0]?.content?.parts;
  if (!responseParts) {
    throw new Error('Gemini did not return a valid image response.');
  }

  const imagePart = responseParts.find((part: any) => part.inlineData) as any;
  if (imagePart?.inlineData) {
    return { image: `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}` };
  }

  const textPart = responseParts.find((part: any) => part.text) as any;
  throw new Error(`Gemini did not return an image. ${textPart?.text || ''}`);
}
