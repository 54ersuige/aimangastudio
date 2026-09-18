// A/B 多样本对比：每臂 N 张图，取 8 维评审均分，降低单样本噪声。
// 运行：cd server && node --import tsx ../tools/panel-ab-multi.ts [N]
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildPanelImagePrompt, getStyleRefs } from '../server/series-routes/prompts.js';
import { withDnaImagePrompt } from '../server/dna-inject.js';
import { getConfig } from '../server/config.js';
import { getImageProvider } from '../server/series-routes/helpers.js';
import { reviewPanel } from '../server/audit/comic-reviewer.js';
import { resolveImageData } from '../server/image-store.js';

const N = Number(process.argv[2] || 3);
const OUT = (n: string) => fileURLToPath(new URL(`./style-bakeoff/${n}`, import.meta.url));
const dnaKey = 'graphic-novel-ink' as const;

const charRefData = resolveImageData('/data/images/4de03442-aa7d-46b5-8e0b-e1b0f7f5280d.png')!;
const charDescLine = '- 林舟：东亚中国面孔；M；young；22岁；偏瘦，四肢细长，肩背挺直；黑色短碎发，发旋处翘起一撮；单眼皮，眼下淡青；服装：洗旧的深灰连帽卫衣＋浅灰圆领T恤＋深蓝直筒牛仔裤';

const panelArgs = {
  style: '排线文学 Graphic Novel',
  mood: '暖灰主调、克制的写字楼夜色',
  sceneDescription: '深夜，广告公司开放式办公区，只剩两盏顶灯还亮着，隔断上贴着未拆的快递单',
  description: '中景，林舟独自坐在工位上，拇指无意识蹭着工牌边角，手机屏幕朝下放在桌角，肩上背着包带还没取下',
  charDescLines: [charDescLine],
  boundCharNames: ['林舟'],
  anchorText: '\n视觉锚点（一致性约束）：\n- 林舟 的视觉锚点（必须全部出现在画面中）：黑色短碎发、发旋翘起的一撮、眼下淡青、左腕黑色橡皮筋、屏幕朝下的手机',
};

const base = buildPanelImagePrompt(panelArgs);

// after：当前真实行为
const newRefs = getStyleRefs(dnaKey);
const afterReq = withDnaImagePrompt({
  prompt: base + newRefs.note,
  referenceImages: [{ data: charRefData, mimeType: 'image/png' }, ...newRefs.images],
  aspectRatio: '3:4',
}, { dnaKey, purpose: 'panel' });

// before：还原旧行为
const OLD_NOTE = '\n【画风参考图】最后 3 张参考图是本系列画风基准（New Yorker 单幅插画 × Tomine 都市写实 × Graphic Novel 文学气质）：只学习其细而均匀的单一线宽墨线、灰调平涂上色、暖纸纹理与安静克制的构图气质；人物为写实成年中国人（小杏眼、平凡脸型），严禁画成动漫/日漫脸。';
const OLD_MEDIUM = '\n【媒介约束】最终画面是手绘插画（纸质印刷质感、平涂、细匀墨线），不是照片。';
const oldBase = base.replace('【媒介约束】最终画面是手绘插画（画风严格遵循前述系统规范），不是照片。', OLD_MEDIUM.slice(1));
const oldDir = fileURLToPath(new URL('../server/data/style-refs/new-yorker-noir/', import.meta.url));
const oldRefs = fs.readdirSync(oldDir).filter(f => /\.jpe?g$/i.test(f)).sort()
  .map(f => ({ data: `data:image/jpeg;base64,${fs.readFileSync(oldDir + f).toString('base64')}`, mimeType: 'image/jpeg' }));
const beforeReq = withDnaImagePrompt({
  prompt: oldBase + OLD_NOTE,
  referenceImages: [{ data: charRefData, mimeType: 'image/png' }, ...oldRefs],
  aspectRatio: '3:4',
}, { dnaKey, purpose: 'panel' });

const config = getConfig().image;
const provider = getImageProvider(config);
const ctx = {
  worldview: '排线文学 Graphic Novel：钢笔交叉排线、4-5 色有限色板（暖灰/米纸黄/墨青/砖红点缀）',
  sceneDescription: panelArgs.sceneDescription,
  panelDescription: panelArgs.description,
  characterSummaries: ['林舟（male，young_adult，22岁）：洗旧的深灰连帽卫衣，黑色短碎发，单眼皮眼下淡青'],
  referenceImages: [charRefData],
};

const KEYS = ['D1_character_consistency', 'D2_cinematography', 'D4_style_consistency', 'D6_outfit_consistency'];
const results: Record<string, { overall: number[]; dims: Record<string, number[]>; fails: number }> = {
  before: { overall: [], dims: {}, fails: 0 },
  after: { overall: [], dims: {}, fails: 0 },
};

for (const label of ['before', 'after'] as const) {
  const req = label === 'before' ? beforeReq : afterReq;
  for (let i = 1; i <= N; i++) {
    try {
      const img = await provider.generateImage(config, req);
      fs.writeFileSync(OUT(`panel-ab3-${label}-${i}.png`), Buffer.from(img.image.split(',')[1], 'base64'));
      const r = await reviewPanel(img.image, ctx);
      if (!r) { results[label].fails++; console.log(`[${label} #${i}] 评审失败`); continue; }
      const d = r.dimensions as Record<string, { score: number; reason: string }>;
      results[label].overall.push(r.overall);
      for (const k of KEYS) {
        (results[label].dims[k] ||= []).push(d[k]?.score ?? 0);
      }
      console.log(`[${label} #${i}] overall=${r.overall} ` + KEYS.map(k => `${k.slice(0, 2)}=${d[k]?.score}`).join(' '));
    } catch (e: any) {
      results[label].fails++;
      console.log(`[${label} #${i}] 出图失败: ${e?.message || e}`);
    }
  }
}

const mean = (a: number[]) => a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length * 10) / 10 : NaN;
console.log('\n===== 均值汇总 =====');
for (const label of ['before', 'after'] as const) {
  const r = results[label];
  console.log(`${label}: overall=${mean(r.overall)} (n=${r.overall.length}, 失败${r.fails}) | ` +
    KEYS.map(k => `${k.slice(0, 2)}=${mean(r.dims[k] || [])}`).join(' '));
}
