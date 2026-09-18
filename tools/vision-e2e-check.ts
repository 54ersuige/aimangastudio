// 一次性端到端验证：走服务端真实 comic-reviewer 链路（getConfig().vision → deepseek provider → 8维解析）
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { reviewPanel } from '../server/audit/comic-reviewer.js';
import { getConfig } from '../server/config.js';

const cfg = getConfig().vision;
console.log('vision cfg:', JSON.stringify({ enabled: cfg.enabled, provider: cfg.provider, model: cfg.model, baseUrl: cfg.baseUrl, timeout: cfg.timeout }));

// 路径基于脚本位置，避免依赖 process.cwd()
const imgPath = fileURLToPath(new URL('./style-bakeoff/dna-verify-graphic-novel-ink.png', import.meta.url));
const b64 = fs.readFileSync(imgPath).toString('base64');
const dataUrl = `data:image/png;base64,${b64}`;

const t0 = Date.now();
const review = await reviewPanel(dataUrl, {
  worldview: '欧美成人写实 Graphic Novel，钢笔交叉排线，4-5 色有限色板，都市文学气质',
  sceneDescription: '清晨，小公寓厨房，父亲在准备早餐并打包饭盒',
  panelDescription: '中景，父亲站在灶台前，窗外晨光透过百叶窗',
  characterSummaries: ['父亲：40 岁中国男性，戴眼镜，皱纹衬衫，疲惫但温和'],
  referenceImages: [],
});
console.log('elapsed_ms:', Date.now() - t0);

if (!review) {
  console.log('RESULT: null —— 评审未产出（见 generations.jsonl 留痕）');
  process.exit(1);
}
console.log('overall:', review.overall, '| verdict:', review.verdict, '| confidence:', review.confidence);
console.log('top_issue:', review.topIssue);
const dims = review.dimensions as Record<string, { score: number; reason: string }>;
for (const [k, v] of Object.entries(dims)) {
  console.log(`  ${k}: ${v.score} — ${v.reason}`);
}
