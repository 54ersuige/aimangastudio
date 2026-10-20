/**
 * 一次性清理脚本（2026-10-20）：把已拆解分镜描述里混入的角色 ID 洗掉，
 * 并统计「描述代词与角色卡性别矛盾」的格。
 *
 * 背景见 server/series-routes/character-id-strip.test.ts。
 * 清洗用 PUT /pages/:id/panels（图不丢：replacePanels 保留 imageUrl，
 * 且所有格都还有图时 status 保持 done）。
 *
 * 用法：npx tsx tools/clean-panel-ids.ts [--apply]
 * 不带 --apply 时只统计、只打印将要改的内容。
 */
import { resolve } from 'path';
import { stripCharacterIds } from '../server/series-routes/prompts.js';

const SERIES_ID = '164d09dd-6ace-4fbc-a58f-7add0f0b41a9';
const BASE = 'http://localhost:3001';
const APPLY = process.argv.includes('--apply');

interface Panel { index: number; description: string; dialogue?: string; imageUrl?: string; characterIds?: string[]; characters?: string[]; camera?: string; emotion?: string; extraCharacters?: any[]; id?: string; }
interface Page { id: string; panels: Panel[]; }
interface Chapter { title: string; pages: Page[]; }
interface Arc { index: number; title: string; chapters: Chapter[]; }
interface Character { id: string; name: string; gender?: string; }
interface Series { id: string; characters: Character[]; arcs: Arc[]; }

const GENDER_CN: Record<string, string> = { female: '女', male: '男', ambiguous: '性别不明确', nonbinary: '性别不明确' };

async function main() {
  const res = await fetch(`${BASE}/api/series/${SERIES_ID}`);
  const json: any = await res.json();
  const series: Series = json.series;
  const charMap = new Map(series.characters.map(c => [c.id, c]));

  let idFixed = 0;
  const genderIssues: Array<{ arc: number; chapter: string; page: number; panel: number; desc: string; kind: string; name: string; want: string }> = [];

  for (const arc of series.arcs) {
    for (const ch of arc.chapters) {
      for (const page of ch.pages) {
        const newPanels = page.panels.map(p => ({ ...p, description: stripCharacterIds(p.description) }));
        const changed = newPanels.filter((p, i) => p.description !== page.panels[i].description);
        if (changed.length > 0) {
          idFixed += changed.length;
          for (const c of changed) {
            console.log(`  清洗 id：第${arc.index}季《${ch.title}》第${page.id.slice(0, 6)} 批格${c.index + 1}`);
            console.log(`      ${c.description.slice(0, 70)}`);
          }
          if (APPLY) {
            // 用专用的 clean-descriptions 端点：**不动图、不改 status**。
            // PUT /panels 的 schema 不接受 imageUrl，会把已出的图全清掉（实测踩过）。
            const post = await fetch(`${BASE}/api/series/${SERIES_ID}/pages/${page.id}/clean-descriptions`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: '{}',
            });
            if (!post.ok) console.log(`      !! 清洗失败 ${post.status}`);
          }
        }

        // 性别矛盾审计
        //
        // 两个坑（都是这次踩过的）：
        //  1. **必须用清洗后的描述查**。id 串会把「她」挤出检测窗口 ——
        //     实测带 id 时漏检了 male 田经理写成「她」的那一格。
        //  2. **不能只看第一个代词**。「秦妍…纸稿推到他手边。她视线…」里
        //     「他」指的是陆远 → 按"名字后第一个代词"判会误报。
        // 所以：找出名字后 30 字内的**全部**代词。
        //   恰好 1 个且与性别矛盾 → 确定矛盾（要重画）
        //   多个代词            → 需人工看（不自动动）
        for (const p of page.panels) {
          const desc = stripCharacterIds(p.description);
          for (const cid of (p.characterIds ?? p.characters ?? [])) {
            const c = charMap.get(cid);
            if (!c || !c.gender || c.gender === 'ambiguous' || c.gender === 'nonbinary') continue;
            const idx = desc.indexOf(c.name);
            if (idx < 0) continue;
            const after = desc.slice(idx + c.name.length, idx + c.name.length + 30);
            const he = (after.match(/他/g) || []).length;
            const she = (after.match(/她/g) || []).length;
            const total = he + she;
            if (total === 0) continue;
            const bad = c.gender === 'male' ? she > 0 : he > 0;
            if (!bad) continue;
            const kind = total === 1 ? '确定矛盾' : '多代词·需人工看';
            genderIssues.push({
              arc: arc.index, chapter: ch.title, page: page.id.slice(0, 6),
              panel: p.index + 1, desc: desc.slice(0, 90), kind,
              name: c.name, want: GENDER_CN[c.gender],
            });
          }
        }
      }
    }
  }

  console.log(`\n=== 角色 ID 清洗：${idFixed} 格${APPLY ? '（已写回）' : '（未写回，加 --apply 生效）'} ===`);
  const certain = genderIssues.filter(g => g.kind === '确定矛盾');
  const fuzzy = genderIssues.filter(g => g.kind !== '确定矛盾');
  console.log(`\n=== 性别矛盾：确定 ${certain.length} 格 / 多代词待人工看 ${fuzzy.length} 格 ===`);
  for (const g of certain) {
    console.log(`  [确定] 第${g.arc}季《${g.chapter}》${g.page}批格${g.panel}  ${g.name} 应为${g.want}`);
    console.log(`      ${g.desc}`);
  }
  for (const g of fuzzy) {
    console.log(`  [待看] 第${g.arc}季《${g.chapter}》${g.page}批格${g.panel}  ${g.name} 应为${g.want}`);
    console.log(`      ${g.desc}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
