/**
 * 公众号条漫导出 —— 把一页的所有分镜竖向拼接成一张可直接发布的长图。
 *
 * 排版规则：
 *  - 画布宽度 900px（公众号正文标准宽度）
 *  - 每格图片全宽绘制（3:4 分镜约为 900×1200）
 *  - 格与格之间用纸色留白分隔（条漫呼吸感）
 *  - 每格下方的对白/旁白渲染为衬线文字（对白在图外，由文字区承载）
 */
import type { SeriesPage } from '../types';

const STRIP_WIDTH = 900;   // 公众号正文标准宽度
const GAP = 28;            // 格间距（纸色留白）
const PAPER = '#F8F5EE';   // 纸色背景，与应用 --paper 一致
const INK = '#26221C';     // 文字色，与应用 --ink 一致

// 对白文字区排版参数
const TEXT_FONT = '20px "Noto Serif SC", "Source Serif 4", Georgia, serif';
const TEXT_LINE_HEIGHT = 32;
const TEXT_PAD_X = 36;
const TEXT_PAD_TOP = 10;
const TEXT_PAD_BOTTOM = 14;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = src;
  });
}

/** 中文/英文混合手动换行。 */
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const chars = [...text];
  const lines: string[] = [];
  let line = '';
  for (const ch of chars) {
    if (ch === '\n') {
      lines.push(line);
      line = '';
      continue;
    }
    const test = line + ch;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = ch;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** 把一页拼接成一张条漫长图并触发下载。 */
export async function exportPageAsStrip(page: SeriesPage, seriesTitle: string): Promise<void> {
  const panels = [...page.panels].filter(p => p.imageUrl).sort((a, b) => a.index - b.index);
  if (panels.length === 0) return;

  const imgs = await Promise.all(panels.map(p => loadImage(p.imageUrl!)));

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 不可用');

  // —— 第一遍：用临时 ctx 计算文字区高度，得出总高度 ——
  ctx.font = TEXT_FONT;
  const textLines = panels.map(p => {
    const text = (p.dialogue || '').trim();
    if (!text) return [] as string[];
    return wrapText(ctx, text, STRIP_WIDTH - TEXT_PAD_X * 2);
  });
  const imgHeights = imgs.map(img => Math.round(STRIP_WIDTH * img.height / img.width));

  const blockHeights = panels.map((_, i) => {
    const lines = textLines[i];
    const textH = lines.length > 0 ? TEXT_PAD_TOP + lines.length * TEXT_LINE_HEIGHT + TEXT_PAD_BOTTOM : 0;
    return imgHeights[i] + textH;
  });
  const totalH = blockHeights.reduce((a, b) => a + b, 0) + GAP * (panels.length + 1);

  // —— 第二遍：绘制 ——
  canvas.width = STRIP_WIDTH;
  canvas.height = totalH;
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, STRIP_WIDTH, totalH);
  ctx.font = TEXT_FONT;
  ctx.fillStyle = INK;
  ctx.textBaseline = 'top';

  let y = GAP;
  panels.forEach((panel, i) => {
    // 图片
    ctx.drawImage(imgs[i], 0, y, STRIP_WIDTH, imgHeights[i]);
    y += imgHeights[i];

    // 对白文字（在图下方）
    const lines = textLines[i];
    if (lines.length > 0) {
      let ty = y + TEXT_PAD_TOP;
      for (const ln of lines) {
        ctx.fillText(ln, TEXT_PAD_X, ty);
        ty += TEXT_LINE_HEIGHT;
      }
      y += TEXT_PAD_TOP + lines.length * TEXT_LINE_HEIGHT + TEXT_PAD_BOTTOM;
    }

    y += GAP;
  });

  // —— 导出 ——
  const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/png'));
  if (!blob) throw new Error('条漫导出失败');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${seriesTitle}-第${page.pageNumber}页.png`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** 导出整个系列：每页一张条漫长图，依次下载。返回导出的页数。 */
export async function exportSeriesAsStrips(pages: SeriesPage[], seriesTitle: string): Promise<number> {
  let count = 0;
  for (const page of pages) {
    if (page.panels.some(p => p.imageUrl)) {
      await exportPageAsStrip(page, seriesTitle);
      count++;
      await new Promise(r => setTimeout(r, 400));
    }
  }
  return count;
}
