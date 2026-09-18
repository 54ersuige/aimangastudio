// Verify whether attaching reference images causes the 400.
import { readFileSync } from 'node:fs';

const envText = readFileSync(new URL('../.env', import.meta.url), 'utf8');
const env = Object.fromEntries(
  envText.split(/\r?\n/).filter((l) => l && !l.startsWith('#')).map((l) => {
    const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  }),
);

const apiKey = env.IMAGE_API_KEY;
const baseUrl = env.IMAGE_BASE_URL.replace(/\/$/, '');
const model = process.argv[2] || 'agnes-image-2.5-flash';
const withRefs = process.argv[3] === 'refs';

// 1x1 transparent PNG
const stub = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgAAIAAAUAAeImBZsAAAAASUVORK5CYII=';

const body = {
  model,
  prompt: 'a small red apple on a wooden table, studio lighting, product photo',
  n: 1,
  aspect_ratio: '1:1',
};
if (withRefs) body.image = [stub];

const res = await fetch(`${baseUrl}/images/generations`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
  body: JSON.stringify(body),
});
const text = await res.text();
console.log('status=', res.status);
console.log('model=', model, 'refs=', withRefs);
console.log('body =', text.slice(0, 800));
