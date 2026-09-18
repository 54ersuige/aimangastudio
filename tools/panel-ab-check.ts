// A/B 对比（忠实版）：用真实系列「加油boy」主角林舟 + 真实角色设定图，
// 分别以「修复前」和「修复后」的 prompt 组装方式出图，用 8 维评审客观打分。
// 运行：cd server && node --import tsx ../tools/panel-ab-check.ts
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildPanelImagePrompt, getStyleRefs } from '../server/series-routes/prompts.js';
import { withDnaImagePrompt } from '../server/dna-inject.js';
import { getConfig } from '../server/config.js';
import { getImageProvider } from '../server/series-routes/helpers.js';
import { reviewPanel } from '../server/audit/comic-reviewer.js';
import { resolveImageData } from '../server/image-store.js';

const OUT = (n: string) => fileURLToPath(new URL(`./style-bakeoff/${n}`, import.meta.url));
const dnaKey = 'graphic-novel-ink' as const;

// 真实角色（取自 series-data.json「加油boy」/ 林舟）
const CHAR_REF = '/data/images/4de03442-aa7d-46b5-8e0b-e1b0f7f5280d.png';
const charRefData = resolveImageData(CHAR_REF)!;
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

const baseNewPrompt = buildPanelImagePrompt(panelArgs);

// ── 修复后：当前代码的真实行为（角色设定图 + graphic-novel-ink 自己的基准图 = 0 张）──
const newStyleRefs = getStyleRefs(dnaKey);
const newReq = withDnaImagePrompt({
  prompt: baseNewPrompt + newStyleRefs.note,
  referenceImages: [{ data: charRefData, mimeType: 'image/png' }, ...newStyleRefs.images],
  aspectRatio: '3:4',
}, { dnaKey, purpose: 'panel' });

// ── 修复前：还原旧组装（旧媒介约束文案 + 旧画风说明 + 3 张旧 New Yorker 基准图）──
const OLD_NOTE = '\n【画风参考图】最后 3 张参考图是本系列画风基准（New Yorker 单幅插画 × Tomine 都市写实 × Graphic Novel 文学气质）：只学习其细而均匀的单一线宽墨线、灰调平涂上色、暖纸纹理与安静克制的构图气质；人物为写实成年中国人（小杏眼、平凡脸型），严禁画成动漫/日漫脸。';
const OLD_MEDIUM = '\n【媒介约束】最终画面是手绘插画（纸质印刷质感、平涂、细匀墨线），不是照片。';
const oldBase = baseNewPrompt.replace(/【媒介约束】最终画面是手绘插画（画风严格遵循前述系统规范），不是照片。/, OLD_MEDIUM.slice(1));
const oldRefDir = fileURLToPath(new URL('../server/data/style-refs/new-yorker-noir/', import.meta.url));
const oldRefImages = fs.readdirSync(oldRefDir).filter(f => /\.jpe?g$/i.test(f)).sort()
  .map(f => ({ data: `data:image/jpeg;base64,${fs.readFileSync(oldRefDir + f).toString('base64')}`, mimeType: 'image/jpeg' }));
const oldReq = withDnaImagePrompt({
  prompt: oldBase + OLD_NOTE,
  referenceImages: [{ data: charRefData, mimeType: 'image/png' }, ...oldRefImages],
  aspectRatio: '3:4',
}, { dnaKey, purpose: 'panel' });

const config = getConfig().image;
const provider = getImageProvider(config);

const reviewCtx = {
  worldview: '排线文学 Graphic Novel：钢笔交叉排线、4-5 色有限色板（暖灰/米纸黄/墨青/砖红点缀）',
  sceneDescription: panelArgs.sceneDescription,
  panelDescription: panelArgs.description,
  characterSummaries: ['林舟（male，young_adult，22岁）：洗旧的深灰连帽卫衣，黑色短碎发，单眼皮眼下淡青'],
  referenceImages: [charRefData],
};

for (const [label, req] of [['before', oldReq], ['after', newReq]] as const) {
  console.log(`\n===== ${label} =====`);
  console.log('promptLen:', req.prompt.length, '| refs:', req.referenceImages?.length ?? 0);
  const img = await provider.generateImage(config, req);
  const p = OUT(`panel-ab2-${label}.png`);
  fs.writeFileSync(p, Buffer.from(img.image.split(',')[1], 'base64'));
  const r = await reviewPanel(img.image, reviewCtx);
  if (!r) { console.log('评审失败'); continue; }
  const d = r.dimensions as Record<string, { score: number; reason: string }>;
  console.log(`overall: ${r.overall} | verdict: ${r.verdict}`);
  for (const k of ['D1_character_consistency', 'D2_cinematography', 'D4_style_consistency']) {
    console.log(`  ${k}: ${d[k]?.score} — ${d[k]?.reason}`);
  }
  console.log('  top_issue:', r.topIssue);
  console.log('  saved:', p);
}
