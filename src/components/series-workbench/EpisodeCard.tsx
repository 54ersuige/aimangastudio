import { useState, useEffect } from 'react';
import type { Series, Chapter, SeriesPage } from '../../types';
import { RedoAltIcon, ChevronRightIcon, ChevronLeftIcon, ChevronDownIcon, ChevronUpIcon, EyeIcon } from '../icons';
import { extractReadableText } from './text';
import { Spinner, GeneratingPanelPlaceholder } from './ui';

/**
 * 话级分镜卡 —— 最小创作 / 发布单位是「话」。
 *
 * - 整话所有格跨「内部生成批次」（page，仅内部概念，UI 不再暴露"页"）按顺序合并展示，格号整话连续。
 * - 每格可独立操作：生成/重掷此格、AI 改写此格、手改文字。
 * - 批次级操作（手动编辑 / 重拆 / 重画 / 整批改写）挂在批次分隔条上，作为高级修正入口。
 */
/** 每批固定 6 格。与后端 chapter-capacity.ts 的 PANELS_PER_BATCH 对齐。 */
const PANELS_PER_BATCH = 6;
/** 每话目标格数区间（与后端一致）。 */
const PANELS_PER_EPISODE_MIN = 12;
const PANELS_PER_EPISODE_MAX = 18;

function EpisodeCard(props: {  series: Series;
  chapter: Chapter;
  /** 全局话号（1 起，跨章连续） */
  episodeIndex: number;
  episodeCount: number;
  onPrev: () => void;
  onNext: () => void;
  busy: boolean;
  /**
   * 进行中出图任务的进度 0-100（2026-10-15 新增）。
   * 后端按"已完成格数 / 总格数"上报。此前这里只有一个布尔 busy，
   * 用户点下去后只能看着一个不动的"生成中…"，完全不知道跑到哪儿了。
   */
  taskProgress?: number | null;
  // —— 批次级（内部生成批次） ——
  onBreakdownBatch: (pageId: string) => Promise<void>;
  onGenerateBatch: (pageId: string) => Promise<void>;
  onRegenerateBatch: (pageId: string) => Promise<void>;
  onRewriteBatch: (pageId: string, instruction: string) => Promise<void>;
  onEditBatch: (page: SeriesPage) => void;
  // —— 话级 ——
    onGenerateAllMissing: () => Promise<void>;
  onContinue: () => Promise<void>;
  /** 2026-10-16：本话已拆解完时，「进入下一话」。此前该状态下按钮仍是
   *  「续写本话」，而它会去填**下一话**的第一批 —— 名实不符且用户无从察觉。 */
  onNextEpisode: () => void;
  /** 2026-10-16：重新规划本话（推倒重写 summary，使其撑满规划容量且有张力）。 */
  onReplan: (chapterId: string) => Promise<void>;
  onPreview: () => void;
  // —— 格级 ——
  onGeneratePanel: (pageId: string, panelIndex: number) => Promise<void>;
  onRewritePanel: (pageId: string, panelIndex: number, instruction: string) => Promise<void>;
  /** 2026-09-03：兼容性保留（仅改 dialogue）。新接口 onUpdatePanelText 接管三合一。 */
  onUpdatePanelText: (pageId: string, panelIndex: number, dialogue: string) => Promise<void>;
  /** 2026-09-03：三合一改写 —— dialogue / narration / innerThought 任选其一或多个。 */
  onUpdatePanelTextV2: (pageId: string, panelIndex: number, text: { dialogue?: string; narration?: string; innerThought?: string }) => Promise<void>;
  /** 2026-09-03：让 AI 仅重写一格的"图下文字"（不动 description、不重出图）。 */
  onRewritePanelText: (pageId: string, panelIndex: number, instruction: string) => Promise<void>;
}) {
  const {
    series, chapter, episodeIndex, episodeCount, onPrev, onNext, busy, taskProgress,
    onBreakdownBatch, onGenerateBatch, onRegenerateBatch, onRewriteBatch, onEditBatch,
    onGenerateAllMissing, onContinue, onNextEpisode, onReplan, onPreview,
    onGeneratePanel, onRewritePanel, onUpdatePanelText, onUpdatePanelTextV2, onRewritePanelText,
  } = props;

  /**
   * 忙碌时的按钮文案。有真实进度就报百分比，没有就退回旧的通用文案。
   * 进度只在出图类任务上报（角色/章节生成不报），所以 null 时不能显示 0%。
   */
  const busyText = (fallback: string) =>
    busy ? (taskProgress != null ? `${fallback} ${taskProgress}%` : fallback) : '';

  // —— 重拆确认（两步，防误触；4 秒未确认自动复位） ——
  const [confirmRebreakPage, setConfirmRebreakPage] = useState<string | null>(null);
  useEffect(() => {
    if (!confirmRebreakPage) return;
    const t = setTimeout(() => setConfirmRebreakPage(null), 4000);
    return () => clearTimeout(t);
  }, [confirmRebreakPage]);

  // —— 整批改写折叠 ——
  const [batchRewriteOpen, setBatchRewriteOpen] = useState<string | null>(null);
  const [batchRewriteDraft, setBatchRewriteDraft] = useState('');

  // —— 重新规划两步确认（会推倒重写 summary，4 秒未确认自动复位） ——
  const [replanArmed, setReplanArmed] = useState(false);
  const [replanBusy, setReplanBusy] = useState(false);
  useEffect(() => {
    if (!replanArmed) return;
    const t = setTimeout(() => setReplanArmed(false), 5000);
    return () => clearTimeout(t);
  }, [replanArmed]);

  // —— 单格改写折叠 ——
  const [panelRewriteTarget, setPanelRewriteTarget] = useState<{ pageId: string; index: number } | null>(null);
  const [panelRewriteDraft, setPanelRewriteDraft] = useState('');

  // —— 单格改文字折叠 ——
  // 2026-09-03：扩成"三栏"（对白 / 叙述 / 内心独白），保留旧字段以向后兼容。
  const [panelTextTarget, setPanelTextTarget] = useState<{ pageId: string; index: number } | null>(null);
  const [panelTextDraftDlg, setPanelTextDraftDlg] = useState('');
  const [panelTextDraftNar, setPanelTextDraftNar] = useState('');
  const [panelTextDraftInner, setPanelTextDraftInner] = useState('');
  // 「仅让 AI 改文字」指令输入框
  const [panelTextRewriteDraft, setPanelTextRewriteDraft] = useState('');
  useEffect(() => {
    if (!panelTextTarget) return;
    const pg = chapter.pages.find(x => x.id === panelTextTarget.pageId);
    const pn = pg?.panels.find(x => x.index === panelTextTarget.index);
    if (pn) {
      setPanelTextDraftDlg(pn.dialogue || '');
      setPanelTextDraftNar(pn.narration || '');
      setPanelTextDraftInner(pn.innerThought || '');
    }
    setPanelTextRewriteDraft('');
  }, [panelTextTarget, chapter.pages]);

  // —— 本地单格生成指示（后端不整页置 generating，前端自己标） ——
  const [panelBusy, setPanelBusy] = useState<{ pageId: string; index: number } | null>(null);

  const pagesSorted = [...chapter.pages].sort((a, b) => a.pageNumber - b.pageNumber);
  /** 规划容量：规划时就定死的总格数（pageCount × 6），与填了多少无关。 */
  const capacity = chapter.pageCount * PANELS_PER_BATCH;
  /** 已拆解的格数（已填进分镜的）。 */
  const filledPanels = pagesSorted.reduce((n, p) => n + p.panels.length, 0);
  /** 已拆解的批次数。 */
  const filledBatches = pagesSorted.filter(p => p.panels.length > 0).length;
  const totalPanels = filledPanels;
  const doneCount = pagesSorted.reduce((n, p) => n + p.panels.filter(pn => !!pn.imageUrl).length, 0);
  const missing = totalPanels - doneCount;
  /** 本话规划里还空着的批次数。 */
  const emptyBatches = pagesSorted.length - filledBatches;
  const lastPage = pagesSorted[pagesSorted.length - 1];

  const handleGeneratePanel = async (pageId: string, index: number) => {
    setPanelBusy({ pageId, index });
    try {
      await props.onGeneratePanel(pageId, index);
    } finally {
      setPanelBusy(null);
    }
  };

  return (
    <div>
      {/* —— 话头 —— */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
        <button onClick={onPrev} disabled={episodeIndex <= 1} className="iconbtn" style={{ border: '1px solid var(--rule-soft)' }}>
          <ChevronLeftIcon className="w-4 h-4" />
        </button>
        <h3 className="headline headline--lg" style={{ flex: 1 }}>
          第 {episodeIndex} 话《{chapter.title}》
        </h3>
        <span className="mono tnum" style={{ fontSize: '0.75rem', color: 'var(--ink-3)' }}>
          第 {episodeIndex} / {episodeCount} 话
        </span>
        <button onClick={onNext} disabled={episodeIndex >= episodeCount} className="iconbtn" style={{ border: '1px solid var(--rule-soft)' }}>
          <ChevronRightIcon className="w-4 h-4" />
        </button>
      </div>
      {chapter.summary && (
        <p className="deck" style={{ marginBottom: '0.75rem' }}>{chapter.summary}</p>
      )}

      {/* —— 进度：规划容量 vs 已拆解 vs 已出图，三者分开显示 —— */}
      <div className="kicker" style={{ marginBottom: '0.25rem' }}>
        规划 {pagesSorted.length} 批 / {capacity} 格
        <span style={{ margin: '0 0.4rem', opacity: 0.5 }}>·</span>
        已拆解 {filledBatches} 批 / {filledPanels} 格
        <span style={{ margin: '0 0.4rem', opacity: 0.5 }}>·</span>
        已出图 {doneCount} 格{missing > 0 ? `（缺 ${missing} 格）` : ''}
      </div>
      {pagesSorted.length > 0 && (
        <div style={{ fontSize: '0.6875rem', marginBottom: '0.75rem', color: 'var(--ink-3)', lineHeight: 1.5 }}>
          {/*
            2026-10-15 重写。
            原文案是「本话规划 N 批（totalPanels 格），低于每话目标 12-18 格 —— 剧情没讲完就点续写」，
            而 totalPanels 是**已填**格数，不是规划容量：
            规划 18 格、填了 6 格时，它显示成「规划 3 批（6 格），低于目标，要续写」——
            把「还没填」误报成「不够」，把用户往硬编内容的坑里推。
            现在：容量/已填/出图分开，缺批次就是"还有几批没拆"，不再喊"剧情没讲完"。
          */}
          {emptyBatches > 0 ? (
            <>本话规划 {capacity} 格，还有 <strong style={{ color: 'var(--accent)' }}>{emptyBatches} 批（{emptyBatches * PANELS_PER_BATCH} 格）没拆解</strong> —— 按计划拆完这一话就完整了。</>
          ) : (
            <>本话规划 {capacity} 格已全部拆解完成{capacity > PANELS_PER_EPISODE_MAX ? `（超出每话 ${PANELS_PER_EPISODE_MIN}-${PANELS_PER_EPISODE_MAX} 格目标，注意单条长图过长会影响完读率）` : `（每话目标 ${PANELS_PER_EPISODE_MIN}-${PANELS_PER_EPISODE_MAX} 格）`}。</>
          )}
        </div>
      )}

      {/* —— 话级主操作 —— */}
      {/*
        2026-10-15 统一按钮语义。此前同一个后端动作在不同状态下叫三种名字：
        「拆解分镜」/「续写本话」/「续写本话（追加一批）」，而"本话全满时"那个
        还会偷偷去写下一话的第一批。现在按"本话还有几个空批次"给准确文案。
      */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem', alignItems: 'center', flexWrap: 'wrap' }}>
        {filledBatches === 0 ? (
          <button
            onClick={() => pagesSorted[0] && onBreakdownBatch(pagesSorted[0].id)}
            disabled={busy || pagesSorted.length === 0}
            title={pagesSorted.length === 0 ? '本话还没有生成批次，请先在上方生成本话' : `拆解本话第 1 批（每批 ${PANELS_PER_BATCH} 格，保证前后文一致）`}
            className="btn btn--primary"
          >
            {busy ? '拆解中…' : `① 拆解第 1 批（${PANELS_PER_BATCH} 格）▸`}
          </button>
        ) : missing > 0 ? (
          <button onClick={onGenerateAllMissing} disabled={busy} className="btn btn--primary" title="逐批增量补齐缺图，已有图的格不会重画">
            {busy ? busyText('生成中') : `② 生成本话缺图（${missing} 格）▸`}
          </button>
        ) : emptyBatches > 0 ? (
          <button
            onClick={onContinue}
            disabled={busy}
            className="btn btn--primary"
            title={`按规划继续拆解本话下一批（还剩 ${emptyBatches} 批，共 ${emptyBatches * PANELS_PER_BATCH} 格没拆）`}
          >
            {busy ? '拆解中…' : `③ 拆解下一批（还剩 ${emptyBatches} 批）▸`}
          </button>
        ) : null}
        {filledBatches > 0 && missing > 0 && emptyBatches > 0 && (
          <button
            onClick={onContinue}
            disabled={busy}
            title={`按规划继续拆解本话下一批（还剩 ${emptyBatches} 批），不打断已有格`}
            className="btn btn--ghost"
          >
            拆解下一批（还剩 {emptyBatches} 批）
          </button>
        )}
        {emptyBatches === 0 && filledBatches > 0 && (
          <span className="kicker" style={{ fontSize: '0.6875rem', color: 'var(--ink-3)' }}>
            本话 {capacity} 格已全部拆解 ·{' '}
            <button
              type="button"
              onClick={onNextEpisode}
              className="btn btn--link"
              style={{ fontSize: '0.6875rem', padding: 0 }}
              title="进入下一话"
            >
              进入下一话 ▸
            </button>
          </span>
        )}
        <span style={{ flex: 1 }} />
        {/*
          2026-10-16 新增「重新规划本话」。
          之前三个生成入口全是"新建"，用户唯一能对已有话做的事是手动改字 ——
          但"这一话太平了，给我一版有张力的"恰恰是最常出现的诉求。
          两步确认：会推倒重写 summary，且已有分镜图会与新剧情对不上。
        */}
        <button
          onClick={async () => {
            if (replanArmed) {
              setReplanArmed(false);
              setReplanBusy(true);
              try { await onReplan(chapter.id); } finally { setReplanBusy(false); }
            } else {
              setReplanArmed(true);
            }
          }}
          disabled={busy}
          className="btn btn--ghost"
          style={{ fontSize: '0.75rem', color: replanArmed ? 'var(--danger)' : undefined }}
          title="推倒重写本话剧情概要，使其撑满规划容量并具备戏剧张力；已有分镜图需要重新拆解才会与新剧情对上"
        >
          {busy && replanBusy ? '重新规划中…' : replanArmed ? '确认重新规划？（旧分镜需重拆）' : '重新规划本话'}
        </button>
        <button onClick={onPreview} className="btn btn--ghost" style={{ color: 'var(--accent)' }}>公众号预览 ▸</button>
      </div>

      {chapter.pages.some(p => p.errorMessage) && (
        <div style={{ padding: '0.5rem 0.75rem', background: '#FBE9E4', color: 'var(--danger)', fontSize: '0.8125rem', marginBottom: '1rem' }}>
          {chapter.pages.find(p => p.errorMessage)?.errorMessage}
        </div>
      )}

      {/* 2026-10-20：提示（不是错误）—— 比如"这格描述太短，建议你补充"。
          系统不再替用户改写分镜，改由用户自己决定要不要动稿。 */}
      {chapter.pages.some(p => p.hint) && (
        <div style={{ padding: '0.5rem 0.75rem', background: 'var(--bg-soft)', color: 'var(--ink-2)', fontSize: '0.8125rem', marginBottom: '1rem', borderLeft: '3px solid var(--accent)' }}>
          {chapter.pages.filter(p => p.hint).map(p => p.hint).join('；')}
        </div>
      )}

      {/* —— 整话没有分镜 —— */}
      {totalPanels === 0 && (
        <div style={{
          padding: '3rem 1rem', textAlign: 'center',
          border: '1px dashed var(--rule-soft)', color: 'var(--ink-3)',
        }}>
          <EyeIcon className="w-10 h-10 mx-auto mb-2" style={{ opacity: 0.4 }} />
          <div style={{ fontWeight: 600, color: 'var(--ink-2)' }}>本话还没拆解分镜</div>
          <div style={{ fontSize: '0.8125rem', marginTop: '0.25rem' }}>本话已规划 {pagesSorted.length} 批；点上方「① 拆解分镜」从第一批开始（每次拆一批 6 格）</div>
        </div>
      )}

      {/* —— 批次 × 格 —— */}
      {pagesSorted.map((pg, pi) => {
        if (pg.panels.length === 0) return null;
        const offset = pagesSorted.slice(0, pi).reduce((n, x) => n + x.panels.length, 0);
        const pgFailed = pg.status === 'error';
        const pgGenerating = pg.status === 'generating';
        const pgDone = pg.status === 'done';
        return (
          <div key={pg.id} style={{ marginBottom: '1.5rem' }}>
            {/* —— 批次分隔条 —— */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', marginBottom: '0.625rem', paddingTop: pi > 0 ? '0.75rem' : 0, borderTop: pi > 0 ? '1px solid var(--rule-soft)' : 'none', flexWrap: 'wrap' }}>
              <span className="kicker" style={{ fontSize: '0.625rem' }}>
                第 {offset + 1}–{offset + pg.panels.length} 格（第 {pi + 1} 批）
              </span>
              {(pgGenerating || pgFailed) && (
                <span style={{ fontSize: '0.6875rem', color: pgFailed ? '#B0413E' : 'var(--ink-2)', display: 'inline-flex', alignItems: 'center', gap: '0.375rem' }}>
                  {pgGenerating && <Spinner small />}
                  {pgGenerating ? (taskProgress != null ? `生成中 ${taskProgress}%` : '生成中') : '已中断'}
                </span>
              )}
              <span style={{ flex: 1 }} />
              <button onClick={() => onEditBatch(pg)} className="btn btn--ghost" style={{ fontSize: '0.6875rem' }}>✏️ 手动编辑</button>
              {pgGenerating ? null : (
                <>
                  <button
                    onClick={() => {
                      if (pg.panels.some(pn => pn.imageUrl) && confirmRebreakPage !== pg.id) { setConfirmRebreakPage(pg.id); return; }
                      setConfirmRebreakPage(null);
                      void onBreakdownBatch(pg.id);
                    }}
                    disabled={busy}
                    title="重新设计此批分镜（旧分镜与旧图作废）"
                    className="btn btn--ghost"
                    style={{ fontSize: '0.6875rem', color: confirmRebreakPage === pg.id ? 'var(--danger)' : undefined }}
                  >
                    {confirmRebreakPage === pg.id ? '确认重拆？旧图将作废' : '↻ 重拆此批'}
                  </button>
                  {pg.panels.some(pn => pn.imageUrl) && (
                    <button onClick={() => onRegenerateBatch(pg.id)} disabled={busy} title="此批全部格整批重画" className="btn btn--ghost" style={{ fontSize: '0.6875rem' }}>
                      <RedoAltIcon className="w-3 h-3" />重画此批
                    </button>
                  )}
                  {pgDone && (
                    <button
                      onClick={() => { setBatchRewriteOpen(batchRewriteOpen === pg.id ? null : pg.id); setBatchRewriteDraft(''); }}
                      className="btn btn--link" style={{ fontSize: '0.6875rem', padding: 0 }}
                    >
                      用一句话改此批 {batchRewriteOpen === pg.id ? <ChevronUpIcon className="w-3 h-3" /> : <ChevronDownIcon className="w-3 h-3" />}
                    </button>
                  )}
                </>
              )}
            </div>

            {/* —— 整批改写输入 —— */}
            {batchRewriteOpen === pg.id && (
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
                <input
                  className="field-input"
                  value={batchRewriteDraft}
                  onChange={e => setBatchRewriteDraft(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && batchRewriteDraft.trim()) {
                      void onRewriteBatch(pg.id, batchRewriteDraft).then(() => setBatchRewriteOpen(null));
                    }
                  }}
                  placeholder="例如：把场景改成夜晚 / 主角今天穿红裙子（此批会整批重画）"
                  style={{ flex: 1 }}
                />
                <button
                  onClick={() => { void onRewriteBatch(pg.id, batchRewriteDraft).then(() => setBatchRewriteOpen(null)); }}
                  disabled={busy || !batchRewriteDraft.trim()}
                  className="btn btn--primary" style={{ fontSize: '0.75rem' }}
                >
                  {busy ? '改写中…' : '应用'}
                </button>
              </div>
            )}

            {/* —— 格网格 —— */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(11rem, 1fr))', gap: '0.75rem' }}>
              {[...pg.panels].sort((a, b) => a.index - b.index).map(panel => {
                const panelHasImg = !!panel.imageUrl;
                const thisBusy = panelBusy?.pageId === pg.id && panelBusy.index === panel.index;
                let panelState: 'done' | 'generating' | 'error' | 'draft';
                if (thisBusy) panelState = 'generating';
                else if (panelHasImg) panelState = 'done';
                else if (pgFailed) panelState = 'error';
                else if (pgGenerating) panelState = 'generating';
                else panelState = 'draft';
                const dlg = (panel.dialogue || '').trim();
                return (
                  <div key={panel.index} className="card" style={{ overflow: 'hidden', padding: 0, position: 'relative' }}>
                    <div className="panel-thumb" style={{ aspectRatio: '3 / 4', position: 'relative' }}>
                      {panelHasImg ? (
                        <img src={panel.imageUrl} alt="" />
                      ) : panelState === 'generating' ? (
                        <GeneratingPanelPlaceholder description={panel.description} />
                      ) : (
                        <span style={{ fontSize: '0.625rem', textAlign: 'center', padding: '0.5rem', color: panelState === 'error' ? '#B0413E' : 'var(--ink-3)' }}>
                          {extractReadableText(panel.description) || '待生成'}
                        </span>
                      )}
                      <div style={{ position: 'absolute', right: '0.25rem', bottom: '0.25rem', background: panelState === 'done' ? '#2F7D32' : panelState === 'error' ? '#B0413E' : panelState === 'generating' ? '#1B1A17' : 'rgba(255,255,255,0.85)', color: panelState === 'draft' ? '#5B5547' : '#FAF7EE', fontSize: '0.625rem', padding: '0.125rem 0.375rem', borderRadius: '3px', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                        {panelState === 'done' && '✓ 已生成'}
                        {panelState === 'generating' && <><Spinner /> 生成中</>}
                        {panelState === 'error' && '⚠ 出错'}
                        {panelState === 'draft' && '草稿'}
                      </div>
                      {/*
                        2026-10-16：整批重画时，个别格失败会保留它原来的旧图（宁可留旧图也不要留空洞）。
                        但这样「6 格齐全」就是假象 —— 用户以为自己也看过新版了。
                        所以显式标出来，并说明为什么没更新。
                      */}
                      {panel.stale && panelHasImg && (
                        <div
                          title={panel.staleReason ? `本轮出图失败，这张是上次留下的旧图：${panel.staleReason}` : '这张是上次留下的旧图'}
                          style={{ position: 'absolute', left: '0.25rem', top: '0.25rem', background: '#B0413E', color: '#FAF7EE', fontSize: '0.625rem', padding: '0.125rem 0.375rem', borderRadius: '3px', fontWeight: 600 }}
                        >
                          旧图
                        </div>
                      )}
                    </div>
                    <div style={{ padding: '0.5rem 0.625rem' }}>
                      <div className="kicker" style={{ fontSize: '0.5625rem' }}>第 {offset + panel.index} 格</div>
                      {/* —— 2026-09-03：图下文字三层 = 叙述（narration）→ 内心独白（innerThought）→ 对白（dialogue）。
                           视觉权重从大到小：叙述（带底色）> 内心独白（缩进+斜体）> 对白（小左竖线）。 */}
                      {panel.narration && (
                        <div style={{
                          marginTop: '0.4rem',
                          padding: '6px 10px',
                          background: 'rgba(181, 154, 111, 0.10)',
                          borderLeft: '3px solid #B59A6F',
                          borderRadius: '2px',
                          fontSize: '0.6875rem',
                          fontWeight: 500,
                          color: 'var(--ink-1)',
                          lineHeight: 1.55,
                        }}>
                          {panel.narration}
                        </div>
                      )}
                      {panel.innerThought && (
                        <div style={{
                          marginTop: '0.3rem',
                          padding: '4px 10px 4px 16px',
                          fontSize: '0.6875rem',
                          fontStyle: 'italic',
                          color: 'var(--ink-2)',
                          lineHeight: 1.55,
                          borderLeft: '2px solid var(--ink-3)',
                        }}>
                          💭 {panel.innerThought}
                        </div>
                      )}
                      {(() => {
                        if (!dlg) return null;
                        const hasBrackets = /^[\s\u4e00-\u9fff]{1,8}[：:]/.test(dlg);
                        const alreadyWrapped = /^[「『"]/.test(dlg) && /[」』"]$/.test(dlg);
                        const speakerName = (panel.characterIds ?? []).map(id => series.characters.find(c => c.id === id)?.name).find(Boolean) || '';
                        if (hasBrackets || alreadyWrapped) {
                          const wrapped = alreadyWrapped ? dlg : `「${speakerName ? speakerName + '：' : ''}${dlg}」`;
                          return (
                            <div style={{
                              fontSize: '0.6875rem',
                              fontStyle: 'italic',
                              color: 'var(--ink-1)',
                              marginTop: '0.3rem',
                              lineHeight: 1.45,
                              paddingLeft: '0.5rem',
                              borderLeft: '2px solid var(--accent)',
                            }}>
                              {wrapped}
                            </div>
                          );
                        }
                        return (
                          <div style={{ fontSize: '0.6875rem', color: 'var(--ink-3)', marginTop: '0.25rem', lineHeight: 1.5 }}>
                            {dlg}
                          </div>
                        );
                      })()}
                      {/* —— 格级操作 —— */}
                      {pgGenerating ? null : (
                        <>
                          <button
                            onClick={() => handleGeneratePanel(pg.id, panel.index)}
                            disabled={busy || !!panelBusy}
                            title={panelHasImg ? '用当前描述重出这一格（换一张）' : '只生成这一格的图'}
                            className="btn btn--link"
                            style={{ fontSize: '0.6875rem', padding: 0, marginTop: '0.375rem' }}
                          >
                            {thisBusy ? '生成中…' : panelHasImg ? '⟳ 重出此格' : '▶ 生成此格'}
                          </button>
                          <button
                            onClick={() => {
                              const open = panelRewriteTarget?.pageId === pg.id && panelRewriteTarget.index === panel.index;
                              setPanelRewriteTarget(open ? null : { pageId: pg.id, index: panel.index });
                              setPanelRewriteDraft('');
                            }}
                            className="btn btn--link"
                            style={{ fontSize: '0.6875rem', padding: 0, marginTop: '0.375rem', marginLeft: '0.625rem' }}
                          >
                            改这一格 {panelRewriteTarget?.pageId === pg.id && panelRewriteTarget.index === panel.index ? <ChevronUpIcon className="w-3 h-3" /> : <ChevronDownIcon className="w-3 h-3" />}
                          </button>
                          {panelRewriteTarget?.pageId === pg.id && panelRewriteTarget.index === panel.index && (
                            <div style={{ marginTop: '0.375rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                              <input
                                className="field-input"
                                value={panelRewriteDraft}
                                onChange={e => setPanelRewriteDraft(e.target.value)}
                                onKeyDown={e => {
                                  if (e.key === 'Enter' && panelRewriteDraft.trim()) {
                                    void onRewritePanel(pg.id, panel.index, panelRewriteDraft).then(() => setPanelRewriteTarget(null));
                                  }
                                }}
                                placeholder="例如：换成特写 / 让角色微笑"
                                style={{ fontSize: '0.75rem', padding: '0.25rem 0' }}
                                autoFocus
                              />
                              <button
                                onClick={() => { void onRewritePanel(pg.id, panel.index, panelRewriteDraft).then(() => setPanelRewriteTarget(null)); }}
                                disabled={busy || !panelRewriteDraft.trim()}
                                className="btn btn--primary" style={{ fontSize: '0.6875rem', padding: '0.25rem 0.625rem' }}
                              >
                                {busy ? '生成中…' : '应用'}
                              </button>
                            </div>
                          )}
                          <button
                            onClick={() => {
                              const open = panelTextTarget?.pageId === pg.id && panelTextTarget.index === panel.index;
                              setPanelTextTarget(open ? null : { pageId: pg.id, index: panel.index });
                            }}
                            className="btn btn--link"
                            style={{ fontSize: '0.6875rem', padding: 0, marginTop: '0.25rem', display: 'block' }}
                          >
                            ✏️ 改文字 {panelTextTarget?.pageId === pg.id && panelTextTarget.index === panel.index ? <ChevronUpIcon className="w-3 h-3" /> : <ChevronDownIcon className="w-3 h-3" />}
                          </button>
                          {panelTextTarget?.pageId === pg.id && panelTextTarget.index === panel.index && (
                            <div style={{ marginTop: '0.375rem', display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                              {/* —— 2026-09-03：图下方文字三栏（叙述 / 内心独白 / 对白），分别编辑 —— */}
                              <div>
                                <div style={{ fontSize: '0.625rem', color: 'var(--ink-3)', marginBottom: '0.125rem' }}>
                                  📖 叙述（上帝视角 / 场景交代）
                                </div>
                                <textarea
                                  className="field-input"
                                  value={panelTextDraftNar}
                                  onChange={e => setPanelTextDraftNar(e.target.value)}
                                  rows={2}
                                  placeholder="20-80 字 · 解释在发生什么/为什么/将发生什么"
                                  style={{ fontSize: '0.75rem', padding: '0.25rem 0', resize: 'vertical' }}
                                />
                              </div>
                              <div>
                                <div style={{ fontSize: '0.625rem', color: 'var(--ink-3)', marginBottom: '0.125rem' }}>
                                  💭 内心独白（主角心里的声音）
                                </div>
                                <textarea
                                  className="field-input"
                                  value={panelTextDraftInner}
                                  onChange={e => setPanelTextDraftInner(e.target.value)}
                                  rows={2}
                                  placeholder="0-50 字 · 选择/迷茫/觉醒的瞬间"
                                  style={{ fontSize: '0.75rem', padding: '0.25rem 0', resize: 'vertical' }}
                                />
                              </div>
                              <div>
                                <div style={{ fontSize: '0.625rem', color: 'var(--ink-3)', marginBottom: '0.125rem' }}>
                                  💬 对白（角色嘴里说出的话）
                                </div>
                                <textarea
                                  className="field-input"
                                  value={panelTextDraftDlg}
                                  onChange={e => setPanelTextDraftDlg(e.target.value)}
                                  rows={2}
                                  placeholder="≤30 字 · 开头像「角色：...」会被识别为对话"
                                  style={{ fontSize: '0.75rem', padding: '0.25rem 0', resize: 'vertical' }}
                                />
                              </div>
                              {/* —— AI 重写区（不重出图，只重写文字） —— */}
                              <div style={{ borderTop: '1px dashed var(--rule-soft)', paddingTop: '0.375rem' }}>
                                <div style={{ fontSize: '0.625rem', color: 'var(--ink-3)', lineHeight: 1.4, marginBottom: '0.25rem' }}>
                                  🪄 让 AI 重写文字（不重画图）：
                                </div>
                                <textarea
                                  className="field-input"
                                  value={panelTextRewriteDraft}
                                  onChange={e => setPanelTextRewriteDraft(e.target.value)}
                                  rows={2}
                                  placeholder="如「加一段上帝叙述说明这是周一早上」「把对白改得更口语」「加点主角内心独白」"
                                  style={{ fontSize: '0.75rem', padding: '0.25rem 0', resize: 'vertical' }}
                                />
                                <button
                                  onClick={() => { void onRewritePanelText(pg.id, panel.index, panelTextRewriteDraft).then(() => setPanelTextTarget(null)); }}
                                  disabled={busy || !panelTextRewriteDraft.trim()}
                                  className="btn btn--primary"
                                  style={{ fontSize: '0.6875rem', padding: '0.25rem 0.625rem', marginTop: '0.25rem' }}
                                >
                                  {busy ? '生成中…' : '🪄 AI 重写文字'}
                                </button>
                              </div>

                              <div style={{ display: 'flex', gap: '0.25rem' }}>
                                <button
                                  onClick={() => {
                                    // 2026-09-03：三合一保存 —— 只把"用户实际改过"的字段传上去。
                                    // 后端把空串视作主动清空（存 undefined，前端不渲染空块）；
                                    // 缺省（key 不存在）则保留原值不动。这样既保留兼容旧 UI（只改对白），
                                    // 又能正确识别"用户主动删空"。
                                    const origDlg = panel.dialogue || '';
                                    const origNar = panel.narration || '';
                                    const origInner = panel.innerThought || '';
                                    const next: { dialogue?: string; narration?: string; innerThought?: string } = {};
                                    if (panelTextDraftDlg !== origDlg) next.dialogue = panelTextDraftDlg;
                                    if (panelTextDraftNar !== origNar) next.narration = panelTextDraftNar;
                                    if (panelTextDraftInner !== origInner) next.innerThought = panelTextDraftInner;
                                    // 如果用户什么也没改，就别发请求。
                                    if (Object.keys(next).length === 0) {
                                      setPanelTextTarget(null);
                                      return;
                                    }
                                    return void onUpdatePanelTextV2(pg.id, panel.index, next).then(() => setPanelTextTarget(null));
                                  }}
                                  disabled={busy}
                                  className="btn btn--primary" style={{ fontSize: '0.6875rem', padding: '0.25rem 0.625rem' }}
                                >
                                  保存文字
                                </button>
                                <button
                                  onClick={() => setPanelTextTarget(null)}
                                  className="btn btn--link" style={{ fontSize: '0.6875rem', padding: '0.25rem 0.5rem' }}
                                >
                                  取消
                                </button>
                              </div>
                            </div>
                          )}
                        </>
                      )}
                      {/* 保留未展示的原始描述兜底 */}
                      {!dlg && !panelHasImg && panelState !== 'generating' && (
                        <div style={{ fontSize: '0.625rem', color: 'var(--ink-3)', marginTop: '0.25rem', lineHeight: 1.4 }}>
                          {extractReadableText(panel.description).slice(0, 40)}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* —— 底部续写 —— */}
      {totalPanels > 0 && lastPage && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', marginTop: '0.25rem', paddingTop: '0.75rem', borderTop: '1px solid var(--rule-soft)' }}>
          <button onClick={onContinue} disabled={busy} className="btn btn--link" style={{ fontSize: '0.8125rem' }}>
            <ChevronRightIcon className="w-3.5 h-3.5" />{busy ? '续写中…' : '续写本话（追加一批）'}
          </button>
          <span className="kicker" style={{ fontSize: '0.625rem', color: 'var(--ink-3)' }}>
            基于本话已生成格 + 前文剧情追加 1 批（6 格）；每话目标 12-18 格
          </span>
        </div>
      )}
    </div>
  );
}

export { EpisodeCard };
