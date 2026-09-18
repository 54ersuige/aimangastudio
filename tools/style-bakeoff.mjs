// 一次性风格对照测试：agnes-image-2.1-flash × 5 种风格 × 同一场景
// 用法: node tools/style-bakeoff.mjs [scene]
// 输出: tools/style-bakeoff/<scene>-<style>.png
import fs from 'node:fs';
import path from 'node:path';

const ENV = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8');
const KEY = ENV.match(/IMAGE_API_KEY=(\S+)/)?.[1];
const BASE = (ENV.match(/IMAGE_BASE_URL=(\S+)/)?.[1] || 'https://apihub.agnes-ai.cn/v1').replace(/\/$/, '');

const SCENES = {
  breakfast: {
    subject: `A 40-year-old Chinese father with glasses and a slightly tired face, wearing a wrinkled white shirt, standing at a small apartment kitchen counter making breakfast, a lunch box half-packed beside him, morning sunlight coming through the window blinds, medium shot, quiet restrained emotion`,
    composition: `medium shot, eye level, single figure centered-left, kitchen background softly detailed`,
  },
  street: {
    subject: `The same 40-year-old Chinese father with glasses walking through a crowded evening subway station, briefcase in hand, looking up at the departure board, city commuters around him, warm platform lights against the dusk`,
    composition: `wide shot, figure slightly right of center, environmental storytelling, layered depth`,
  },
};

// 同一组 base prompt，只换 style 块 —— 保证对照公平
const STYLES = {
  'cinematic-realism': {
    style: `cinematic realistic painted illustration, semi-realistic rendering, muted warm palette, natural window light, soft film-like lighting, rich texture detail, restrained literary mood, standalone illustration`,
    extraNeg: [],
  },
  'graphic-novel-ink': {
    style: `European adult graphic novel illustration, detailed ink linework with cross-hatching, limited muted color palette of 4-5 tones, urban literary realism in the manner of David Mazzucchelli and Sean Phillips, visible confident line art, standalone illustration`,
    extraNeg: [],
  },
  'cel-flat': {
    style: `clean bold uniform outlines, flat cel-shaded coloring with clear shadow boundaries, no gradients, muted limited palette, European bande dessinee style, graphic novel page art, standalone illustration`,
    extraNeg: [],
  },
  'new-yorker-thinline': {
    style: `New Yorker style thin-line minimalist cartoon, sparse delicate ink linework, cream paper background, understated dry literary humor, Adrian Tomine style, lots of negative space, standalone illustration`,
    extraNeg: [],
  },
  'watercolor-literary': {
    style: `literary watercolor illustration, soft transparent washes, muted earthy tones, loose sketchy ink outlines, quiet everyday-life mood, standalone illustration`,
    extraNeg: ['watercolor'] /* 该风格本身是水彩，负面词中去掉 watercolor */,
  },
};

const BASE_NEG = ['anime', 'big eyes', 'high saturation', 'photograph', 'photorealistic', 'comic panel grid', 'multiple panels', 'speech bubbles', 'text', 'watermark', 'signature'];

const scene = process.argv[2] || 'breakfast';
const s = SCENES[scene];
if (!s) { console.error('unknown scene:', scene); process.exit(1); }

const outDir = new URL('./style-bakeoff/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
fs.mkdirSync(outDir, { recursive: true });

for (const [name, { style, extraNeg }] of Object.entries(STYLES)) {
  // Agnes 文生图队列不接收 negative_prompt 参数 —— 按项目 dna-inject.ts 的做法，
  // 以显式 "Avoid:" 文本注入 prompt 末尾。
  const neg = [...BASE_NEG, ...extraNeg].join(', ');
  const prompt = [
    s.subject,
    s.composition,
    style,
    'high visual density, semantic alignment, quality: highly detailed',
    `Avoid: ${neg}`,
  ].join(', ');

  const res = await fetch(`${BASE}/images/generations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model: 'agnes-image-2.1-flash',
      prompt,
      size: '2K',
      ratio: '3:4',
      extra_body: { response_format: 'b64_json' },
    }),
  }).catch((e) => { console.error(`[${name}] network error:`, e.message); return null; });

  if (!res || !res.ok) {
    console.error(`[${name}] HTTP ${res ? res.status : '??'}:`, res ? (await res.text()).slice(0, 300) : '');
    continue;
  }
  const data = await res.json();
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) { console.error(`[${name}] no b64_json`, JSON.stringify(data).slice(0, 300)); continue; }
  const file = path.join(outDir, `${scene}-${name}.png`);
  fs.writeFileSync(file, Buffer.from(b64, 'base64'));
  console.log(`[${name}] OK -> ${file}`);
}
console.log('done.');
