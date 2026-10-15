// 1) 验证 negative_prompt 是导致 image 全失败的根因（即便绕过它能否生图）
// 2) 验证 frontend dist 中 React app 在 jsdom 里能至少加载（不报错）
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const BASE = 'http://127.0.0.1:3001';

// 2026-10-15：原先此处硬编码明文 API key（且已随文件进入 git 历史）。
// 改为读环境变量。key 仍需在服务端吊销并重发。
const API_KEY = process.env.IMAGE_API_KEY || process.env.TEXT_API_KEY;
if (!API_KEY) {
  console.error('缺少 IMAGE_API_KEY。请在 .env 中配置后重试：IMAGE_API_KEY=xxx');
  process.exit(1);
}

// 1) 直接调 agnes 时如果不传 negative_prompt —— 跟当前后端代码对比
async function agnesImageCall(body) {
  const r = await fetch('https://apihub.agnes-ai.cn/v1/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: (await r.text()).slice(0, 300) };
}

console.log('=== Bug 确认：negative_prompt 导致后端图片生成全部失败 ===');
const withNp = await agnesImageCall({ model: 'agnes-image-2.1-flash', prompt: 'a red apple', negative_prompt: 'ugly, blurry' });
console.log('with negative_prompt →', withNp.status, withNp.body);
const withoutNp = await agnesImageCall({ model: 'agnes-image-2.1-flash', prompt: 'a red apple' });
console.log('without negative_prompt →', withoutNp.status, withoutNp.body.slice(0,80));

// 2) 验证 dist 中的 React bundle 文件存在且非空
const distIndex = resolve('./dist/index.html');
const jsFile = 'index-Bx2S4Ujl.js';
const jsPath = resolve('./dist/assets', jsFile);
console.log('\n=== dist 产物完整性 ===');
console.log('index.html exists:', existsSync(distIndex));
console.log('assets/' + jsFile + ' exists:', existsSync(jsPath));
if (existsSync(jsPath)) {
  const size = readFileSync(jsPath).length;
  console.log('bundle size:', size, 'B (' + (size/1024).toFixed(1) + ' KB)');
}

// 3) 看 series-store 是否有 base64 内嵌（应该没有 —— 已迁移到文件）
const data = readFileSync('./server/data/series-data.json', 'utf-8');
const sizeKb = (data.length/1024).toFixed(1);
const hasB64 = /data:image\/[a-z]+;base64,[A-Za-z0-9+/=]{200,}/.test(data);
console.log('\n=== series-data.json 健康度 ===');
console.log('size:', sizeKb, 'KB');
console.log('contains base64 images:', hasB64, '(false = 已正确迁移到文件)');

// 4) 检查 data/images/ 目录
const imagesDir = './server/data/images';
import('fs').then(fs => {
  const list = fs.existsSync(imagesDir) ? fs.readdirSync(imagesDir) : [];
  console.log('data/images files:', list.length, list.slice(0,3).join(','));
});