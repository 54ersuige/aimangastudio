import React, { useEffect, useMemo, useState } from 'react';
import type {
  ArticleDraft,
  Chapter,
  DraftBlock,
  DraftTemplateId,
  DraftTypography,
  Series,
  SeriesPage,
} from '../types';
import { flattenSeriesChapters } from '../contexts/SeriesContext';
import {
  TEMPLATES,
  buildPreviewHtml,
  copyDraftHtmlToClipboard,
  downloadDraftHtml,
  exportDraftToHtml,
  exportDraftToMarkdown,
} from '../services/wechatHtmlExport';
import { suggestTitles } from '../services/titleSuggestions';
import {
  analyzeArticleDraft,
  hasOptimizableContent,
  optimizeArticleDraft,
} from '../services/articleQuality';
import { analyzeOriginality, suggestRewrites } from '../services/originality';
import { analyzeCompliance } from '../services/platformCompliance';
import {
  buildContinuityHint,
  buildTransitionBlock,
  findPreviousChapter,
  summarizeChapters,
} from '../services/continuity';
import { useToast } from './Toast';
import { ChevronDownIcon, ChevronUpIcon, DownloadIcon, EyeIcon } from './icons';
import { Section, Field, BlockRow } from './publisher-modal/parts';

/**
 * 公众号图文发布弹窗（第一阶段）
 *
 * 工作流：
 *  1) 选择模板
 *  2) 选择要导入的章节 / 分镜（图片与文字独立成 block）
 *  3) 调节排版参数（主题色 / 字号 / 行高 / 标题字体 / 末尾装饰）
 *  4) 标题 / 副标题 / 作者
 *  5) 在手机 / 桌面预览中检查
 *  6) 复制或下载 HTML
 *
 * 设计原则：所有内容（图片、文字、引用、分镜）都以独立的 DraftBlock 形式存储，
 * 不在文本里内嵌图片——这样用户在公众号编辑器里可以自由拖拽顺序。
 */
export interface PublisherModalProps {
  open: boolean;
  onClose: () => void;
  series: Series | null;
}

type PreviewMode = 'mobile' | 'desktop';

export function PublisherModal(props: PublisherModalProps): React.ReactElement | null {
  const { open, onClose, series } = props;
  const toast = useToast();
  const [draft, setDraft] = useState<ArticleDraft | null>(null);
  const [preview, setPreview] = useState<PreviewMode>('mobile');
  const [titles, setTitles] = useState<ReturnType<typeof suggestTitles>>([]);
  const [chapterOpen, setChapterOpen] = useState<Record<string, boolean>>({});
  // 三个自检模块默认隐藏；用户主动开启后才计算并展示。
  const [showOriginality, setShowOriginality] = useState(false);
  const [showCompliance, setShowCompliance] = useState(false);
  const [showTransition, setShowTransition] = useState(false);

  // ESC 关闭 —— 与 ConfirmDialog/ManualEditors 的紧急出口保持一致
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // 初始化 / 重置草稿
  useEffect(() => {
    if (!open || !series) return;
    const tpl = TEMPLATES.magazine;
    const now = Date.now();
    setDraft({
      id: `draft-${now}`,
      title: series.title || '未命名文章',
      subtitle: '',
      author: '',
      template: tpl.id,
      typography: { ...tpl.defaults },
      sourceSeriesId: series.id,
      blocks: defaultBlocksForSeries(series),
      createdAt: now,
      updatedAt: now,
    });
    setTitles(suggestTitles(series));
    // 默认展开所有章节
    const chs = flattenSeriesChapters(series);
    const o: Record<string, boolean> = {};
    chs.forEach(c => { o[c.id] = true; });
    setChapterOpen(o);
  }, [open, series]);

  const chapters = flattenSeriesChapters(series);
  const previewHtml = useMemo(() => draft ? buildPreviewHtml(draft) : '', [draft]);
  const qualityReport = useMemo(() => draft ? analyzeArticleDraft(draft) : null, [draft]);
  const originalityReport = useMemo(() => draft ? analyzeOriginality(draft) : null, [draft]);
  const complianceReport = useMemo(() => draft ? analyzeCompliance(draft) : null, [draft]);
  const chapterSnapshots = useMemo(() => series ? summarizeChapters(series) : [], [series]);
  const continuityHint = useMemo(() => {
    if (!series) return [] as string[];
    const flat = flattenSeriesChapters(series);
    if (flat.length < 1) return [] as string[];
    // 看当前是第几章，对比"上一章"和"本章"
    const last = flat[flat.length - 1];
    const prev = findPreviousChapter(series, last.id);
    if (!prev) return [`这是「${last.title}」，作为第一话，建议用一段场景建立主角、时间和冲突。`];
    const prevSnap = chapterSnapshots.find(s => s.id === prev.id) ?? null;
    const lastSnap = chapterSnapshots.find(s => s.id === last.id) ?? null;
    return buildContinuityHint(prevSnap, lastSnap);
  }, [series, chapterSnapshots]);
  const transitionTemplate = useMemo(() => {
    if (!series) return '';
    const flat = flattenSeriesChapters(series);
    if (flat.length === 0) return '';
    const last = flat[flat.length - 1];
    const prev = findPreviousChapter(series, last.id);
    const prevSnap = prev ? (chapterSnapshots.find(s => s.id === prev.id) ?? null) : null;
    return buildTransitionBlock(prevSnap, last.title);
  }, [series, chapterSnapshots]);
  if (!open || !draft || !qualityReport || !originalityReport || !complianceReport) return null;

  const updateDraft = (patch: Partial<ArticleDraft>) => {
    setDraft(d => d ? { ...d, ...patch, updatedAt: Date.now() } : d);
  };
  const updateTypography = (patch: Partial<DraftTypography>) => {
    setDraft(d => d ? { ...d, typography: { ...d.typography, ...patch }, updatedAt: Date.now() } : d);
  };
  const changeTemplate = (tpl: DraftTemplateId) => {
    setDraft(d => d ? {
      ...d,
      template: tpl,
      typography: { ...TEMPLATES[tpl].defaults, ...d.typography },
      updatedAt: Date.now(),
    } : d);
  };

  // 块级操作
  const moveBlock = (idx: number, delta: number) => {
    setDraft(d => {
      if (!d) return d;
      const next = [...d.blocks];
      const j = idx + delta;
      if (j < 0 || j >= next.length) return d;
      const t = next[idx];
      next[idx] = next[j];
      next[j] = t;
      return { ...d, blocks: next, updatedAt: Date.now() };
    });
  };
  const removeBlock = (idx: number) => {
    setDraft(d => d ? { ...d, blocks: d.blocks.filter((_, i) => i !== idx), updatedAt: Date.now() } : d);
  };
  /** 复制一个块：把当前块的内容克隆成新块，紧跟其后。 */
  const duplicateBlock = (idx: number) => {
    setDraft(d => {
      if (!d) return d;
      const src = d.blocks[idx];
      if (!src) return d;
      const clone = JSON.parse(JSON.stringify(src)) as DraftBlock;
      const next = [...d.blocks];
      next.splice(idx + 1, 0, clone);
      return { ...d, blocks: next, updatedAt: Date.now() };
    });
    toast.push('已复制当前内容块', 'success');
  };
  const addTextBlock = (kind: 'heading' | 'paragraph' | 'quote') => {
    setDraft(d => {
      if (!d) return d;
      const block: DraftBlock = kind === 'heading'
        ? { kind: 'heading', level: 2, text: '' }
        : kind === 'quote'
          ? { kind: 'quote', text: '' }
          : { kind: 'paragraph', text: '' };
      return { ...d, blocks: [...d.blocks, block], updatedAt: Date.now() };
    });
  };
  const addDivider = () => {
    setDraft(d => d ? { ...d, blocks: [...d.blocks, { kind: 'divider' }], updatedAt: Date.now() } : d);
  };
  const updateBlockText = (idx: number, text: string) => {
    setDraft(d => {
      if (!d) return d;
      const next = [...d.blocks];
      const cur = next[idx];
      if (cur.kind === 'heading' || cur.kind === 'paragraph' || cur.kind === 'quote') {
        next[idx] = { ...cur, text } as DraftBlock;
      } else if (cur.kind === 'cast') {
        next[idx] = { ...cur, title: text } as DraftBlock;
      }
      return { ...d, blocks: next, updatedAt: Date.now() };
    });
  };

  // 导入操作
  const toggleImportChapter = (chapter: Chapter) => {
    setDraft(d => {
      if (!d) return d;
      const pageIds = new Set(chapter.pages.map(page => page.id));
      const isChapterBlock = (b: DraftBlock) =>
        (b.kind === 'page' || b.kind === 'panel') && pageIds.has(b.pageId);
      const has = d.blocks.some(isChapterBlock);
      if (has) {
        return {
          ...d,
          blocks: d.blocks.filter(b => !isChapterBlock(b)),
          updatedAt: Date.now(),
        };
      }
      // 追加：每页一个 page block + 每个有图的 panel 一个 panel block
      const newBlocks: DraftBlock[] = [];
      chapter.pages.forEach((pg: SeriesPage) => {
        newBlocks.push({
          kind: 'page',
          pageId: pg.id,
          title: pg.title || `第 ${pg.pageNumber} 页`,
          sceneDescription: pg.sceneDescription,
          summary: pageSummary(pg),
        });
        pg.panels.forEach(p => {
          if (p.imageUrl) {
            newBlocks.push({
              kind: 'panel',
              pageId: pg.id,
              panelIndex: p.index,
              imageUrl: p.imageUrl,
              dialogue: p.dialogue,
              // 2026-09-11：整章导入同样带齐「三件套」，否则公众号里读不到旁白/内心独白。
              narration: p.narration,
              innerThought: p.innerThought,
            });
          }
        });
      });
      return { ...d, blocks: [...d.blocks, ...newBlocks], updatedAt: Date.now() };
    });
  };
  const toggleImportPanel = (page: SeriesPage, panelIndex: number) => {
    const panel = page.panels.find(p => p.index === panelIndex);
    if (!panel?.imageUrl) return;
    // 提到闭包外：TS 不会把属性收窄（panel.imageUrl 为 string）带进 setDraft 回调，
    // 在回调里直接用 panel.imageUrl 会退化成 string | undefined 而报错。
    const imageUrl = panel.imageUrl;
    setDraft(d => {
      if (!d) return d;
      const key = `${page.id}:${panelIndex}`;
      const exists = d.blocks.some(b => b.kind === 'panel' && `${b.pageId}:${b.panelIndex}` === key);
      if (exists) {
        return {
          ...d,
          blocks: d.blocks.filter(b => !(b.kind === 'panel' && `${b.pageId}:${b.panelIndex}` === key)),
          updatedAt: Date.now(),
        };
      }
      const block: DraftBlock = {
        kind: 'panel',
        pageId: page.id,
        panelIndex,
        imageUrl,
        dialogue: panel.dialogue,
        narration: panel.narration,
        innerThought: panel.innerThought,
      };
      return { ...d, blocks: [...d.blocks, block], updatedAt: Date.now() };
    });
  };

  // 导出
  const onCopy = async () => {
    try {
      const html = exportDraftToHtml(draft);
      await copyDraftHtmlToClipboard(html);
      toast.push('已复制 HTML 到剪贴板', 'success');
    } catch (e: any) {
      toast.push(e?.message || '复制失败', 'error');
    }
  };
  const onDownload = () => {
    try {
      const html = exportDraftToHtml(draft);
      downloadDraftHtml(draft, html);
      toast.push('已下载 HTML 文件', 'success');
    } catch (e: any) {
      toast.push(e?.message || '下载失败', 'error');
    }
  };

  /** 一键导出 Markdown：作者经常用 Markdown 在其他编辑器继续修改。 */
  const onDownloadMarkdown = () => {
    try {
      const md = exportDraftToMarkdown(draft);
      const safe = (draft.title || 'untitled').replace(/[\\/:*?"<>|]/g, '_').slice(0, 64);
      const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${safe}.md`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      toast.push('已下载 Markdown 文件', 'success');
    } catch (e: any) {
      toast.push(e?.message || '下载失败', 'error');
    }
  };

  const handleOptimize = () => {
    if (!draft || !hasOptimizableContent(draft)) return;
    const next = optimizeArticleDraft(draft);
    setDraft(next);
    toast.push(`已清理 ${draft.blocks.length - next.blocks.length} 个空内容块`, 'success');
  };

  /** 把生成的过渡模板作为一个 quote 块插入草稿开头。 */
  const insertTransitionBlock = () => {
    if (!transitionTemplate.trim()) return;
    const block: DraftBlock = { kind: 'quote', text: transitionTemplate };
    setDraft(d => d ? { ...d, blocks: [block, ...d.blocks], updatedAt: Date.now() } : d);
    toast.push('已在文首插入「承上启下」过渡块', 'success');
  };

  return (
    <div className="modal-veil" role="dialog" aria-modal="true" onClick={onClose}>
      <div
        className="modal-card fade-in publisher-modal"
        onClick={e => e.stopPropagation()}
        style={{ maxWidth: '72rem', width: 'calc(100% - 2rem)', padding: 0 }}
      >
        {/* —— 顶栏 —— */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0.875rem 1.25rem',
          borderBottom: '1px solid var(--rule-soft)',
          background: 'var(--paper)',
        }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem' }}>
            <span className="kicker kicker--accent">公众号图文</span>
            <span className="headline headline--lg" style={{ fontSize: '1rem', margin: 0 }}>{draft.title || '未命名草稿'}</span>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="btn btn--ghost" onClick={onCopy} style={{ padding: '0.4rem 0.8rem', fontSize: '0.8125rem' }}>
              复制 HTML
            </button>
            <button className="btn btn--ghost" onClick={onDownloadMarkdown} style={{ padding: '0.4rem 0.8rem', fontSize: '0.8125rem' }}>
              下载 Markdown
            </button>
            <button className="btn btn--primary" onClick={onDownload} style={{ padding: '0.4rem 0.8rem', fontSize: '0.8125rem' }}>
              <DownloadIcon style={{ width: 14, height: 14 }} /> 下载 HTML
            </button>
            <button className="iconbtn" onClick={onClose} aria-label="关闭" title="关闭" style={{ padding: '0.25rem 0.5rem' }}>✕</button>
          </div>
        </div>

        {/* —— 三栏：左侧配置 / 中间预览 / 右侧导入清单 —— */}
        <div className="publisher-modal__body">
          {/* LEFT：标题 / 模板 / 排版 / 添加内容 */}
          <div className="publisher-modal__panel">
            <Section title="标题与署名">
              <Field label="标题">
                <input
                  className="field-input"
                  value={draft.title}
                  onChange={e => updateDraft({ title: e.target.value })}
                />
              </Field>
              <Field label="副标题 / 导语（可选）">
                <input
                  className="field-input"
                  value={draft.subtitle || ''}
                  onChange={e => updateDraft({ subtitle: e.target.value })}
                />
              </Field>
              <Field label="作者署名（可选）">
                <input
                  className="field-input"
                  value={draft.author || ''}
                  onChange={e => updateDraft({ author: e.target.value })}
                />
              </Field>
              {titles.length > 0 && (
                <div style={{ marginTop: '0.5rem' }}>
                  <span className="kicker" style={{ fontSize: '0.625rem' }}>建议标题</span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginTop: '0.4rem' }}>
                    {titles.map((t, i) => (
                      <button
                        key={i}
                        title={t.reason}
                        className="btn btn--ghost"
                        style={{ padding: '0.25rem 0.55rem', fontSize: '0.75rem' }}
                        onClick={() => updateDraft({ title: t.text })}
                      >
                        {t.text}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </Section>

            <Section title="模板">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem' }}>
                {(Object.values(TEMPLATES)).map(t => (
                  <button
                    key={t.id}
                    onClick={() => changeTemplate(t.id)}
                    className={draft.template === t.id ? 'card card--active' : 'card'}
                    style={{
                      textAlign: 'left',
                      padding: '0.55rem 0.6rem',
                      cursor: 'pointer',
                      background: draft.template === t.id ? 'var(--bg-soft)' : 'var(--bg-card)',
                      color: 'var(--ink)',
                      border: '1px solid var(--rule-soft)',
                    }}
                  >
                    <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{t.name}</div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--ink-3)', marginTop: '0.15rem' }}>{t.description}</div>
                  </button>
                ))}
              </div>
            </Section>

            <Section title="排版参数">
              <Field label={`主题色  ${draft.typography.accent}`}>
                <input
                  type="color"
                  value={draft.typography.accent}
                  onChange={e => updateTypography({ accent: e.target.value })}
                  style={{ width: '100%', height: '2rem', border: '1px solid var(--rule-soft)', background: 'transparent' }}
                />
              </Field>
              <Field label={`正文字号  ${draft.typography.bodySize}px`}>
                <input
                  type="range" min={13} max={20} step={1}
                  value={draft.typography.bodySize}
                  onChange={e => updateTypography({ bodySize: Number(e.target.value) })}
                  style={{ width: '100%' }}
                />
              </Field>
              <Field label={`行高  ${draft.typography.lineHeight.toFixed(2)}`}>
                <input
                  type="range" min={1.4} max={2.2} step={0.05}
                  value={draft.typography.lineHeight}
                  onChange={e => updateTypography({ lineHeight: Number(e.target.value) })}
                  style={{ width: '100%' }}
                />
              </Field>
              <Field label={`段间距  ${draft.typography.paragraphSpacing.toFixed(1)}em`}>
                <input
                  type="range" min={0.8} max={2.4} step={0.1}
                  value={draft.typography.paragraphSpacing}
                  onChange={e => updateTypography({ paragraphSpacing: Number(e.target.value) })}
                  style={{ width: '100%' }}
                />
              </Field>
              <Field label="标题字体">
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  {(['serif', 'sans'] as const).map(f => (
                    <button
                      key={f}
                      className={draft.typography.titleFamily === f ? 'btn btn--primary' : 'btn btn--ghost'}
                      style={{ padding: '0.3rem 0.7rem', fontSize: '0.75rem', flex: 1 }}
                      onClick={() => updateTypography({ titleFamily: f })}
                    >
                      {f === 'serif' ? '衬线' : '无衬线'}
                    </button>
                  ))}
                </div>
              </Field>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.4rem', fontSize: '0.8125rem' }}>
                <input
                  type="checkbox"
                  checked={draft.typography.endMark}
                  onChange={e => updateTypography({ endMark: e.target.checked })}
                />
                <span>文末显示「— 完 —」</span>
              </label>
            </Section>

            <Section title="内容质量">
              <div style={{
                display: 'flex', alignItems: 'center', gap: '0.75rem',
                padding: '0.625rem 0.75rem', background: 'var(--bg-soft)',
                border: '1px solid var(--rule-soft)',
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
                    <strong style={{ fontSize: '1.125rem' }}>{qualityReport.score}</strong>
                    <span className="kicker" style={{ fontSize: '0.5625rem' }}>/ 100</span>
                    <span className="kicker kicker--accent" style={{ fontSize: '0.5625rem' }}>
                      {qualityReport.level === 'ready' ? '适合预览' : '建议优化'}
                    </span>
                  </div>
                  <div style={{ height: '4px', background: 'var(--rule-soft)', marginTop: '0.4rem', overflow: 'hidden' }}>
                    <div style={{ width: `${qualityReport.score}%`, height: '100%', background: qualityReport.level === 'ready' ? '#2C5F3D' : 'var(--accent)', transition: 'width .2s ease' }} />
                  </div>
                </div>
                <button
                  className="btn btn--ghost"
                  style={{ padding: '0.3rem 0.55rem', fontSize: '0.6875rem', whiteSpace: 'nowrap' }}
                  onClick={handleOptimize}
                  disabled={!hasOptimizableContent(draft)}
                >
                  清理空块
                </button>
              </div>
              <div style={{ display: 'grid', gap: '0.3rem', marginTop: '0.55rem' }}>
                {qualityReport.checks.map(check => (
                  <div key={check.label} style={{ display: 'flex', alignItems: 'baseline', gap: '0.35rem', fontSize: '0.6875rem' }}>
                    <span style={{ color: check.level === 'good' ? '#2C5F3D' : 'var(--accent)', fontWeight: 700 }}>
                      {check.level === 'good' ? '✓' : '!'}
                    </span>
                    <span style={{ fontWeight: 600 }}>{check.label}</span>
                    <span style={{ color: 'var(--ink-3)' }}>{check.detail}</span>
                  </div>
                ))}
              </div>
              {qualityReport.suggestions.length > 0 && (
                <div style={{ marginTop: '0.5rem', fontSize: '0.6875rem', color: 'var(--ink-2)', lineHeight: 1.5 }}>
                  {qualityReport.suggestions.slice(0, 3).map(s => <div key={s}>· {s}</div>)}
                </div>
              )}
            </Section>

            <Section title="原创性自检">
              {!showOriginality ? (
                <div style={{ fontSize: '0.7rem', color: 'var(--ink-3)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span>启发式本地检查，<b>不联网</b>、<b>不替代平台审核</b>，仅作提示。</span>
                  <button
                    className="btn btn--ghost"
                    style={{ padding: '0.3rem 0.6rem', fontSize: '0.7rem', marginLeft: 'auto' }}
                    onClick={() => setShowOriginality(true)}
                  >
                    展开自检
                  </button>
                </div>
              ) : (
                <>
                  <div style={{
                    padding: '0.55rem 0.7rem',
                    background: originalityReport.level === 'human' ? '#F0F7F1' : 'var(--bg-soft)',
                    border: '1px solid var(--rule-soft)',
                    fontSize: '0.75rem',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', marginBottom: '0.3rem' }}>
                      <strong style={{ fontSize: '1rem' }}>{originalityReport.score}</strong>
                      <span className="kicker" style={{ fontSize: '0.5625rem' }}>/ 100</span>
                      <span className="kicker" style={{ fontSize: '0.5625rem', color: originalityReport.level === 'human' ? '#2C5F3D' : 'var(--accent)' }}>
                        {originalityReport.level === 'human' ? '像人写的' : '建议改写'}
                      </span>
                      <button
                        className="iconbtn"
                        style={{ marginLeft: 'auto', fontSize: '0.65rem', padding: '0.15rem 0.4rem' }}
                        onClick={() => setShowOriginality(false)}
                      >
                        收起
                      </button>
                    </div>
                    <div style={{ color: 'var(--ink-2)', lineHeight: 1.55 }}>
                      {originalityReport.summary}
                    </div>
                  </div>
                  {originalityReport.hints.length > 0 && (
                    <div style={{ display: 'grid', gap: '0.35rem', marginTop: '0.5rem' }}>
                      {originalityReport.hints.slice(0, 5).map((h, i) => {
                        const tip = suggestRewrites(h.excerpt).join(' ');
                        return (
                          <div key={i} style={{
                            borderLeft: '3px solid var(--accent)',
                            background: 'var(--bg-card)',
                            padding: '0.4rem 0.55rem',
                            fontSize: '0.7rem',
                            color: 'var(--ink-2)',
                          }}>
                            <div>{h.message}</div>
                            {tip && <div style={{ marginTop: 2, color: 'var(--ink-3)' }}>建议：{tip}</div>}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <div style={{ marginTop: '0.5rem', fontSize: '0.65rem', color: 'var(--ink-3)' }}>
                    自检基于常见 AI 短语与重复模式启发式，不联网检测、不替代平台审核。
                  </div>
                </>
              )}
            </Section>

            <Section title="平台规范自检">
              {!showCompliance ? (
                <div style={{ fontSize: '0.7rem', color: 'var(--ink-3)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span>按公众号推荐区间给出<b>建议</b>，所有问题都由你决定是否改。</span>
                  <button
                    className="btn btn--ghost"
                    style={{ padding: '0.3rem 0.6rem', fontSize: '0.7rem', marginLeft: 'auto' }}
                    onClick={() => setShowCompliance(true)}
                  >
                    展开自检
                  </button>
                </div>
              ) : (
                <>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: '0.75rem',
                    padding: '0.55rem 0.7rem', background: 'var(--bg-soft)',
                    border: '1px solid var(--rule-soft)',
                    marginBottom: '0.4rem',
                  }}>
                    <strong style={{ fontSize: '1rem' }}>{complianceReport.score}</strong>
                    <span className="kicker" style={{ fontSize: '0.5625rem' }}>/ 100</span>
                    <span className="kicker" style={{ fontSize: '0.5625rem', color: complianceReport.level === 'pass' ? '#2C5F3D' : 'var(--accent)' }}>
                      {complianceReport.level === 'pass' ? '可发布' : '需优化'}
                    </span>
                    <button
                      className="iconbtn"
                      style={{ marginLeft: 'auto', fontSize: '0.65rem', padding: '0.15rem 0.4rem' }}
                      onClick={() => setShowCompliance(false)}
                    >
                      收起
                    </button>
                  </div>
                  <div style={{ display: 'grid', gap: '0.25rem' }}>
                    {complianceReport.checks.map(c => (
                      <div key={c.label} style={{ display: 'flex', alignItems: 'baseline', gap: '0.3rem', fontSize: '0.6875rem' }}>
                        <span style={{
                          color: c.level === 'good' ? '#2C5F3D' : c.level === 'warning' ? 'var(--accent)' : 'var(--danger)',
                          fontWeight: 700,
                        }}>
                          {c.level === 'good' ? '✓' : c.level === 'warning' ? '!' : '✕'}
                        </span>
                        <span style={{ fontWeight: 600 }}>{c.label}</span>
                        <span style={{ color: 'var(--ink-3)' }}>{c.detail}</span>
                      </div>
                    ))}
                  </div>
                  {complianceReport.issues.length > 0 && (
                    <div style={{ marginTop: '0.4rem', fontSize: '0.65rem', color: 'var(--ink-2)', lineHeight: 1.5 }}>
                      {complianceReport.issues.slice(0, 3).map((m, i) => <div key={i}>· {m}</div>)}
                    </div>
                  )}
                </>
              )}
            </Section>

            <Section title="添加文字">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                <button className="btn btn--ghost" style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}
                  onClick={() => addTextBlock('heading')}>＋ 标题</button>
                <button className="btn btn--ghost" style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}
                  onClick={() => addTextBlock('paragraph')}>＋ 段落</button>
                <button className="btn btn--ghost" style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}
                  onClick={() => addTextBlock('quote')}>＋ 引用</button>
                <button className="btn btn--ghost" style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}
                  onClick={addDivider}>＋ 分割线</button>
              </div>
            </Section>
          </div>

          {/* MIDDLE：预览 */}
          <div className="publisher-modal__preview">
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '0.75rem',
            }}>
              <span className="kicker">预览</span>
              <div style={{ display: 'flex', gap: '0.4rem' }}>
                {(['mobile', 'desktop'] as const).map(m => (
                  <button
                    key={m}
                    className={preview === m ? 'btn btn--primary' : 'btn btn--ghost'}
                    style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem' }}
                    onClick={() => setPreview(m)}
                  >
                    <EyeIcon style={{ width: 12, height: 12 }} /> {m === 'mobile' ? '手机' : '桌面'}
                  </button>
                ))}
              </div>
            </div>
            <div className={`wechat-preview wechat-preview--${preview}`}>
              <div className="wechat-preview__frame">
                <div
                  className="wechat-preview__body"
                  style={{
                    fontSize: `${draft.typography.bodySize}px`,
                    lineHeight: draft.typography.lineHeight,
                    color: '#1A1A1A',
                    fontFamily: '"PingFang SC","Microsoft YaHei",system-ui,-apple-system,sans-serif',
                  }}
                  dangerouslySetInnerHTML={{ __html: previewHtml }}
                />
              </div>
            </div>
          </div>

          {/* RIGHT：导入清单 + 块编辑 */}
          <div className="publisher-modal__panel">
            <Section title="连载连贯性">
              {!showTransition ? (
                <div style={{ fontSize: '0.7rem', color: 'var(--ink-3)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span>基于已有章节自动生成衔接提示与<b>可编辑</b>过渡模板。</span>
                  <button
                    className="btn btn--ghost"
                    style={{ padding: '0.3rem 0.6rem', fontSize: '0.7rem', marginLeft: 'auto' }}
                    onClick={() => setShowTransition(true)}
                  >
                    展开
                  </button>
                </div>
              ) : (
                <>
                  <div style={{
                    padding: '0.5rem 0.65rem',
                    background: 'var(--bg-soft)',
                    border: '1px solid var(--rule-soft)',
                    fontSize: '0.7rem',
                    color: 'var(--ink-2)',
                    lineHeight: 1.55,
                    position: 'relative',
                  }}>
                    {continuityHint.map((m, i) => <div key={i}>· {m}</div>)}
                    <button
                      className="iconbtn"
                      style={{ position: 'absolute', top: '0.3rem', right: '0.3rem', fontSize: '0.65rem', padding: '0.1rem 0.4rem' }}
                      onClick={() => setShowTransition(false)}
                    >
                      收起
                    </button>
                  </div>
                  <div style={{ marginTop: '0.5rem' }}>
                    <span className="kicker" style={{ fontSize: '0.625rem' }}>上下文摘要</span>
                    <div style={{ display: 'grid', gap: '0.3rem', marginTop: '0.35rem' }}>
                      {chapterSnapshots.length === 0 && (
                        <div style={{ fontSize: '0.7rem', color: 'var(--ink-3)' }}>暂无章节摘要。</div>
                      )}
                      {chapterSnapshots.slice(-3).map(snap => (
                        <div key={snap.id} style={{
                          border: '1px solid var(--rule-soft)',
                          padding: '0.35rem 0.5rem',
                          background: 'var(--bg-card)',
                          fontSize: '0.7rem',
                        }}>
                          <div style={{ fontWeight: 600 }}>{snap.title}</div>
                          <div style={{ color: 'var(--ink-3)', marginTop: 2 }}>{snap.blurb}</div>
                          {snap.lastDialogue && (
                            <div style={{ color: 'var(--ink-2)', marginTop: 2 }}>结尾：{snap.lastDialogue}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                  {transitionTemplate.trim() && (
                    <div style={{ marginTop: '0.6rem' }}>
                      <span className="kicker" style={{ fontSize: '0.625rem' }}>承上启下模板（可编辑）</span>
                      <div style={{
                        marginTop: '0.3rem',
                        padding: '0.45rem 0.55rem',
                        background: 'var(--bg-card)',
                        border: '1px dashed var(--rule)',
                        fontSize: '0.7rem',
                        color: 'var(--ink-2)',
                        whiteSpace: 'pre-wrap',
                      }}>{transitionTemplate}</div>
                      <button
                        className="btn btn--ghost"
                        style={{ marginTop: '0.4rem', padding: '0.3rem 0.6rem', fontSize: '0.7rem' }}
                        onClick={insertTransitionBlock}
                      >
                        插入文首
                      </button>
                    </div>
                  )}
                </>
              )}
            </Section>

            <Section title="导入章节与分镜">
              {chapters.length === 0 && (
                <div className="deck">暂无章节，先回工作台生成。</div>
              )}
              {chapters.map(ch => {
                const pageIds = new Set(ch.pages.map(page => page.id));
                const imported = draft.blocks.some(b =>
                  (b.kind === 'page' || b.kind === 'panel') && pageIds.has(b.pageId),
                );
                return (
                  <div key={ch.id} style={{ marginBottom: '0.5rem' }}>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.4rem',
                      padding: '0.4rem 0.5rem',
                      background: 'var(--bg-soft)',
                      border: '1px solid var(--rule-soft)',
                    }}>
                      <button
                        className="iconbtn"
                        style={{ padding: '0.15rem 0.3rem' }}
                        onClick={() => setChapterOpen(o => ({ ...o, [ch.id]: !o[ch.id] }))}
                        aria-label={chapterOpen[ch.id] ? '收起' : '展开'}
                      >
                        {chapterOpen[ch.id] ? <ChevronUpIcon style={{ width: 12, height: 12 }} /> : <ChevronDownIcon style={{ width: 12, height: 12 }} />}
                      </button>
                      <span style={{ fontWeight: 600, fontSize: '0.8125rem', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {ch.title}
                      </span>
                      <span className="kicker" style={{ fontSize: '0.5625rem' }}>{ch.pages.length} 页</span>
                      <button
                        className={imported ? 'btn btn--primary' : 'btn btn--ghost'}
                        style={{ padding: '0.2rem 0.5rem', fontSize: '0.7rem' }}
                        onClick={() => toggleImportChapter(ch)}
                      >
                        {imported ? '已加入' : '＋ 整章'}
                      </button>
                    </div>
                    {chapterOpen[ch.id] && (
                      <div style={{ padding: '0.4rem 0.5rem 0.6rem 1.5rem', borderLeft: '2px solid var(--rule-soft)', marginLeft: '0.5rem' }}>
                        {ch.pages.map((pg: SeriesPage) => (
                          <div key={pg.id} style={{ marginBottom: '0.4rem' }}>
                            <div style={{ fontSize: '0.75rem', color: 'var(--ink-2)', marginBottom: '0.2rem' }}>
                              {pg.title || `第 ${pg.pageNumber} 页`}
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                              {pg.panels.map(p => {
                                const active = draft.blocks.some(b => b.kind === 'panel' && b.pageId === pg.id && b.panelIndex === p.index);
                                if (!p.imageUrl && !active) {
                                  return null;
                                }
                                return (
                                  <button
                                    key={p.index}
                                    onClick={() => toggleImportPanel(pg, p.index)}
                                    title={p.imageUrl ? '点击切换导入' : '分镜无图'}
                                    className={active ? 'btn btn--primary' : 'btn btn--ghost'}
                                    style={{
                                      padding: '0.1rem 0.4rem',
                                      fontSize: '0.65rem',
                                      opacity: p.imageUrl ? 1 : 0.5,
                                    }}
                                  >
                                    #{p.index + 1}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </Section>

            <Section title={`内容块 (${draft.blocks.length})`}>
              {draft.blocks.length === 0 && (
                <div className="deck">没有内容块，使用左侧"添加文字"或右侧"导入章节"。</div>
              )}
              {draft.blocks.map((b, i) => (
                <React.Fragment key={i}>
                  <BlockRow
                    index={i}
                    total={draft.blocks.length}
                    block={b}
                    onMoveUp={() => moveBlock(i, -1)}
                    onMoveDown={() => moveBlock(i, +1)}
                    onRemove={() => removeBlock(i)}
                    onDuplicate={() => duplicateBlock(i)}
                    onEditText={(text) => updateBlockText(i, text)}
                  />
                </React.Fragment>
              ))}
            </Section>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============ 工具 ============ */

function pageSummary(pg: SeriesPage): string {
  const parts: string[] = [];
  if (pg.sceneDescription) parts.push(pg.sceneDescription);
  const d = pg.panels.map(p => p.dialogue).filter(Boolean).join(' ');
  if (d) parts.push(d);
  return parts.join('\n');
}

const ROLE_LABEL_ZH: Record<string, string> = {
  protagonist: '主角',
  antagonist: '反派',
  supporting_W: '配角',
  supporting: '配角',
};

/** 开篇引子：用世界观背景（时代 + 核心设定 + 剧情走向前 2 句）生成一段「写在前面」。 */
function buildLeadParagraph(series: Series): string {
  const w = series.worldview;
  if (!w) return '';
  const parts: string[] = [];
  if (w.era) parts.push(`地点 · 时代：${w.era}`);
  if (w.summary) parts.push(`故事：${w.summary}`);
  if (w.background) parts.push(w.background.replace(/\s+/g, ' ').slice(0, 240));
  return parts.join('\n\n');
}

/** 主要人物卡：只列非主角以外仍需介绍的配角与反派（主角在封面就该出现，这里补全剩余）。 */
function buildCastBlock(series: Series): DraftBlock | null {
  const chars = series.characters.filter(c => (c.roleInStory || c.description) && c.role !== 'protagonist');
  if (chars.length === 0) return null;
  return {
    kind: 'cast',
    title: '主要人物',
    characters: chars.map(c => ({
      name: c.name,
      role: ROLE_LABEL_ZH[c.role || 'supporting'] || '配角',
      intro: (c.roleInStory || c.description || '').replace(/\s+/g, ' ').slice(0, 60),
      portrait: c.referenceImages?.[0] || c.referenceImage,
    })),
  };
}

/**
 * 根据系列自动铺开成一篇完整的公众号文章结构：
 *  标题 → 开篇引子（世界观背景）→ 主要人物 → 逐话（话标题 + 副题 + 剧情摘要）→
 *  逐页场景 → 逐格（图 + 旁白 + 对白 + 内心独白）→ 结尾金句 / 下话预告。
 *
 * 2026-09-11 修复：旧实现只铺「页标题 + 图片 + 对白」，旁白/内心独白被丢弃，
 * 且完全没有背景、人物、场景事件 —— 整篇像"截图合集"而不是漫画文章。
 */
function defaultBlocksForSeries(series: Series): DraftBlock[] {
  const blocks: DraftBlock[] = [];

  // 1) 开篇引子（有世界观才生成）
  const lead = buildLeadParagraph(series);
  if (lead) blocks.push({ kind: 'paragraph', text: lead });
  // 2) 主要人物卡
  const cast = buildCastBlock(series);
  if (cast) blocks.push(cast);
  blocks.push({ kind: 'divider' });

  // 3) 逐话铺开
  const chapters = flattenSeriesChapters(series);
  chapters.forEach((ch, idx) => {
    blocks.push({ kind: 'heading', level: 2, text: `第 ${idx + 1} 话 · ${ch.title}` });
    if (ch.tagline) blocks.push({ kind: 'quote', text: ch.tagline });
    if (ch.summary) blocks.push({ kind: 'paragraph', text: ch.summary });
    ch.pages.forEach(pg => {
      const scene = (pg.sceneDescription || '').trim();
      if (scene) blocks.push({ kind: 'paragraph', text: scene.replace(/\s+/g, ' ') });
      pg.panels.forEach(p => {
        if (!p.imageUrl) return;
        blocks.push({
          kind: 'panel',
          pageId: pg.id,
          panelIndex: p.index,
          imageUrl: p.imageUrl,
          dialogue: p.dialogue || '',
          narration: p.narration,
          innerThought: p.innerThought,
        });
      });
    });
    // 话末：金句 / 预告（最后一话才带预告）
    if (ch.endingQuote) blocks.push({ kind: 'quote', text: ch.endingQuote });
    if (ch.nextPreview && idx === chapters.length - 1) {
      blocks.push({ kind: 'paragraph', text: `【下话预告】${ch.nextPreview}` });
    }
  });
  return blocks;
}
