/**
 * 孤儿图回收 CLI（2026-10-15）。
 *
 * 用法：
 *   # 1) 先看会删什么（dry-run，默认 —— 不删任何东西）
 *   npm run gc:orphans
 *
 *   # 2) 确认无误后再真删
 *   npm run gc:orphans -- --apply
 *
 *   # 3) 只想看看体积/张数，不要列表
 *   npm run gc:orphans -- --brief
 *
 * 判定规则见 server/orphan-gc.ts：唯一事实源是 server/data/series-data.json，
 * 里面没有出现的图片路径一律视为无人引用。
 *
 * 为什么默认 dry-run：删除不可逆。这个工具会直接 unlink 磁盘上的用户内容，
 * 必须让"看一眼"和"真动手"是两个明确的动作。
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { sweepOrphanImages } from '../server/orphan-gc.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SERIES_DATA = resolve(ROOT, 'server', 'data', 'series-data.json');

const apply = process.argv.includes('--apply');
const brief = process.argv.includes('--brief');

let json = '{}';
try {
  json = readFileSync(SERIES_DATA, 'utf-8');
} catch (e: any) {
  console.error(`读不到 ${SERIES_DATA}：${e?.message || e}`);
  console.error('没有 series-data.json 就没有"谁被引用"的依据，拒绝凭猜测删除。');
  process.exit(1);
}

const result = sweepOrphanImages(json, apply);

const mb = (b: number) => `${(b / 1024 / 1024).toFixed(1)} MB`;
console.log('');
console.log(`磁盘图片总数：${result.total} 张`);
console.log(`被 series-data.json 引用：${result.referenced} 张`);
console.log(`孤儿图：${result.orphanCount} 张 / ${mb(result.orphanBytes)}`);
if (result.skipped > 0) {
  console.log(`⚠️ 另有 ${result.skipped} 张超过单次上限（500），本次未处理，再跑一次即可。`);
}
if (result.applied) {
  console.log(`✅ 已删除 ${result.deleted} 张，释放 ${mb(result.orphanBytes)}`);
} else {
  console.log('');
  console.log('这是 dry-run —— 磁盘上什么都没动。');
  if (!brief) {
    const preview = result.orphanFiles.slice(0, 10);
    for (const f of preview) console.log(`  - ${f}`);
    if (result.orphanFiles.length > preview.length) {
      console.log(`  … 其余 ${result.orphanFiles.length - preview.length} 张省略`);
    }
  }
  console.log('');
  console.log('确认要删就跑：npm run gc:orphans -- --apply');
}
console.log('');
