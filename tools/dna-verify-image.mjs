// 一次性验证：通过 /api/image 走完整 DNA 注入链路出一张图
import fs from 'node:fs';

const body = {
  prompt: `A 40-year-old Chinese father with glasses, wrinkled white shirt, standing at the small apartment kitchen counter packing a lunch box for his daughter, morning light through the window blinds, medium shot, quiet restrained everyday emotion`,
  aspectRatio: '3:4',
  dnaKey: 'graphic-novel-ink',
};

const res = await fetch('http://127.0.0.1:3001/api/image', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

if (!res.ok) {
  console.error('HTTP', res.status, (await res.text()).slice(0, 500));
  process.exit(1);
}
const data = await res.json();
const dataUrl = data.image || data.data?.[0]?.b64_json;
if (!dataUrl) { console.error('no image in response:', JSON.stringify(data).slice(0, 300)); process.exit(1); }
const b64 = String(dataUrl).split(',')[1];
const file = new URL('./style-bakeoff/dna-verify-graphic-novel-ink.png', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
fs.writeFileSync(file, Buffer.from(b64, 'base64'));
console.log('OK ->', file);
