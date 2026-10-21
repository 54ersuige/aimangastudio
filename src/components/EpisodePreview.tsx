/**
 * 公众号发布预览（全屏）—— 以"话"为单位，模拟公众号文章的实际阅读效果。
 *
 * 结构对齐 docs/PM成长记 · 第2话《先保什么》.pdf：
 *   文章头（标题/刊名）→ 话头 → 全部格（图 + 说话人着色文本）→ 金句 → 下话预告 → 页脚
 * 可在此页 AI 生成/手改发布文案（副题/金句/下话预告），确认后一键导出长图。
 */
import { useState } from 'react';
import type { Series, Chapter } from '../types';
import { updateChapter as apiUpdateChapter, generatePublishCopy as apiGeneratePublishCopy } from '../services/seriesClient';
import { splitSpeaker, exportEpisodeAsStrip } from '../services/stripExport';
import { useToast } from './Toast';

const ACCENT = '#A6543C';
const INK = '#26221C';
const INK_2 = '#5B5547';
const DASH = '#C9BFAF';
const RULE = '#D8CFC0';
const PAPER = '#F8F5EE';

function EpisodePreview({
  series, chapter, chapterIndex, prevChapterTitle, isLast, onClose, onChanged,
}: {
  series: Series;
  chapter: Chapter;
  chapterIndex: number;
  prevChapterTitle?: string;
  /** 是否最后一话（页脚"全篇完" vs "未完待续"） */
  isLast?: boolean;
  onClose: () => void;
  /** 发布文案保存后回传（父组件刷新上下文） */
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const toast = useToast();
  const [editOpen, setEditOpen] = useState(false);
  const [draftTagline, setDraftTagline] = useState(chapter.tagline ?? '');
  const [draftQuote, setDraftQuote] = useState(chapter.endingQuote ?? '');
  const [draftPreview, setDraftPreview] = useState(chapter.nextPreview ?? '');

  const nameOf = (id: string) => series.characters.find(c => c.id === id)?.name;

  // 整话的全部格（跨页合并）
  const allPanels = [...chapter.pages]
    .sort((a, b) => a.pageNumber - b.pageNumber)
    .flatMap(p => [...p.panels].sort((x, y) => x.index - y.index));
  const donePanels = allPanels.filter(p => p.imageUrl);

  // 用户手改过但尚未保存的文案（用于 AI 重新生成前的覆盖确认）
  const copyDirty =
    draftTagline !== (chapter.tagline ?? '') ||
    draftQuote !== (chapter.endingQuote ?? '') ||
    draftPreview !== (chapter.nextPreview ?? '');

  const saveCopy = async () => {
    setBusy(true);
    try {
      await apiUpdateChapter(series.id, chapter.id, {
        tagline: draftTagline.trim(),
        endingQuote: draftQuote.trim(),
        nextPreview: draftPreview.trim(),
      });
      onChanged();
      toast.push('发布文案已保存', 'success');
    } catch (e: any) {
      toast.push(e.message || '保存发布文案失败', 'error');
    } finally {
      setBusy(false);
    }
  };

  const genCopy = async () => {
    if (copyDirty && !window.confirm('当前手改的发布文案尚未保存，AI 重新生成会覆盖这些修改。继续吗？')) return;
    setBusy(true);
    try {
      const r = await apiGeneratePublishCopy(series.id, chapter.id);
      setDraftTagline(r.chapter.tagline ?? '');
      setDraftQuote(r.chapter.endingQuote ?? '');
      setDraftPreview(r.chapter.nextPreview ?? '');
      onChanged();
      toast.push('发布文案已生成，可在下方编辑区微调', 'success');
    } catch (e: any) {
      toast.push(e.message || '生成发布文案失败', 'error');
    } finally {
      setBusy(false);
    }
  };

  const exportStrip = async () => {
    if (donePanels.length === 0) return;
    const missing = allPanels.length - donePanels.length;
    if (missing > 0 && !window.confirm(`本话还有 ${missing} 格未生成，导出的长图会跳过这些格。仍要继续导出吗？`)) return;
    setExporting(true);
    try {
      await exportEpisodeAsStrip({
        seriesTitle: series.title,
        chapterTitle: chapter.title,
        chapterIndex,
        tagline: chapter.tagline,
        endingQuote: chapter.endingQuote,
        nextPreview: chapter.nextPreview,
        prevEpisodeTitle: prevChapterTitle,
        isLastEpisode: isLast,
        panels: donePanels.map(pn => ({
          imageUrl: pn.imageUrl!,
          dialogue: pn.dialogue || '',
          speakerName: pn.characterIds?.map(nameOf).find(Boolean),
          // 2026-10-20：导出也要带上旁白/内心独白 —— 之前只传对白，
          // 导致公众号长图里"场景交代"和"主角心声"整层丢失。
          narration: pn.narration || '',
          innerThought: pn.innerThought || '',
        })),
      });
      toast.push('长图已导出，请到浏览器下载目录查看', 'success');
    } catch (e: any) {
      toast.push(e.message || '导出失败', 'error');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: '#E8E4DB', display: 'flex', flexDirection: 'column' }}>
      {/* —— 顶部操作条 —— */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.625rem 1.25rem',
        background: 'var(--paper, #F8F5EE)', borderBottom: '1px solid var(--rule-soft)',
      }}>
        <button onClick={onClose} className="btn btn--ghost" style={{ fontSize: '0.8125rem' }}>← 返回</button>
        <span className="kicker" style={{ fontSize: '0.6875rem' }}>
          公众号预览 · 第 {chapterIndex} 话《{chapter.title}》 · 共 {allPanels.length} 格（已生成 {donePanels.length}）
        </span>
        <span style={{ flex: 1 }} />
        <button onClick={() => setEditOpen(v => !v)} className="btn btn--ghost" style={{ fontSize: '0.8125rem' }}>
          {editOpen ? '收起文案编辑' : '✏️ 发布文案'}
        </button>
        <button onClick={genCopy} disabled={busy || exporting} className="btn btn--ghost" style={{ fontSize: '0.8125rem' }}>
          {busy ? '生成中…' : '✨ AI 生成发布文案'}
        </button>
        <button
          onClick={exportStrip}
          disabled={busy || exporting || donePanels.length === 0}
          title={donePanels.length === 0 ? '本话还没有已生成的分镜图，无法导出' : undefined}
          className="btn btn--primary"
          style={{ fontSize: '0.8125rem' }}
        >
          {exporting ? '导出中…' : '导出本话长图 ▸'}
        </button>
      </div>

      {/* —— 发布文案编辑 —— */}
      {editOpen && (
        <div style={{ padding: '0.75rem 1.25rem', background: '#EFEAE0', borderBottom: '1px solid var(--rule-soft)', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <label className="field-label" style={{ marginBottom: 0 }}>话头副题</label>
          <input className="field-input" value={draftTagline} onChange={e => setDraftTagline(e.target.value)} placeholder="一句话点题本话（20-40 字）" />
          <label className="field-label" style={{ marginBottom: 0 }}>结尾金句</label>
          <input className="field-input" value={draftQuote} onChange={e => setDraftQuote(e.target.value)} placeholder="整话收尾的大字强调句（15-35 字）" />
          <label className="field-label" style={{ marginBottom: 0 }}>下话预告</label>
          <textarea className="field-input" rows={2} value={draftPreview} onChange={e => setDraftPreview(e.target.value)} placeholder="2-3 句悬念文案" style={{ resize: 'vertical' }} />
          <div>
            <button onClick={saveCopy} disabled={busy} className="btn btn--primary" style={{ fontSize: '0.8125rem' }}>
              {busy ? '保存中…' : '保存文案'}
            </button>
          </div>
        </div>
      )}

      {/* —— 公众号文章正文（模拟） —— */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem 1rem 3rem' }}>
        <div style={{ maxWidth: 560, margin: '0 auto', background: '#fff', border: '1px solid var(--rule-soft)', padding: '2rem 1.375rem 2.5rem' }}>
          {/* 话头 */}
          <div className="kicker" style={{ fontSize: '0.6875rem', letterSpacing: '0.3em', color: INK_2, textAlign: 'center' }}>
            《{series.title}》 · 第 {chapterIndex} 话
          </div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', fontWeight: 700, color: INK, textAlign: 'center', margin: '0.625rem 0 0.5rem' }}>
            第 {chapterIndex} 话《{chapter.title}》
          </h1>
          {chapter.tagline && (
            <p style={{ fontSize: '0.875rem', color: INK_2, textAlign: 'center', lineHeight: 1.7, margin: '0 0 0.75rem' }}>
              {chapter.tagline}
            </p>
          )}
          <hr style={{ border: 'none', borderTop: `1px solid ${RULE}`, margin: '1rem 0 1.75rem' }} />

          {/* 全部格 */}
          {allPanels.map((pn, i) => {
            const { speaker, body } = splitSpeaker(pn.dialogue || '', pn.characterIds?.map(nameOf).find(Boolean));
            return (
              <div key={`${pn.id ?? i}-${i}`} style={{ marginBottom: '1.625rem' }}>
                {pn.imageUrl ? (
                  <img src={pn.imageUrl} alt="" style={{ width: '100%', display: 'block', border: '1px solid var(--rule-soft)' }} />
                ) : (
                  <div style={{ width: '100%', aspectRatio: '3 / 4', border: `1px dashed ${RULE}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: INK_2, fontSize: '0.75rem', background: PAPER }}>
                    待生成
                  </div>
                )}
                {pn.narration && (
                  <div style={{
                    marginTop: '0.625rem', padding: '0.5rem 0.875rem',
                    background: '#FAF7EE', borderLeft: '3px solid #B59A6F',
                    color: '#4B4636', fontSize: '0.8125rem', lineHeight: 1.75,
                    textAlign: 'justify', borderRadius: '2px',
                    fontFamily: 'Georgia, "Noto Serif SC", serif',
                  }}>
                    {pn.narration}
                  </div>
                )}
                {pn.innerThought && (
                  <div style={{
                    marginTop: '0.5rem', padding: '0.375rem 0.875rem', paddingLeft: '1.5rem',
                    color: '#6B6453', fontStyle: 'italic', fontSize: '0.8125rem',
                    lineHeight: 1.75, textAlign: 'justify',
                    fontFamily: 'Georgia, "Noto Serif SC", serif',
                  }}>
                    💭 {pn.innerThought}
                  </div>
                )}
                {body && (
                  <p style={{ fontSize: '0.875rem', lineHeight: 1.8, color: INK_2, margin: '0.625rem 0.25rem 0', fontFamily: 'Georgia, "Noto Serif SC", serif' }}>
                    {speaker && <span style={{ color: ACCENT, fontWeight: 600 }}>{speaker}：</span>}
                    {body}
                  </p>
                )}
                {i < allPanels.length - 1 && (
                  <hr style={{ border: 'none', borderTop: `1px dashed ${DASH}`, margin: '1.375rem 0 0' }} />
                )}
              </div>
            );
          })}

          {/* 金句 */}
          {chapter.endingQuote && (
            <p style={{
              fontFamily: 'Georgia, "Noto Serif SC", serif', fontSize: '1.125rem', fontWeight: 700,
              color: ACCENT, textAlign: 'center', lineHeight: 1.9, margin: '2.25rem 0.5rem 1.75rem',
            }}>
              {chapter.endingQuote}
            </p>
          )}

          {/* 下话预告 */}
          {chapter.nextPreview && (
            <div style={{ border: `1px dashed ${DASH}`, padding: '1rem 1.125rem', marginBottom: '1.75rem' }}>
              <div style={{ fontSize: '0.75rem', color: ACCENT, marginBottom: '0.375rem' }}>下话预告</div>
              <p style={{ fontSize: '0.875rem', lineHeight: 1.8, color: INK_2, margin: 0, whiteSpace: 'pre-wrap' }}>
                {chapter.nextPreview}
              </p>
            </div>
          )}

          {/* 页脚 */}
          <div style={{ textAlign: 'center', fontSize: '0.75rem', color: INK_2, lineHeight: 2 }}>
            {prevChapterTitle && <div>上一话《{prevChapterTitle}》</div>}
            <div style={{ color: DASH }}>{series.title} · 第 {chapterIndex} 话 · {isLast ? '全篇完' : '未完待续'}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export { EpisodePreview };
