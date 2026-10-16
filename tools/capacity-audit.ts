import { checkChapterCapacity, estimatedPanels, panelsForPageCount } from '../server/series-routes/chapter-capacity.js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const raw = readFileSync(resolve(ROOT, 'server/data/series-data.json'), 'utf-8');
const s = JSON.parse(raw)[0];
for (const a of s.arcs) {
  for (const ch of a.chapters) {
    const need = panelsForPageCount(ch.pageCount);
    const have = estimatedPanels(ch.summary);
    const bad = checkChapterCapacity(ch.summary, ch.pageCount);
    console.log(`《${ch.title}》 ${ch.summary.length}字 → 够${have}拍 / 需${need}格  ${bad ? '❌ 会被打回' : '✅ 通过'}`);
  }
}
