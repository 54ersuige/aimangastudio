/**
 * 图片文件存储 —— 生成的图片落盘为文件，JSON 只存 web 路径。
 *
 * 动机：此前 base64 直接内嵌在 series-data.json 里，几十张图就把库撑到 21MB+，
 * 每次读写全量序列化都会阻塞事件循环，列表接口也把 21MB 原样发给前端。
 * 改为文件存储后：
 *   - series-data.json 只剩文本元数据（KB 级）
 *   - 图片经 express.static 以 /data/images/xxx.png 提供（前端 img src 直接可用）
 *   - 发给生图模型做参考图时再按需读回 data URL
 */
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, unlinkSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = resolve(SERVER_DIR, 'data');
export const IMAGE_DIR = join(DATA_DIR, 'images');

const IMAGE_WEB_PREFIX = '/data/images';

export function isDataUrl(s: string): boolean {
  return typeof s === 'string' && s.startsWith('data:');
}

export function isStoredImagePath(s: string): boolean {
  return typeof s === 'string' && s.startsWith(IMAGE_WEB_PREFIX + '/');
}

/** 把 data URL 图片写入文件，返回 web 路径（/data/images/xxx.png）。 */
export function saveDataUrlImage(dataUrl: string): string {
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/s);
  if (!m) throw new Error('Invalid data URL');
  const mimeType = m[1];
  const ext = mimeType.includes('jpeg') || mimeType.includes('jpg') ? 'jpg' : 'png';
  mkdirSync(IMAGE_DIR, { recursive: true });
  const name = `${randomUUID()}.${ext}`;
  writeFileSync(join(IMAGE_DIR, name), Buffer.from(m[2], 'base64'));
  return `${IMAGE_WEB_PREFIX}/${name}`;
}

/** 把 web 路径读回 data URL（供生图 Provider 作参考图输入）。文件缺失返回 null。 */
export function imagePathToDataUrl(webPath: string): string | null {
  const name = webPath.slice(IMAGE_WEB_PREFIX.length + 1);
  // 防目录穿越：只允许纯文件名
  if (!name || name.includes('/') || name.includes('..')) return null;
  const file = join(IMAGE_DIR, name);
  if (!existsSync(file)) return null;
  const buf = readFileSync(file);
  const mime = name.endsWith('.jpg') ? 'image/jpeg' : 'image/png';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

/**
 * 统一取图：字段里可能是新式 web 路径，也可能是历史遗留的 data URL。
 * 返回 data URL（给 Provider），无效/缺失返回 null。
 */
export function resolveImageData(s: string | undefined): string | null {
  if (!s) return null;
  if (isDataUrl(s)) return s;
  if (isStoredImagePath(s)) return imagePathToDataUrl(s);
  return null;
}

/** 删除已落盘的图片（按 web 路径）。路径非法/文件缺失返回 false；IO 失败仅告警不抛。 */
export function deleteStoredImage(webPath: string): boolean {
  if (!isStoredImagePath(webPath)) return false;
  const name = webPath.slice(IMAGE_WEB_PREFIX.length + 1);
  // 防目录穿越：只允许纯文件名（与 imagePathToDataUrl 同规则）
  if (!name || name.includes('/') || name.includes('..')) return false;
  try {
    const file = join(IMAGE_DIR, name);
    if (!existsSync(file)) return false;
    unlinkSync(file);
    return true;
  } catch (e) {
    console.warn(`[image-store] 删除图片失败: ${webPath}`, e);
    return false;
  }
}

const STYLE_REF_DIR = join(DATA_DIR, 'style-refs');

/**
 * 读取"画风基准参考图"（docs/references 确认稿的落盘副本，1024px JPEG）。
 *
 * 2026-08-31 复盘：仅靠 prompt 文本锚定画风会随题材漂移（纯场景格变照片、
 * 设定表模板词把画风拽向白底素描）。把用户确认过的基准稿直接作为
 * reference images 注入每次生图请求，是画风一致性的硬锚点。
 *
 * 2026-09-10 修复（画风被往回拽）：基准图改为**按 DNA 分目录存放**
 *   server/data/style-refs/<dnaKey>/*.jpg
 * 此前是一份全局基准图注入所有 DNA 的请求。图像参考对画风的影响力远大于文字，
 * 换了 DNA（如 graphic-novel-ink 的交叉排线）之后，旧的细线平涂基准稿仍被注入，
 * 等于每张图都在教模型画回旧风格。分目录后每个 DNA 只吃自己的基准稿。
 *
 * 目录缺失 / 为空返回 []（降级为纯文本锚定，不阻断生成）。
 */
export function loadStyleReferenceImages(dnaKey: string): string[] {
  const dir = join(STYLE_REF_DIR, dnaKey);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => /\.(png|jpe?g)$/i.test(f))
    .sort()
    .map(f => {
      const buf = readFileSync(join(dir, f));
      const mime = /\.jpe?g$/i.test(f) ? 'image/jpeg' : 'image/png';
      return `data:${mime};base64,${buf.toString('base64')}`;
    });
}
