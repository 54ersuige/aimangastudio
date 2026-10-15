/**
 * 孤儿图片回收（2026-10-15 新增）。
 *
 * ## 为什么需要
 * `saveDataUrlImage` 每次生成都写一个新 UUID 文件，而 `deleteStoredImage`
 * 在生图路径上**从来没被调用过**。于是只要出现下面任一情况，图就永远留在盘上：
 *  - 整页出图中途失败，前面几格已落盘的图从不被写回 imageUrl（已修：失败隔离）
 *  - 分镜改写 / 章节重建，旧 pages 被整体替换，里面的图全部失去引用
 *  - 世界观重生成导致角色参考图被换掉
 *  - 用户删章节 / 删页时没有级联删图
 *
 * 实测：446 张图里 **443 张（663MB）没有任何引用**，占 99.3%。
 *
 * ## 为什么不能用 mtime 判断
 * 用"多久没被访问"来猜，迟早会删掉用户正在看、但元数据还没写回的那张图。
 * 本模块只认**唯一事实源**：series-data.json 里出现的每一个 image 字段。
 * 元数据没有 = 无人引用 = 可回收。
 *
 * ## 安全约束
 *  - 默认 dry-run，只报告不删
 *  - 只删 `server/data/images/` 下的 png/jpg，文件名必须是纯 uuid.ext（防目录穿越）
 *  - 单次回收上限 MAX_DELETE_PER_RUN，避免一次删太多导致误删无法回退
 */
import { existsSync, readdirSync, statSync, unlinkSync } from 'fs';
import { join } from 'path';
import { IMAGE_DIR, isStoredImagePath } from './image-store.js';

const IMAGE_WEB_PREFIX = '/data/images/';
/** 单次最多删多少张 —— 误删时还能靠 git/备份找回，超量删除则不可逆。 */
const MAX_DELETE_PER_RUN = 500;

export interface OrphanScanResult {
  /** 磁盘上的图片总数 */
  total: number;
  /** 被 series-data.json 引用的张数 */
  referenced: number;
  /** 孤儿张数 */
  orphanCount: number;
  /** 孤儿图占用字节 */
  orphanBytes: number;
  /** 孤儿文件名（不含目录） */
  orphanFiles: string[];
  /** 是否会真的删除（false = dry-run） */
  applied: boolean;
  /** 实际删除的张数（dry-run 时为 0） */
  deleted: number;
  /** 因超出单次上限被跳过的张数 */
  skipped: number;
}

/**
 * 从任意 JSON 字符串里抽出所有 `/data/images/xxx.png` 形式的引用。
 *
 * 用正则而不是遍历对象结构：series-data.json 的字段路径会随版本变化
 * （character.referenceImage / character.referenceImages[] / panel.imageUrl …），
 * 正则对新增字段天然免疫 —— 只要值里是图片路径就会被认出来。
 */
export function extractReferencedImages(jsonText: string): Set<string> {
  const out = new Set<string>();
  // 末尾的负向前瞻很关键：文件名后不能再跟路径字符。
  // 否则 `/data/images/sub/x.png` 会把 "sub" 当成文件名收进来，
  // 既不指向任何真实文件，又可能意外挡住一张同名的图不被回收。
  const re = new RegExp(
    IMAGE_WEB_PREFIX.replace(/[/]/g, '\\/') + '([A-Za-z0-9._-]+\\.(?:png|jpe?g))(?![A-Za-z0-9._-])',
    'gi',
  );
  let m: RegExpExecArray | null;
  while ((m = re.exec(jsonText)) !== null) {
    out.add(m[1]);
  }
  return out;
}

/** 只允许形如 `<uuid>.png` / `<uuid>.jpg` 的纯文件名（与 image-store 的穿越防护同强度）。 */
function isSafeImageName(name: string): boolean {
  return /^[A-Za-z0-9-]+\.(png|jpg|jpeg)$/i.test(name);
}

/**
 * 扫描并（可选）删除孤儿图。
 *
 * @param seriesDataJson  series-data.json 的完整文本
 * @param apply           false = 只报告（默认，安全）；true = 真删
 */
export function sweepOrphanImages(seriesDataJson: string, apply = false): OrphanScanResult {
  const referenced = extractReferencedImages(seriesDataJson);

  let files: string[] = [];
  try {
    if (existsSync(IMAGE_DIR)) {
      files = readdirSync(IMAGE_DIR)
        .filter(f => isSafeImageName(f))
        .filter(f => !referenced.has(f));
    }
  } catch (e) {
    console.warn('[orphan-gc] 读取图片目录失败：', e);
    return { total: 0, referenced: referenced.size, orphanCount: 0, orphanBytes: 0, orphanFiles: [], applied: false, deleted: 0, skipped: 0 };
  }

  let orphanBytes = 0;
  for (const f of files) {
    try { orphanBytes += statSync(join(IMAGE_DIR, f)).size; } catch { /* 读不到就当 0 */ }
  }

  const toDelete = files.slice(0, MAX_DELETE_PER_RUN);
  const skipped = files.length - toDelete.length;

  let deleted = 0;
  if (apply) {
    for (const f of toDelete) {
      try {
        unlinkSync(join(IMAGE_DIR, f));
        deleted += 1;
      } catch (e) {
        console.warn(`[orphan-gc] 删除失败 ${f}:`, e);
      }
    }
    console.log(
      `[orphan-gc] 回收完成：删除 ${deleted} 张，` +
      `释放 ${(orphanBytes / 1024 / 1024).toFixed(1)} MB` +
      (skipped > 0 ? `；另有 ${skipped} 张因单次上限未处理，下次运行继续` : ''),
    );
  }

  return {
    total: files.length + referenced.size,
    referenced: referenced.size,
    orphanCount: files.length,
    orphanBytes,
    orphanFiles: files,
    applied: apply,
    deleted,
    skipped,
  };
}

/** 供路由层判断一个路径是否还是"活的"（用于删除章节时的级联）。 */
export function isReferencedImage(webPath: string, referenced: Set<string>): boolean {
  return isStoredImagePath(webPath) && referenced.has(webPath.slice(IMAGE_WEB_PREFIX.length));
}
