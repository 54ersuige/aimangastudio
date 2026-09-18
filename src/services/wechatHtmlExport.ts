/**
 * 公众号图文导出服务（第一阶段）
 *
 * 输入：ArticleDraft
 * 输出：完整的 HTML 字符串（自带内联样式，可直接粘贴到公众号编辑器）
 *      或 Markdown 字符串（用于其他平台继续编辑）
 *
 * 设计原则：
 *  - **图片与文字独立**：渲染时按 DraftBlock 数组顺序排列，互不嵌入。
 *  - **样式内联 + 自带段落标签**：公众号会清空外部样式；唯一能保留
 *    视觉风格的方式是 inline style + <p>/<h1>/<section> 等语义标签。
 *  - **不依赖网络字体**：默认使用系统衬线/无衬线 + 微信常用 fallback。
 *  - **可在手机/桌面预览**：通过 .wechat-preview 类适配不同宽度。
 */
import type {
  ArticleDraft,
  DraftBlock,
  DraftTemplateId,
  DraftTypography,
} from '../types';

/** 模板定义：每套模板提供默认排版参数与装饰元素。 */
export interface TemplateDef {
  id: DraftTemplateId;
  name: string;
  description: string;
  defaults: DraftTypography;
  /** 顶部装饰 HTML（在文章标题区与正文之间）。 */
  headerDecoration?: string;
  /** 底部装饰 HTML。 */
  footerDecoration?: string;
}

export const TEMPLATES: Record<DraftTemplateId, TemplateDef> = {
  magazine: {
    id: 'magazine',
    name: '杂志风',
    description: '粗体标题 + 红色边线 + 衬线大字',
    defaults: {
      accent: '#D14836',
      bodySize: 16,
      lineHeight: 1.75,
      paragraphSpacing: 1.4,
      titleFamily: 'serif',
      endMark: true,
    },
    headerDecoration: '<div class="wechat-rule"></div>',
    footerDecoration: '<div class="wechat-endmark">— 全文完 —</div>',
  },
  literary: {
    id: 'literary',
    name: '文艺风',
    description: '居中标题 + 灰边 + 衬线正文',
    defaults: {
      accent: '#1A1A1A',
      bodySize: 15,
      lineHeight: 1.85,
      paragraphSpacing: 1.6,
      titleFamily: 'serif',
      endMark: true,
    },
    headerDecoration: '<div class="wechat-rule wechat-rule--soft"></div>',
    footerDecoration: '<div class="wechat-endmark">·  ·  ·</div>',
  },
  minimal: {
    id: 'minimal',
    name: '极简风',
    description: '无装饰，纯净无衬线',
    defaults: {
      accent: '#1A1A1A',
      bodySize: 16,
      lineHeight: 1.7,
      paragraphSpacing: 1.2,
      titleFamily: 'sans',
      endMark: false,
    },
  },
};

/** 字符级 HTML 转义（防 XSS / 公众号脏字符）。 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 行内文字处理：换行转 <br>，再转义。 */
function inline(s: string): string {
  return escapeHtml(s).replace(/\n/g, '<br>');
}

/** 单个 block 的渲染（公众号粘贴专用，内联 style）。 */
function renderBlock(b: DraftBlock, t: DraftTypography): string {
  switch (b.kind) {
    case 'heading': {
      const size = b.level === 1 ? '1.6em' : b.level === 2 ? '1.3em' : '1.1em';
      const tag = b.level === 1 ? 'h1' : b.level === 2 ? 'h2' : 'h3';
      return `<${tag} style="
        font-family: ${t.titleFamily === 'serif'
          ? "'Source Serif 4','Noto Serif SC',Georgia,serif"
          : "'Inter','PingFang SC','Microsoft YaHei',sans-serif"};
        font-size: ${size};
        font-weight: 700;
        color: #1A1A1A;
        border-left: 4px solid ${t.accent};
        padding-left: 12px;
        margin: 1.6em 0 0.8em;
        line-height: 1.4;
      ">${inline(b.text)}</${tag}>`;
    }
    case 'paragraph':
      return `<p style="
        margin: 0 0 ${t.paragraphSpacing}em 0;
        font-size: ${t.bodySize}px;
        line-height: ${t.lineHeight};
        color: #1A1A1A;
        text-align: justify;
      ">${inline(b.text)}</p>`;
    case 'quote':
      return `<blockquote style="
        margin: 1.2em 0;
        padding: 0.6em 1em;
        border-left: 3px solid ${t.accent};
        background: #FAF7EE;
        color: #555;
        font-style: italic;
        font-size: ${Math.max(13, t.bodySize - 1)}px;
        line-height: ${t.lineHeight};
      ">${inline(b.text)}</blockquote>`;
    case 'divider':
      return `<hr style="
        border: none;
        border-top: 1px dashed #C8C2B2;
        margin: 2em auto;
        width: 30%;
      " />`;
    case 'image': {
      const cap = b.caption
        ? `<div style="text-align:center;color:#888;font-size:12px;margin-top:6px;font-style:italic;">${inline(b.caption)}</div>`
        : '';
      // 公众号对 img 有诸多限制：必须 ?wx_fmt=jpeg 或 png；data: 也常见被拦截。
      // 这里保持原始 url，附带 alt。
      return `<figure style="margin:1.4em 0;text-align:center;">
        <img src="${escapeHtml(b.url)}" alt="${escapeHtml(b.alt || '')}"
          data-original-src="${escapeHtml(b.url)}"
          data-w-e="true"
          style="max-width:100%;height:auto;display:block;margin:0 auto;" />
        ${cap}
      </figure>`;
    }
    case 'cast': {
      // 人物表：每角色一卡（头像 + 名字 + 定位 + 一句话介绍）。
      const titleHtml = b.title
        ? `<h3 style="
            font-family: ${t.titleFamily === 'serif'
              ? "'Source Serif 4','Noto Serif SC',Georgia,serif"
              : "'Inter','PingFang SC','Microsoft YaHei',sans-serif"};
            font-size: 1.05em;
            color: ${t.accent};
            margin: 1.4em 0 0.6em;
            font-weight: 700;
          ">${inline(b.title)}</h3>`
        : '';
      const cardHtml = b.characters.map(cm => `
        <div style="
          display: flex;
          align-items: center;
          gap: 12px;
          margin: 0.55em 0;
          padding: 0.65em 1em;
          background: #F4EFE2;
          border-left: 3px solid ${t.accent};
          border-radius: 2px;
        ">
          ${cm.portrait ? `<img src="${escapeHtml(cm.portrait)}" alt="" style="
            width: 52px; height: 52px; object-fit: cover;
            border-radius: 2px; border: 1px solid #D8CFC0; flex-shrink: 0;
          " />` : ''}
          <div style="min-width: 0;">
            <div style="
              font-size: ${t.bodySize}px; font-weight: 700; color: #1A1A1A;
              line-height: 1.4;
            ">${inline(cm.name)}${cm.role ? `<span style="
              color: ${t.accent}; font-size: ${Math.max(12, t.bodySize - 3)}px;
              font-weight: 400; margin-left: 8px;
            ">${inline(cm.role)}</span>` : ''}</div>
            ${cm.intro ? `<div style="
              color: #5B5547; font-size: ${Math.max(13, t.bodySize - 2)}px;
              line-height: ${t.lineHeight}; margin-top: 2px;
            ">${inline(cm.intro)}</div>` : ''}
          </div>
        </div>`).join('');
      return `<section style="margin: 1.4em 0;">${titleHtml}${cardHtml}</section>`;
    }
    case 'panel': {
      // 漫画面板里只放"读者会看到的文字"（2026-09-03 三件套）：
      //  - 叙述（narration 上帝视角/场景交代）：米黄底，标题"——"，像小说引言
      //  - 内心独白（innerThought 主角心里话）：米灰斜体，缩进，主语"💭"
      //  - 对白（dialogue 嘴上说出的话）：米色底，左竖线，斜体
      // **不再**自动渲染 description（那是 AI 生图指令，不属于漫画正文）。
      const narration = b.narration as string | undefined;
      const innerThought = b.innerThought as string | undefined;
      // 2026-09-03：三件套渲染按【阅读节奏】顺序：先看图 → 看世界交代 → 看主角心声 → 听人说话
      // 注意：竖屏手机阅读时这个顺序最舒服（叙事由远及近）。
      const narrationBlock = narration
        ? `<div style="
            margin-top: 12px;
            padding: 8px 14px;
            background: #FAF7EE;
            border-left: 3px solid #B59A6F;
            color: #4B4636;
            font-size: ${Math.max(13, t.bodySize - 1)}px;
            line-height: ${t.lineHeight};
            text-align: justify;
            border-radius: 2px;
          ">${inline(narration)}</div>`
        : '';
      const innerBlock = innerThought
        ? `<div style="
            margin-top: 8px;
            padding: 6px 14px;
            padding-left: 24px;
            color: #6B6453;
            font-style: italic;
            font-size: ${Math.max(13, t.bodySize - 1)}px;
            line-height: ${t.lineHeight};
            text-align: justify;
          ">💭 ${inline(innerThought)}</div>`
        : '';
      const dia = b.dialogue
        ? `<div style="
            margin-top: 8px;
            padding: 6px 12px;
            background: #F4EFE2;
            border-left: 3px solid ${t.accent};
            color: #1A1A1A;
            font-style: italic;
            font-size: ${t.bodySize}px;
            line-height: ${t.lineHeight};
          ">${inline(b.dialogue)}</div>`
        : '';
      return `<section style="margin: 1.4em 0;">
        <img src="${escapeHtml(b.imageUrl)}"
          data-original-src="${escapeHtml(b.imageUrl)}"
          data-w-e="true"
          alt="${escapeHtml('分镜 #' + (b.panelIndex + 1))}"
          style="max-width:100%;height:auto;display:block;margin:0 auto;" />
        ${narrationBlock}
        ${innerBlock}
        ${dia}
      </section>`;
    }
    case 'page': {
      // 一页正文（场景描述 + summary）
      const summary = b.summary
        ? `<p style="
            margin: 0 0 ${t.paragraphSpacing}em 0;
            font-size: ${t.bodySize}px;
            line-height: ${t.lineHeight};
            color: #1A1A1A;
            text-align: justify;
          ">${inline(b.summary)}</p>`
        : '';
      return `<section style="margin: 1.6em 0 0.8em;">
        <h2 style="
          font-family: ${t.titleFamily === 'serif'
            ? "'Source Serif 4','Noto Serif SC',Georgia,serif"
            : "'Inter','PingFang SC','Microsoft YaHei',sans-serif"};
          font-size: 1.2em;
          color: ${t.accent};
          margin: 0 0 0.6em;
          font-weight: 700;
        ">${inline(b.title)}</h2>
        ${summary}
      </section>`;
    }
  }
}

/** 构造带 CSS 的 preview HTML（在弹窗里用，受 .wechat-preview 类控制）。 */
export function buildPreviewHtml(draft: ArticleDraft): string {
  const tpl = TEMPLATES[draft.template] || TEMPLATES.magazine;
  const inner = draft.blocks.map(b => renderBlock(b, draft.typography)).join('\n');
  const subtitle = draft.subtitle
    ? `<div style="text-align:center;color:#555;font-style:italic;margin:0 0 1.4em;">${inline(draft.subtitle)}</div>`
    : '';
  return `<h1 style="text-align:center;font-family:${draft.typography.titleFamily === 'serif'
    ? "'Source Serif 4','Noto Serif SC',Georgia,serif"
    : "'Inter','PingFang SC','Microsoft YaHei',sans-serif"};font-size:1.8em;font-weight:800;color:${draft.typography.accent};margin:1.5em 0 0.4em;line-height:1.3;">${inline(draft.title)}</h1>
  ${subtitle}
  ${tpl.headerDecoration || ''}
  <div>${inner}</div>`;
}

/** 导出整篇完整 HTML（含 <html><head><body>），用于下载与复制。 */
export function exportDraftToHtml(draft: ArticleDraft): string {
  const tpl = TEMPLATES[draft.template] || TEMPLATES.magazine;
  const body = buildPreviewHtml(draft);

  // 顶部标题区
  const subtitle = draft.subtitle
    ? `<div style="text-align:center;color:#555;font-style:italic;margin:0 0 1.4em;">${inline(draft.subtitle)}</div>`
    : '';
  const author = draft.author
    ? `<div style="text-align:center;color:#888;font-size:12px;margin-top:1em;">${inline(draft.author)}</div>`
    : '';
  const end = draft.typography.endMark ? (tpl.footerDecoration || '') : '';

  const css = `
body {
  max-width: 720px;
  margin: 0 auto;
  padding: 24px 16px 48px;
  background: #F8F5EE;
  color: #1A1A1A;
  font-family: 'PingFang SC','Microsoft YaHei',system-ui,-apple-system,sans-serif;
}
.wechat-rule {
  height: 2px;
  background: ${draft.typography.accent};
  margin: 1.5em 0;
}
.wechat-rule--soft { background: #D8D2C2; }
.wechat-endmark {
  text-align: center;
  color: #888;
  font-size: 14px;
  letter-spacing: 0.2em;
  margin-top: 3em;
}
`.trim();

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeHtml(draft.title)}</title>
<style>${css}</style>
</head>
<body>
<section class="wechat-article">
  <h1 style="
    text-align:center;
    font-family: ${draft.typography.titleFamily === 'serif'
      ? "'Source Serif 4','Noto Serif SC',Georgia,serif"
      : "'Inter','PingFang SC','Microsoft YaHei',sans-serif"};
    font-size: 1.8em;
    font-weight: 800;
    color: ${draft.typography.accent};
    margin: 1.5em 0 0.4em;
    line-height: 1.3;
  ">${inline(draft.title)}</h1>
  ${subtitle}
  ${tpl.headerDecoration || ''}
  <div class="wechat-body">
${body}
  </div>
  ${end}
  ${author}
</section>
</body>
</html>`;
}

/** 复制到剪贴板（异步 fallback 兼容旧浏览器）。 */
export async function copyDraftHtmlToClipboard(html: string): Promise<void> {
  // 复制纯 HTML 字符串 + 纯文本兜底（部分平台只接受 text/plain）。
  const plain = html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  if (navigator.clipboard && (window as any).ClipboardItem) {
    try {
      const item = new (window as any).ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([plain], { type: 'text/plain' }),
      });
      await navigator.clipboard.write([item]);
      return;
    } catch {
      // 落到下方兜底
    }
  }
  // Fallback：textarea + execCommand('copy')。部分公众号编辑器是 contenteditable，
  // 直接写 text/html 也能显示带格式粘贴（取决于实现），所以这里尽量保留 HTML。
  const ta = document.createElement('textarea');
  ta.value = html;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
  } finally {
    document.body.removeChild(ta);
  }
}

/** 导出整篇为 Markdown（适用于不支持富文本粘贴平台 / 二次编辑）。 */
export function exportDraftToMarkdown(draft: ArticleDraft): string {
  const tpl = TEMPLATES[draft.template] || TEMPLATES.magazine;
  const lines: string[] = [];

  // 标题区
  lines.push(`# ${draft.title}`);
  if (draft.subtitle) {
    lines.push(`*${draft.subtitle}*`);
  }
  if (draft.author) {
    lines.push(`*作者：${draft.author}*`);
  }
  lines.push('');

  // 头部装饰（用分割线代替 HTML 装饰元素）
  if (tpl.headerDecoration) {
    lines.push('---');
    lines.push('');
  }

  // 块渲染
  for (const b of draft.blocks) {
    switch (b.kind) {
      case 'heading': {
        const prefix = b.level === 1 ? '#' : b.level === 2 ? '##' : '###';
        lines.push(`${prefix} ${b.text}`);
        lines.push('');
        break;
      }
      case 'paragraph': {
        lines.push(b.text);
        lines.push('');
        break;
      }
      case 'quote': {
        const quoted = b.text.split('\n').map(l => `> ${l}`).join('\n');
        lines.push(quoted);
        lines.push('');
        break;
      }
      case 'divider': {
        lines.push('---');
        lines.push('');
        break;
      }
      case 'cast': {
        if (b.title) {
          lines.push(`### ${b.title}`);
          lines.push('');
        }
        for (const cm of b.characters) {
          const rolePart = cm.role ? `（${cm.role}）` : '';
          lines.push(`- **${cm.name}**${rolePart}：${cm.intro}`);
        }
        lines.push('');
        break;
      }
      case 'image': {
        lines.push(`![${b.alt || ''}](${b.url})`);
        if (b.caption) {
          lines.push(`*${b.caption}*`);
        }
        lines.push('');
        break;
      }
      case 'page': {
        lines.push(`## ${b.title}`);
        if (b.summary) {
          lines.push(b.summary);
        }
        lines.push('');
        break;
      }
      case 'panel': {
        // 2026-09-03：与 HTML 导出保持一致，只放读者会看到的文字（叙述 + 内心独白 + 对白）。
        // 分镜描述是 AI 生图指令，不进入 Markdown 正文。
        lines.push(`![分镜 #${b.panelIndex + 1}](${b.imageUrl})`);
        const narration = b.narration as string | undefined;
        const innerThought = b.innerThought as string | undefined;
        if (narration) lines.push(narration);
        if (innerThought) lines.push(`*${innerThought}*`); // 斜体表示内心独白
        if (b.dialogue) lines.push(`> ${b.dialogue}`);
        lines.push('');
        break;
      }
    }
  }

  // 文末装饰
  if (draft.typography.endMark && tpl.footerDecoration) {
    lines.push('---');
    lines.push(`*${tpl.footerDecoration.replace(/<[^>]+>/g, '').trim() || '— 完 —'}*`);
  }
  return lines.join('\n');
}

/** 触发浏览器下载 HTML 文件。 */
export function downloadDraftHtml(draft: ArticleDraft, html: string): void {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const safe = draft.title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 64) || 'untitled';
  a.href = url;
  a.download = `${safe}.html`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
