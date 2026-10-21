/** 用真实项目数据验证"图下三件套"的组装结果。 */
import { readFileSync } from 'fs';
import { buildPanelTextSegments } from '../src/services/stripExport.js';

const P = 'D:/26_Agent_Project/AI_comic/server/data/series-data.json';
const raw = JSON.parse(readFileSync(P, 'utf-8'));
const s = Array.isArray(raw) ? raw[0] : raw;
const arc = s.arcs[0];
const ch = arc.chapters[0];
const page = ch.pages[0];

for (const pn of page.panels.slice(0, 4)) {
  const segs = buildPanelTextSegments({
    dialogue: pn.dialogue || '',
    speakerName: pn.characterIds?.map((id: string) => s.characters.find((c: any) => c.id === id)?.name).find(Boolean),
    narration: pn.narration || '',
    innerThought: pn.innerThought || '',
  });
  console.log(`\n──── 格 ${pn.index} ────`);
  for (const seg of segs) {
    if (seg.text === '\n') { console.log('   ── 换行 ──'); continue; }
    const tag = seg.italic ? '[斜体]' : '';
    console.log(`   ${tag}${seg.color} ${seg.text}`);
  }
}
