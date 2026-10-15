/**
 * 公众号平台规范检查（启发式，不替代官方审核）。
 *
 * 检查维度：
 *  - 标题长度：公众号建议 14~30 字，过短或过长都影响推荐。
 *  - 正文总字数：单篇建议 ≥ 300 字，太短没有推荐流量。
 *  - 配图数量：单篇 3~9 张阅读完成率最高。
 *  - 首图（封面）：建议位于正文第 1 张图，且 alt 不为空。
 *  - 敏感词自检：内置一个小型"高风险词清单"（仅前端提醒，未必覆盖全）。
 *  - 摘要 / 导语：建议 30~80 字。
 */
import type { ArticleDraft, DraftBlock } from '../types';

export interface ComplianceCheck {
  label: string;
  detail: string;
  level: 'good' | 'warning' | 'fail';
  score: number;
  maxScore: number;
}

export interface ComplianceReport {
  score: number;
  level: 'pass' | 'review';
  checks: ComplianceCheck[];
  issues: string[];
}

/** 仅做高风险、易踩雷的样本，不代表完整审核词表。 */
const RISKY_WORDS = [
  '最', '第一', '唯一', '绝对', '100%',
  '国家级', '全网最低', '躺着赚', '稳赚不赔',
  '包治', '根治', '祖传秘方',
];

function blockText(block: DraftBlock): string {
  if (block.kind === 'heading' || block.kind === 'paragraph' || block.kind === 'quote') return block.text;
  if (block.kind === 'panel') return block.dialogue || '';
  if (block.kind === 'page') return block.summary || '';
  if (block.kind === 'cast') return block.characters.map(c => c.intro || '').join(' ') || block.title || '';
  return '';
}

function totalChars(blocks: DraftBlock[]): number {
  return blocks.map(blockText).filter(Boolean).reduce((sum, s) => sum + s.length, 0);
}

function findRisky(text: string): string[] {
  return Array.from(new Set(RISKY_WORDS.filter(w => text.includes(w))));
}

export function analyzeCompliance(draft: ArticleDraft): ComplianceReport {
  const checks: ComplianceCheck[] = [];
  const issues: string[] = [];
  const title = draft.title.trim();
  const subtitle = (draft.subtitle || '').trim();
  const images = draft.blocks.filter(b => b.kind === 'image' || b.kind === 'panel');
  const firstImage = images[0];
  const allText = draft.blocks.map(blockText).join('\n');
  const chars = totalChars(draft.blocks);

  // 标题
  if (title.length >= 14 && title.length <= 30) {
    checks.push({ label: '标题长度', detail: `${title.length} 字，符合公众号推荐区间 14–30`, level: 'good', score: 15, maxScore: 15 });
  } else if (title.length === 0) {
    checks.push({ label: '标题长度', detail: '尚未填写标题', level: 'fail', score: 0, maxScore: 15 });
    issues.push('公众号要求必须填写标题。');
  } else if (title.length < 14) {
    checks.push({ label: '标题长度', detail: `${title.length} 字，公众号推荐 14–30 字`, level: 'warning', score: 8, maxScore: 15 });
    issues.push('标题较短，可能影响在订阅号信息流里的点击率。');
  } else {
    checks.push({ label: '标题长度', detail: `${title.length} 字，超过 30 字可能被截断`, level: 'warning', score: 8, maxScore: 15 });
    issues.push('标题超过 30 字，移动端会被省略号截断。');
  }

  // 字数
  if (chars >= 800 && chars <= 3000) {
    checks.push({ label: '正文字数', detail: `${chars} 字，处于公众号推荐阅读区间`, level: 'good', score: 20, maxScore: 20 });
  } else if (chars >= 300) {
    checks.push({ label: '正文字数', detail: `${chars} 字，可发布但偏低，建议 800+`, level: 'warning', score: 14, maxScore: 20 });
    issues.push('公众号推荐单篇 800 字以上，正文偏短可能影响完读率。');
  } else {
    checks.push({ label: '正文字数', detail: `${chars} 字，低于 300 字，几乎不会获得推荐`, level: 'fail', score: 5, maxScore: 20 });
    issues.push('正文不足 300 字，建议补充背景、对白或场景描述。');
  }

  // 图片
  if (images.length >= 3 && images.length <= 9) {
    checks.push({ label: '配图数量', detail: `${images.length} 张，公众号推荐 3–9 张`, level: 'good', score: 15, maxScore: 15 });
  } else if (images.length === 0) {
    checks.push({ label: '配图数量', detail: '尚未加入任何图片', level: 'fail', score: 0, maxScore: 15 });
    issues.push('公众号图文中纯文字阅读完成率较低，建议至少 3 张图。');
  } else if (images.length > 9) {
    checks.push({ label: '配图数量', detail: `${images.length} 张，过多会增加加载时间`, level: 'warning', score: 10, maxScore: 15 });
  } else {
    checks.push({ label: '配图数量', detail: `${images.length} 张，建议 3–9 张之间`, level: 'warning', score: 10, maxScore: 15 });
    issues.push('图片数量过少，建议补充到至少 3 张。');
  }

  // 封面（首图）
  if (firstImage) {
    if (firstImage.kind === 'panel') {
      checks.push({ label: '封面图', detail: '首图为分镜，公众号会用作小图', level: 'good', score: 10, maxScore: 10 });
    } else if (firstImage.kind === 'image' && (firstImage.alt || '').trim()) {
      checks.push({ label: '封面图', detail: '首张图带 alt 文本，便于平台识别', level: 'good', score: 10, maxScore: 10 });
    } else {
      checks.push({ label: '封面图', detail: '首张图缺少 alt，可能被识别为装饰图', level: 'warning', score: 6, maxScore: 10 });
      issues.push('建议为首图补充一句说明文字，提升平台对内容的理解。');
    }
  } else {
    checks.push({ label: '封面图', detail: '没有图片将无法设置封面', level: 'fail', score: 0, maxScore: 10 });
  }

  // 摘要 / 导语
  if (subtitle.length >= 30 && subtitle.length <= 80) {
    checks.push({ label: '导语 / 摘要', detail: `${subtitle.length} 字，符合公众号摘要区间`, level: 'good', score: 10, maxScore: 10 });
  } else if (subtitle.length === 0) {
    checks.push({ label: '导语 / 摘要', detail: '没有导语，将自动截取正文前 54 字', level: 'warning', score: 4, maxScore: 10 });
    issues.push('建议手动写一句 30–80 字的导语，决定了转发卡片展示什么。');
  } else {
    checks.push({ label: '导语 / 摘要', detail: `${subtitle.length} 字，过长会被截断`, level: 'warning', score: 6, maxScore: 10 });
  }

  // 敏感词
  const risky = findRisky(allText);
  if (risky.length === 0) {
    checks.push({ label: '高风险词', detail: '未命中内置高风险词清单', level: 'good', score: 15, maxScore: 15 });
  } else {
    checks.push({ label: '高风险词', detail: `命中：${risky.join('、')}`, level: 'warning', score: 6, maxScore: 15 });
    issues.push(`正文含 ${risky.length} 个高风险词（${risky.slice(0, 3).join('、')}），公众号可能限流，建议改写。`);
  }

  // 原文 / 转载
  // 2026-10-15：author 在 Draft 上是可选字段，原代码直接 .trim() 会在未署名时
  // 抛 TypeError，连带整个合规检查面板崩掉。收敛成一次安全取值。
  const author = (draft.author ?? '').trim();
  if (author) {
    checks.push({ label: '原创声明', detail: `已署名：${author}`, level: 'good', score: 5, maxScore: 5 });
  } else {
    checks.push({ label: '原创声明', detail: '未填写作者，公众号可能默认非原创', level: 'warning', score: 2, maxScore: 5 });
    issues.push('填写作者可在公众号后台勾选"原创"声明。');
  }

  const score = Math.max(0, Math.min(100, checks.reduce((s, c) => s + c.score, 0)));
  return {
    score,
    level: score >= 70 ? 'pass' : 'review',
    checks,
    issues,
  };
}
