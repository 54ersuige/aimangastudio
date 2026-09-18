// Probe /v1/images/edits with all plausible field names + look for alternatives.
import { readFileSync } from 'node:fs';

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

async function tryMultipart(field, label) {
  const form = new FormData();
  form.append('model', model);
  form.append('prompt', 'apple on wood table');
  form.append('n', '1');
  form.append(field, new Blob([buf], { type: 'image/png' }), 'ref.png');
  const r = await fetch(`${baseUrl}/images/edits`, {
    method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: form,
  });
  const t = await r.text();
  console.log(`[${r.status}] multipart field="${field}" (${label})\n  ${t.slice(0, 400)}\n`);
}
for (const f of ['image', 'images', 'reference', 'reference_images', 'init_image', 'init_image_url']) {
  await tryMultipart(f, 'first try');
}

// Also check models list to see what image endpoints exist
for (const path of ['/models', '/v1/models', '/images/edits', '/images/variations', '/v1/chat/completions']) {
  const r = await fetch(baseUrl + path, { headers: { Authorization: `Bearer ${apiKey}` } });
  const t = await r.text();
  console.log(`[${r.status}] GET ${path}\n  ${t.slice(0, 200)}\n`);
}
