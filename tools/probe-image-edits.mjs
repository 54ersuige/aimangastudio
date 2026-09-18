// Try the OpenAI-compatible image edits endpoint (multipart).
import { readFileSync, writeFileSync } from 'node:fs';

const envText = readFileSync(new URL('../.env', import.meta.url), 'utf8');
const env = Object.fromEntries(
  envText.split(/\r?\n/).filter((l) => l && !l.startsWith('#')).map((l) => {
    const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  }),
);
const apiKey = env.IMAGE_API_KEY;
const baseUrl = env.IMAGE_BASE_URL.replace(/\/$/, '');
const model = 'agnes-image-2.5-flash';

const stub = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgAAIAAAUAAeImBZsAAAAASUVORK5CYII=';
const buf = Buffer.from(stub, 'base64');
writeFileSync(new URL('./_probe.png', import.meta.url), buf);

const form = new FormData();
form.append('model', model);
form.append('prompt', 'a small red apple on a wooden table, studio lighting');
form.append('n', '1');
form.append('image', new Blob([buf], { type: 'image/png' }), 'ref.png');

for (const path of ['/images/edits', '/v1/images/edits']) {
  const url = baseUrl + path;
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      body: form,
    });
    const t = await r.text();
    console.log(`[${r.status}] POST ${url}\n  body=${t.slice(0, 600)}\n`);
  } catch (e) {
    console.log(`[ERR] POST ${url} -> ${e.message}`);
  }
}
