// Exhaustive probe: try every plausible reference field name + payload shape
// against the Agnes image endpoint. Goal: figure out how to send reference
// images to `agnes-image-2.5-flash` without getting "LLM Provider NOT provided".
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
// tiny 1x1 PNG
const stub = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgAAIAAAUAAeImBZsAAAAASUVORK5CYII=';
const dataUri = `data:image/png;base64,${stub}`;

const cases = [
  { name: 'A: image=[dataUri]',      body: { model, prompt: 'apple on wood table', n: 1, image: [dataUri] } },
  { name: 'B: image=[{url:dataUri}]', body: { model, prompt: 'apple on wood table', n: 1, image: [{ url: dataUri }] } },
  { name: 'C: image_url=dataUri',     body: { model, prompt: 'apple on wood table', n: 1, image_url: dataUri } },
  { name: 'D: reference_images=[dataUri]', body: { model, prompt: 'apple on wood table', n: 1, reference_images: [dataUri] } },
  { name: 'E: extra_body.image=[dataUri]', body: { model, prompt: 'apple on wood table', n: 1, extra_body: { image: [dataUri] } } },
  { name: 'F: no model (no image)',  body: { prompt: 'apple on wood table', n: 1 } },
  { name: 'G: model=claude-3-haiku + image', body: { model: 'claude-3-haiku-20240307', prompt: 'apple', n: 1, image: [dataUri] } },
  { name: 'H: model=gemini-2.0-flash + image', body: { model: 'gemini-2.0-flash', prompt: 'apple', n: 1, image: [dataUri] } },
];

for (const c of cases) {
  const r = await fetch(`${baseUrl}/images/generations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify(c.body),
  });
  const t = await r.text();
  console.log(`[${r.status}] ${c.name}\n  body=${t.slice(0, 600)}\n`);
}
