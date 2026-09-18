// Tiny probe: read .env manually and call the Agnes image API directly.
import { readFileSync } from 'node:fs';

const envText = readFileSync(new URL('../.env', import.meta.url), 'utf8');
const env = Object.fromEntries(
  envText
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const idx = l.indexOf('=');
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
    }),
);

const apiKey = env.IMAGE_API_KEY;
const baseUrl = (env.IMAGE_BASE_URL || 'https://apihub.agnes-ai.cn/v1').replace(/\/$/, '');
const model = process.argv[2] || env.IMAGE_MODEL || 'agnes-image-2.5-flash';

const body = {
  model,
  prompt: 'a small red apple on a wooden table, studio lighting, product photo',
  n: 1,
  aspect_ratio: '1:1',
};

const res = await fetch(`${baseUrl}/images/generations`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
  },
  body: JSON.stringify(body),
});

const text = await res.text();
console.log('status =', res.status);
console.log('model  =', model);
console.log('baseUrl=', baseUrl);
console.log('body   =', text.slice(0, 800));
