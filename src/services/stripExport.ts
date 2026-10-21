/**
 * 公众号条漫导出 —— 发布路径以「话」为单位（exportEpisodeAsStrip / exportSeriesAsEpisodeStrips）。
 *
 * 版式基准：docs/PM成长记 · 第2话《先保什么》.pdf：
 *  - 画布宽度 900px（公众号正文标准宽度），暖纸色背景
 *  - 每格图片不顶满宽：两侧各留 ~56px 纸边（杂志排版感）
 *  - 每格下方 1-2 行衬线旁白/对白（读者实际读到的文字），说话人名砖红着色，左对齐
 *  - 格与格之间用细虚线分隔（暖灰），前后留足呼吸空间
 *  - 话头：刊名 kicker + 话标题 + 副题 + 细分隔线；结尾：金句 + 下话预告框 + 页脚
 */
import type { Series } from '../types';

const STRIP_WIDTH = 900;   // 公众号正文标准宽度
const PAPER = '#F8F5EE';   // 纸色背景，与应用 --paper 一致
const INK = '#26221C';     // 主文字色（标题）
const INK_2 = '#5B5547';   // 旁白文字色
const DASH = '#C9BFAF';    // 虚线分隔色（暖灰）
const RULE = '#D8CFC0';    // 标题下细线色

const PAD_X = 56;                // 左右纸边
const IMG_W = STRIP_WIDTH - PAD_X * 2;

const TEXT_FONT = '19px "Noto Serif SC", "Source Serif 4", Georgia, serif';
/** 内心独白用斜体（与 HTML 导出的规范一致）。 */
const ITALIC_FONT = 'italic 19px "Noto Serif SC", "Source Serif 4", Georgia, serif';
const TEXT_LINE_HEIGHT = 33;
const TEXT_X = PAD_X + 8;
const TEXT_PAD_TOP = 12;
const TEXT_PAD_BOTTOM = 6;

const SEP_SPACE = 30;      // 虚线上下留白
const BOTTOM_PAD = 56;

const KICKER_FONT = '13px "Noto Serif SC", Georgia, serif';
const TITLE_FONT = 'bold 27px "Noto Serif SC", "Source Serif 4", Georgia, serif';

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

/** 画虚线分隔。 */
function drawDashedSeparator(ctx: CanvasRenderingContext2D, y: number): void {
  ctx.strokeStyle = DASH;
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 6]);
  ctx.beginPath();
  ctx.moveTo(PAD_X, y);
  ctx.lineTo(STRIP_WIDTH - PAD_X, y);
  ctx.stroke();
  ctx.setLineDash([]);
}

// ═══════════════════════════════════════════════════════════════════════
// 话级导出（公众号单元：一章 = 一话 ≈ 15 格，一件完整的事）
// 版式基准：docs/PM成长记 · 第2话《先保什么》.pdf
//   话头（kicker+标题+副题）→ 全部格（说话人名着色）→ 金句 → 下话预告框 → 页脚
// ═══════════════════════════════════════════════════════════════════════

const ACCENT = '#A6543C';        // 说话人名 / 金句 / 强调（砖红）
/** 叙述（场景交代）的文字色 —— 比正文浅，读起来像"引言"而不是"台词"。 */
const NARRATION_INK = '#8A8274';
/** 内心独白的文字色（斜体）。 */
const INNER_INK = '#6B6453';
const QUOTE_FONT = 'bold 21px "Noto Serif SC", "Source Serif 4", Georgia, serif';
const PREVIEW_LABEL_FONT = '13px "Noto Serif SC", Georgia, serif';

export interface EpisodeStripInput {
  seriesTitle: string;
  chapterTitle: string;
  chapterIndex: number;
  /** 整话的全部格（跨页合并后按顺序） */
  panels: Array<{
    imageUrl: string;
    dialogue: string;
    speakerName?: string;
    /** 叙述（场景/时间/背景交代）—— 读者要看的"世界交代"层。 */
    narration?: string;
    /** 内心独白（主角心里话）—— 读者要看的"心理"层。 */
    innerThought?: string;
  }>;
  tagline?: string;
  endingQuote?: string;
  nextPreview?: string;
  /** 上一话标题（页脚"上一话《…》"），无则不显示 */
  prevEpisodeTitle?: string;
  /** 是否最后一话（页脚"全篇完" vs "未完待续"） */
  isLastEpisode?: boolean;
}

interface RichSegment { text: string; color: string; italic?: boolean }

/** 从 dialogue 拆出说话人与正文。优先取"名字："前缀，否则用角色名兜底。 */
export function splitSpeaker(dialogue: string, fallbackName?: string): { speaker?: string; body: string } {
  const t = dialogue.trim();
  const m = t.match(/^[「『]?([^「」『』：:]{1,10})[：:]/);
  if (m) {
    const body = t.slice(m[0].length).trim().replace(/^[「『]/, '').replace(/[」』]$/, '');
    return { speaker: m[1], body };
  }
  const body = t.replace(/^[「『]/, '').replace(/[」』]$/, '');
  return fallbackName ? { speaker: fallbackName, body } : { body };
}

/** 一格要显示的文字（三件套）的来源。 */
export interface PanelTextSource {
  dialogue: string;
  speakerName?: string;
  narration?: string;
  innerThought?: string;
}

/**
 * 组装一格的图下文字（三件套）。
 *
 * 2026-10-20：**之前这里只有对白**，旁白（场景交代）和内心独白被整个漏掉 ——
 * 读者在公众号里看到的就只剩"图 + 台词"，时间/地点/前情全没了。
 *
 * 顺序按阅读节奏（与 wechatHtmlExport 的规范一致）：
 *   先看图 → 看世界交代（narration）→ 看主角心声（innerThought）→ 听人说话（dialogue）
 * 竖屏手机阅读时这个顺序最舒服（叙事由远及近）。
 *
 * **不渲染 description** —— 那是 AI 生图指令（"远景里，玻璃闸机把空间切成内外两层…"），
 * 不属于漫画正文，给读者看反而干扰。
 */
export function buildPanelTextSegments(p: PanelTextSource): RichSegment[] {
  const { speaker, body } = splitSpeaker(p.dialogue || '', p.speakerName);
  const segments: RichSegment[] = [];
  if (p.narration?.trim()) {
    segments.push({ text: '—— ', color: NARRATION_INK });
    segments.push({ text: p.narration.trim(), color: NARRATION_INK });
    segments.push({ text: '\n', color: NARRATION_INK });
  }
  if (p.innerThought?.trim()) {
    segments.push({ text: '💭 ', color: INNER_INK, italic: true });
    segments.push({ text: p.innerThought.trim(), color: INNER_INK, italic: true });
    segments.push({ text: '\n', color: INNER_INK, italic: true });
  }
  if (speaker) segments.push({ text: `${speaker}：`, color: ACCENT });
  segments.push({ text: body, color: INK_2 });
  return segments;
}

/** 把富文本片段按宽度贪婪换行。返回行（每行是若干着色片段）。
 *  片段之间用 '\n' 强制分段（旁白 / 内心 / 对白 三层之间要断行）。
 *  italic 片段单独用斜体字体测量与绘制。
 *  2026-10-20 导出：让测试能直接锁住「三层之间的换行」和「斜体切换」这两件事。 */
export function wrapRich(ctx: CanvasRenderingContext2D, segments: RichSegment[], maxWidth: number): RichSegment[][] {
  const lines: RichSegment[][] = [];
  let line: RichSegment[] = [];
  let lineW = 0;
  const baseFont = ctx.font;
  for (const seg of segments) {
    ctx.font = seg.italic ? ITALIC_FONT : baseFont;
    for (const ch of [...seg.text]) {
      if (ch === '\n') {
        if (line.length > 0) lines.push(line);
        line = [];
        lineW = 0;
        continue;
      }
      const w = ctx.measureText(ch).width;
      if (lineW + w > maxWidth && line.length > 0) {
        lines.push(line);
        line = [];
        lineW = 0;
      }
      const last = line[line.length - 1];
      if (last && last.color === seg.color && !!last.italic === !!seg.italic) last.text += ch;
      else line.push({ text: ch, color: seg.color, italic: seg.italic });
      lineW += w;
    }
  }
  if (line.length > 0) lines.push(line);
  ctx.font = baseFont;
  return lines;
}

function drawRichLine(ctx: CanvasRenderingContext2D, line: RichSegment[], x: number, y: number): void {
  let cx = x;
  const baseFont = ctx.font;
  for (const seg of line) {
    ctx.font = seg.italic ? ITALIC_FONT : baseFont;
    ctx.fillStyle = seg.color;
    ctx.fillText(seg.text, cx, y);
    cx += ctx.measureText(seg.text).width;
  }
  ctx.font = baseFont;
}

/** 画一话的完整长图并触发下载。 */
export async function exportEpisodeAsStrip(input: EpisodeStripInput): Promise<void> {
  const panels = input.panels.filter(p => p.imageUrl);
  if (panels.length === 0) throw new Error('本话还没有可导出的分镜图');

  const imgs = await Promise.all(panels.map(p => loadImage(p.imageUrl!)));

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 不可用');

  // —— 文本预处理 ——
  ctx.font = TEXT_FONT;
  // 话头副题手动换行（40 字副题在 19px 下接近画布宽，超出会画出画布）
  const taglineLines = input.tagline?.trim()
    ? wrapText(ctx, input.tagline.trim(), IMG_W)
    : [];
  const richPanels = panels.map((p, i) => {
    const segments = buildPanelTextSegments(p);
    const lines = segments.length > 0
      ? wrapRich(ctx, segments, IMG_W - (TEXT_X - PAD_X) * 2)
      : [];
    const imgH = Math.round(IMG_W * imgs[i].height / imgs[i].width);
    const textH = lines.length > 0 ? TEXT_PAD_TOP + lines.length * TEXT_LINE_HEIGHT + TEXT_PAD_BOTTOM : 0;
    return { lines, imgH, textH, hasText: lines.length > 0 };
  });

  // —— 话头高度 ——
  const taglineBlockH = taglineLines.length > 0 ? 6 + taglineLines.length * TEXT_LINE_HEIGHT + 6 : 0;
  const headerH = 64 + 20 /*kicker*/ + 46 /*标题*/ + taglineBlockH + 20 /*线下留白*/ + 36;

  // —— 金句高度 ——
  let quoteH = 0;
  let quoteLines: string[] = [];
  if (input.endingQuote?.trim()) {
    ctx.font = QUOTE_FONT;
    quoteLines = wrapText(ctx, input.endingQuote.trim(), IMG_W - 40);
    quoteH = 72 + quoteLines.length * 38 + 48;
  }

  // —— 下话预告框高度 ——
  let previewBoxH = 0;
  let previewLines: string[] = [];
  if (input.nextPreview?.trim()) {
    ctx.font = TEXT_FONT;
    previewLines = wrapText(ctx, input.nextPreview.trim(), IMG_W - 48);
    previewBoxH = 24 + 26 /*label*/ + previewLines.length * TEXT_LINE_HEIGHT + 24;
  }

  // —— 页脚高度 ——
  const footerH = 56 + (input.prevEpisodeTitle ? 28 : 0) + 24 + 64;

  const sepTotal = Math.max(0, richPanels.length - 1) * (SEP_SPACE * 2 + 1);
  const totalH = headerH
    + richPanels.reduce((a, b) => a + b.imgH + b.textH, 0)
    + sepTotal
    + quoteH + previewBoxH + footerH;

  // —— 绘制 ——
  canvas.width = STRIP_WIDTH;
  canvas.height = totalH;
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, STRIP_WIDTH, totalH);
  ctx.textBaseline = 'top';

  // 话头
  let y = 64;
  ctx.textAlign = 'left';
  ctx.fillStyle = INK_2;
  ctx.font = KICKER_FONT;
  ctx.fillText(`《${input.seriesTitle}》 · 第 ${input.chapterIndex} 话`, PAD_X, y);
  y += 20;
  ctx.fillStyle = INK;
  ctx.font = TITLE_FONT;
  ctx.fillText(`第 ${input.chapterIndex} 话《${input.chapterTitle}》`, PAD_X, y);
  y += 46;
  if (taglineLines.length > 0) {
    ctx.fillStyle = INK_2;
    ctx.font = TEXT_FONT;
    let ty = y + 6;
    for (const ln of taglineLines) {
      ctx.fillText(ln, PAD_X, ty);
      ty += TEXT_LINE_HEIGHT;
    }
    y += taglineBlockH;
  }
  const ruleY = y + 20;
  ctx.strokeStyle = RULE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD_X, ruleY);
  ctx.lineTo(STRIP_WIDTH - PAD_X, ruleY);
  ctx.stroke();
  y = ruleY + 36;

  // 全部格
  richPanels.forEach((block, i) => {
    ctx.drawImage(imgs[i], PAD_X, y, IMG_W, block.imgH);
    y += block.imgH;
    if (block.hasText) {
      ctx.font = TEXT_FONT;
      let ty = y + TEXT_PAD_TOP;
      for (const line of block.lines) {
        drawRichLine(ctx, line, TEXT_X, ty);
        ty += TEXT_LINE_HEIGHT;
      }
      y += TEXT_PAD_TOP + block.lines.length * TEXT_LINE_HEIGHT + TEXT_PAD_BOTTOM;
    }
    if (i < richPanels.length - 1) {
      y += SEP_SPACE;
      drawDashedSeparator(ctx, y);
      y += SEP_SPACE + 1;
    }
  });

  // 金句（居中大字）
  if (quoteLines.length > 0) {
    y += 72;
    ctx.font = QUOTE_FONT;
    ctx.fillStyle = ACCENT;
    ctx.textAlign = 'center';
    for (const ln of quoteLines) {
      ctx.fillText(ln, STRIP_WIDTH / 2, y);
      y += 38;
    }
    ctx.textAlign = 'left';
    y += 48;
  }

  // 下话预告（虚线框）
  if (input.nextPreview?.trim() && previewBoxH > 0) {
    y += 24;
    const boxX = PAD_X;
    const boxW = IMG_W;
    ctx.strokeStyle = DASH;
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 6]);
    ctx.strokeRect(boxX, y, boxW, previewBoxH);
    ctx.setLineDash([]);
    ctx.fillStyle = ACCENT;
    ctx.font = PREVIEW_LABEL_FONT;
    ctx.fillText('下话预告', boxX + 24, y + 24);
    ctx.fillStyle = INK_2;
    ctx.font = TEXT_FONT;
    let ty = y + 24 + 26;
    for (const ln of previewLines) {
      ctx.fillText(ln, boxX + 24, ty);
      ty += TEXT_LINE_HEIGHT;
    }
    y += previewBoxH;
  }

  // 页脚
  y += 56;
  ctx.textAlign = 'center';
  ctx.fillStyle = INK_2;
  ctx.font = KICKER_FONT;
  if (input.prevEpisodeTitle) {
    ctx.fillText(`上一话《${input.prevEpisodeTitle}》`, STRIP_WIDTH / 2, y);
    y += 28;
  }
  ctx.fillStyle = DASH;
  ctx.fillText(`${input.seriesTitle} · 第 ${input.chapterIndex} 话 · ${input.isLastEpisode ? '全篇完' : '未完待续'}`, STRIP_WIDTH / 2, y);
  ctx.textAlign = 'left';

  // —— 导出 ——
  const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/png'));
  if (!blob) throw new Error('条漫导出失败');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${input.seriesTitle} · 第${input.chapterIndex}话《${input.chapterTitle}》.png`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** 整系列按「话」导出：每话一张话级长图（含文案三件套），话号全局连续（跨章）。返回导出的话数。 */
export async function exportSeriesAsEpisodeStrips(series: Series): Promise<number> {
  const chapters = series.arcs && series.arcs.length > 0
    ? series.arcs.flatMap(a => a.chapters)
    : (series.chapters ?? []);
  const nameOf = (id: string) => series.characters.find(c => c.id === id)?.name;
  let count = 0;
  for (let i = 0; i < chapters.length; i++) {
    const ch = chapters[i];
    const panels = [...ch.pages]
      .sort((a, b) => a.pageNumber - b.pageNumber)
      .flatMap(p => [...p.panels].sort((x, y) => x.index - y.index))
      .filter(pn => pn.imageUrl);
    if (panels.length === 0) continue;
    await exportEpisodeAsStrip({
      seriesTitle: series.title,
      chapterTitle: ch.title,
      chapterIndex: i + 1,
      tagline: ch.tagline,
      endingQuote: ch.endingQuote,
      nextPreview: ch.nextPreview,
      prevEpisodeTitle: i > 0 ? chapters[i - 1]?.title : undefined,
      isLastEpisode: i === chapters.length - 1,
      panels: panels.map(pn => ({
        imageUrl: pn.imageUrl!,
        dialogue: pn.dialogue || '',
        speakerName: pn.characterIds?.map(nameOf).find(Boolean),
        // 2026-10-20：整季导出同样要带齐三件套，否则公众号里读不到旁白/内心独白。
        narration: pn.narration || '',
        innerThought: pn.innerThought || '',
      })),
    });
    count++;
    await new Promise(r => setTimeout(r, 400));
  }
  return count;
}
