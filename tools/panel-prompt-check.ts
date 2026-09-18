// 一次性验证：分镜 prompt 组装是否还有新旧风格冲突 + 画风基准图是否已按 DNA 隔离
// 并真实出图对比。运行：cd server && node --import tsx ../tools/panel-prompt-check.ts
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildPanelImagePrompt, getStyleRefs } from '../server/series-routes/prompts.js';
import { withDnaImagePrompt } from '../server/dna-inject.js';
import { getConfig } from '../server/config.js';
import { getImageProvider } from '../server/series-routes/helpers.js';

// ── 1. 画风基准图按 DNA 隔离是否生效 ───────────────────────────────
for (const key of ['graphic-novel-ink', 'new-yorker-noir'] as const) {
  const refs = getStyleRefs(key);
  console.log(`[styleRefs] ${key}: images=${refs.images.length}, note=${refs.note ? '有' : '空'}`);
}

// ── 2. 构建一个真实分镜 prompt（模仿 generatePanelImages 的组装顺序）──
const dnaKey = 'graphic-novel-ink' as const;
const styleRefs = getStyleRefs(dnaKey);
const prompt = buildPanelImagePrompt({
  style: '排线文学 Graphic Novel',
  mood: '暖灰主调、克制的黄昏色',
  sceneDescription: '傍晚，老旧居民楼的厨房，父亲在灶台前收拾碗筷',
  description: '中景，父亲背对镜头站在水池前，手里的碗停在半空，像是在想什么',
  charDescLines: ['- 父亲：东亚中国面孔；M；mid；中等身材；短黑发；细长眼；服装：洗旧的灰蓝衬衫；常戴黑框眼镜'],
  boundCharNames: ['父亲'],
  anchorText: '\n视觉锚点（一致性约束）：\n- 父亲 的视觉锚点（必须全部出现在画面中）：黑框眼镜、左手腕旧手表',
}) + styleRefs.note;

const finalReq = withDnaImagePrompt({
  prompt,
  referenceImages: styleRefs.images.length > 0 ? styleRefs.images : undefined,
  aspectRatio: '3:4',
}, { dnaKey, purpose: 'panel' });

console.log('\n[prompt] 总长:', finalReq.prompt.length);
console.log('[prompt] 参考图数量:', finalReq.referenceImages?.length ?? 0);
const conflicts = ['平涂色块', '细匀墨线', '单一线宽', '灰调平涂', 'New Yorker'];
for (const c of conflicts) {
  const hit = finalReq.prompt.includes(c);
  console.log(`[conflict] "${c}": ${hit ? '❌ 仍存在' : '✅ 已消除'}`);
}
console.log('\n[prompt tail 400]:\n' + finalReq.prompt.slice(-400));

// ── 3. 真实出图 ────────────────────────────────────────────────
const config = getConfig().image;
const provider = getImageProvider(config);
const img = await provider.generateImage(config, finalReq);
const b64 = img.image.split(',')[1];
const out = fileURLToPath(new URL('./style-bakeoff/panel-after-fix.png', import.meta.url));
fs.writeFileSync(out, Buffer.from(b64, 'base64'));
console.log('\n[image] OK ->', out);
