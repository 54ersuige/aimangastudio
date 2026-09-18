import type { Response as ExpressResponse } from 'express';
import { appendFileSync, mkdirSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const LOG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'logs');
const GEN_LOG_PATH = join(LOG_DIR, 'generations.jsonl');

/**
 * 生成审计日志：每次文/图生成把完整 prompt 落盘为 JSONL。
 * 排查「这张图当时是怎么生成的 / 画风为什么不对」时可直接回溯。
 */
export function logGeneration(kind: string, payload: Record<string, unknown>): void {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    appendFileSync(GEN_LOG_PATH, JSON.stringify({ ts: new Date().toISOString(), kind, ...payload }) + '\n');
  } catch {
    // 日志失败不影响主流程
  }
}

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
  /**
   * 请求级额外参数（如 negative_prompt）。
   * Provider 构建请求体时应展开在 config.extraParams 之后（请求级覆盖配置级），
   * 否则 DNA 注入的负面提示词等会静默丢失。
   */
  extraParams?: Record<string, unknown>;
}

export interface ImageResponse {
  image: string; // data URL
}

export function sendError(res: ExpressResponse, status: number, message: string) {
  res.status(status).json({ error: message });
}

/**
 * 2026-09-07：智能 sendError —— 把上游/网络抛出的原始 Error 自动翻译成
 * 友好文案（429 / 401 / 402 / 超时），并选合适的 HTTP 状态码。
 *
 * 用法替换原来的 sendError(res, 502, e.message)：
 *   } catch (e) {
 *     sendFriendlyError(res, e, '拆解分镜失败');
 *   }
 */
export function sendFriendlyError(res: ExpressResponse, e: unknown, fallback: string): void {
  const f = classifyProviderError(e);
  if (f.recognized) {
    sendError(res, f.httpStatus, f.userMessage);
    return;
  }
  // 兜底：拼上 fallback 让用户知道是哪一步失败的
  sendError(res, f.httpStatus, `${fallback}：${f.userMessage}`);
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
  return fetch(input, { ...rest, signal: controller.signal }).finally(() => clearTimeout(id)).catch((e: any) => {
    // 把"超时触发的 abort"翻译成更友好的错误，便于上层提示用户。
    if (e?.name === 'AbortError') {
      throw new Error(`请求超时（${Math.round(timeout / 1000)}s 内未返回）`);
    }
    throw e;
  });
}

export function stripThinkingTags(text: string): string {
  // Some reasoning models wrap final answer in <think>...</think>; remove it.
  return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

/**
 * 把 provider / 网络抛出的 raw error 转成用户友好的提示（2026-09-07）。
 *
 * 目标：用户报告「拆解分镜失败」时，UI 给的 message 能直接指向根因 + 怎么修。
 * 此前 sendError(res, 502, e.message) 会把 minimax 的乱码 JSON 一股脑扔回去，
 * 用户看到「请求超时（40s 内未返回）」完全摸不到头脑。
 *
 * 分类：
 *  - 429 / rate_limit_error → 配额耗尽：建议更换 provider 或购买次包
 *  - 401 / 403 → API key 无效或欠费
 *  - 402 / quota / insufficient → 同上
 *  - AbortError（超时） → 区分是 provider 慢还是用户自己的网络
 *  - 其他 → 返回 raw（不带 fallback），由 sendFriendlyError 拼上下文
 */
export interface FriendlyError {
  userMessage: string;
  httpStatus: number;
  raw: string;
  recognized: boolean;
}
export function classifyProviderError(e: unknown): FriendlyError {
  const raw = (e as any)?.message || String(e);
  // 429 / 配额
  if (/429|rate_limit|token plan|用量|配额|次包/i.test(raw)) {
    return {
      userMessage: '文本模型（MiniMax）额度已用完。请到「设置」切换为其它 text provider（如 Gemini / DeepSeek），或去 MiniMax 后台购买次包补充用量。',
      httpStatus: 429,
      raw,
      recognized: true,
    };
  }
  // 401 / 403
  if (/401|403|unauthor|forbid|invalid.*api.*key|api.*key.*invalid/i.test(raw)) {
    return {
      userMessage: '文本模型 API key 无效或欠费。请到「设置」检查 text provider 的 API key 是否填写正确。',
      httpStatus: 401,
      raw,
      recognized: true,
    };
  }
  // 402 / insufficient_balance
  if (/402|insufficient.*balance|欠费/i.test(raw)) {
    return {
      userMessage: '文本模型账户余额不足。请充值或更换 text provider。',
      httpStatus: 402,
      raw,
      recognized: true,
    };
  }
  // 超时（abortableFetch 翻译过的）
  if (/请求超时/.test(raw)) {
    return {
      userMessage: `文本模型响应超时（${raw}）。可能正在排队或网络不稳，请稍后重试；如频繁发生，可到「设置」检查 text provider 配置。`,
      httpStatus: 504,
      raw,
      recognized: true,
    };
  }
  // 兜底：不识别时返回 raw（由 sendFriendlyError 拼 fallback 上下文）
  return {
    userMessage: raw,
    httpStatus: 502,
    raw,
    recognized: false,
  };
}
