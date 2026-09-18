/**
 * 图文对齐门禁 E2E 探针（2026-09-11）
 * ─────────────────────────────────────────
 * 从 series-data.json 取最近一页已出图的分镜，对它跑一遍完整的
 * 「要素抽取 → 读图核对」，打印每个要素是否画出。
 *
 * 预期：本次改动前日志显示 8 维审核"空杯未画出/掀角未画出"——探针用来
 * 确认对齐门禁真的能把这些缺失项报出来（而不是像 8 维审核那样 parse-fail 静默放行）。
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { extractAlignmentItems, verifyAlignment } from '../server/alignment-guard.js';
import { resolveImageData } from '../server/image-store.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(readFileSync(resolve(ROOT, 'server/data/series-data.json'), 'utf-8'));

interface PanelLike { description: string; imageUrl?: string; index: number }
interface PageLike { sceneDescription?: string; panels: PanelLike[] }
interface ChapterLike { pages: PageLike[] }

// 找第一个有图的页（最近的系列）
let target: { description: string; imageUrl: string; sceneDescription: string; index: number } | null = null;
outer:
for (const series of data) {
  const chapters: ChapterLike[] = series.arcs
    ? series.arcs.flatMap((a: any) => a.chapters)
    : (series.chapters || []);
  for (const ch of chapters) {
    for (const page of ch.pages) {
      const p = page.panels?.find((pn: PanelLike) => pn.imageUrl);
      if (p) {
        target = {
          description: p.description,
          imageUrl: p.imageUrl!,
          sceneDescription: page.sceneDescription || '',
          index: p.index,
        };
        break outer;
      }
    }
  }
}

if (!target) {
  console.error('未找到已出图的页面');
  process.exit(1);
}

console.log(`[目标] series=${(data as any).map((s: any) => s.title).join(',')} 第 ${target.index} 格`);
console.log(`[description] ${target.description.slice(0, 200)}...\n`);

const imgData = resolveImageData(target.imageUrl);
if (!imgData) {
  console.error(`无法读取图片: ${target.imageUrl}`);
  process.exit(1);
}

// 第 1 步：抽取可核验要素
const extracted = await extractAlignmentItems(target.description, target.sceneDescription);
console.log('[抽取] 可核验要素:', extracted ? extracted.items.join(' | ') : '(失败/空 → 门禁跳过)');
if (!extracted) process.exit(0);

// 第 2 步：读图核对
const audit = await verifyAlignment(imgData, extracted.items);
if (!audit) {
  console.error('[核对] 调用失败 → 门禁跳过（fail-open）');
  process.exit(1);
}
console.log(`\n[核对结果] ok=${audit.ok}  confidence=${audit.confidence.toFixed(2)}`);
console.log(`[缺失项] ${audit.missing.length > 0 ? audit.missing.join('；') : '（无，全部画出）'}`);
process.exit(audit.ok ? 0 : 2);