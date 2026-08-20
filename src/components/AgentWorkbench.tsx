import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSeries } from '../contexts/SeriesContext';
import { AgentEngine } from '../services/agentEngine';
import { exportSeriesAsStrips } from '../services/stripExport';
import { AgentChatPanel } from './AgentChatPanel';
import { SeriesWorkbench } from './SeriesWorkbench';
import type { ChatMessage, AgentStage } from '../types';
import { ConfirmDialog } from './ConfirmDialog';
import { ToastProvider, useToast } from './Toast';
import { useKeyboard } from '../hooks/useKeyboard';
import { useLocalization } from '../hooks/useLocalization';
import { Language } from '../locales/locales';
import { CogIcon } from './icons';

/**
 * 顶层布局（杂志风）：
 *   - 顶栏：刊头 + ·进度 + · ·切换 · 语言 · ·折叠 · 配置
 *   - 左：主工作台（SeriesWorkbench，已重构为纵向卡片流）
 *   - 右：创作助手（可折叠）
 */
export function AgentWorkbench(props: {
  language?: Language;
  setLanguage?: (lang: Language) => void;
  onOpenModelConfig?: () => void;
}): React.ReactElement {
  return (
    <ToastProvider>
      <AgentWorkbenchInner {...props} />
    </ToastProvider>
  );
}

function AgentWorkbenchInner(props: {
  language?: Language;
  setLanguage?: (lang: Language) => void;
  onOpenModelConfig?: () => void;
}): React.ReactElement {
  const ctx = useSeries();
  const toast = useToast();
  const { t } = useLocalization();
  const {
    currentSeries, setCurrentSeriesId,
    seriesList,
    deleteSeries: remove,
    selectedPageId, setSelectedPageId,
    regenerateSelectedPage,
    busy, clearError, error,
  } = ctx;

  // —— 引擎 ——
  const engineRef = useRef<AgentEngine | null>(null);
  if (!engineRef.current) {
    engineRef.current = new AgentEngine();
  }

  engineRef.current!.setDeps({
    getSeries: () => ctx.currentSeries,
    ensureSeries: async (input) => ctx.createSeries(input),
    patchSeries: async (p) => ctx.patchSeries(p),
    genWorldview: (hint?: string) => ctx.generateWorldviewForCurrent(hint),
    genCharacters: (hint?: string) => ctx.generateCharactersForCurrent(hint),
    genChapters: (target) => ctx.generateChaptersForCurrent(target),
    breakdownPage: async (id) => {
      await ctx.breakdownSelectedPage();
      return ctx.currentSeries?.chapters.flatMap(c => c.pages).find(p => p.id === id) || null;
    },
    generatePage: async (id) => {
      await ctx.generateSelectedPage();
      return ctx.currentSeries?.chapters.flatMap(c => c.pages).find(p => p.id === id) || null;
    },
    regeneratePage: async (id) => {
      await ctx.regenerateSelectedPage();
      return ctx.currentSeries?.chapters.flatMap(c => c.pages).find(p => p.id === id) || null;
    },
    rewritePage: async (id, instr) => {
      await ctx.rewriteSelectedPage(instr);
      return ctx.currentSeries?.chapters.flatMap(c => c.pages).find(p => p.id === id) || null;
    },
    continueNextPage: async (id) => ctx.continueFromSelectedPage(),
    deleteCharacter: async (id) => { await ctx.deleteCharacterFromCurrent(id); },
    selectPage: (id) => ctx.setSelectedPageId(id),
    getSelectedPageId: () => ctx.selectedPageId,
  });

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [stage, setStage] = useState<AgentStage>('idle');
  const [chatCollapsed, setChatCollapsed] = useState(true);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  useEffect(() => {
    const e = engineRef.current!;
    const unsub = e.subscribe(() => {
      setMessages([...e.getMessages()]);
      setStage(e.getStage());
    });
    return unsub;
  }, []);

  // 切换系列时：清空对话
  const currentSeriesId = currentSeries?.id ?? null;
  useEffect(() => {
    const e = engineRef.current!;
    e.reset();
    e.greet();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSeriesId]);

  // —— 错误转 toast ——
  useEffect(() => {
    if (error) {
      toast.push(error, 'error');
      clearError();
    }
  }, [error, toast, clearError]);

  const onReset = () => { engineRef.current!.reset(); engineRef.current!.greet(); };
  const onApprove = async () => { await engineRef.current!.approveCurrent(); };
  const onRegenerate = async () => { await engineRef.current!.regenerateCurrent(); };

  // —— 删除确认 ——
  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const id = pendingDelete;
    setPendingDelete(null);
    try {
      await remove(id);
      toast.push('已删除项目', 'success');
    } catch (e: any) {
      toast.push(e.message || '删除失败', 'error');
    }
  };

  // —— 全局快捷键 ——
  useKeyboard([
    { key: '[', action: () => gotoPage(-1), inEditable: false },
    { key: ']', action: () => gotoPage(+1), inEditable: false },
    { key: 'r', action: () => { regenerateSelectedPage().then(() => toast.push('已请求重新生成', 'default')); }, enabled: !!currentSeries && !busy },
    { key: 'escape', action: () => { if (pendingDelete) setPendingDelete(null); } },
  ]);

  function gotoPage(delta: number) {
    if (!currentSeries) return;
    const all = currentSeries.chapters.flatMap(ch =>
      ch.pages.map(p => ({ chapterId: ch.id, pageId: p.id }))
    );
    if (all.length === 0) return;
    const idx = all.findIndex(x => x.pageId === selectedPageId);
    const next = idx < 0 ? 0 : Math.max(0, Math.min(all.length - 1, idx + delta));
    setSelectedPageId(all[next].pageId);
  }

  // 顶栏要展示的进度
  const progress = useMemo(() => {
    if (!currentSeries) return null;
    const pages = currentSeries.chapters.flatMap(c => c.pages);
    return {
      done: pages.filter(p => p.status === 'done').length,
      total: pages.length,
    };
  }, [currentSeries]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <TopBar
        seriesList={seriesList}
        currentSeriesId={currentSeriesId}
        onSelect={(id) => setCurrentSeriesId(id)}
        onDelete={(id) => setPendingDelete(id)}
        chatCollapsed={chatCollapsed}
        onToggleChat={() => setChatCollapsed(c => !c)}
        progress={progress}
        seriesTitle={currentSeries?.title}
        language={props.language}
        setLanguage={props.setLanguage}
        onOpenModelConfig={props.onOpenModelConfig}
        onExport={currentSeries && currentSeries.chapters.length > 0
          ? () => {
              const all = currentSeries.chapters.flatMap(c => c.pages);
              exportSeriesAsStrips(all, currentSeries.title)
                .then(n => toast.push(n > 0 ? `已导出 ${n} 页条漫长图` : '暂无可导出的分镜图', n > 0 ? 'success' : 'error'))
                .catch(e => toast.push(e.message || '导出失败', 'error'));
            }
          : undefined}
      />

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <main style={{ flex: 1, minWidth: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', background: 'var(--paper)' }}>
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
            <SeriesWorkbench />
          </div>
        </main>

        {!chatCollapsed && (
          <AgentChatPanel
            engine={engineRef.current!}
            stage={stage}
            messages={messages}
            busy={busy}
            onApprove={onApprove}
            onRegenerate={onRegenerate}
            onReset={onReset}
            onCollapse={() => setChatCollapsed(true)}
          />
        )}
      </div>

      <ConfirmDialog
        open={!!pendingDelete}
        title="删除这个连载？"
        description="项目及其所有章节、角色、生成的分镜图都会被永久删除，无法恢复。"
        confirmText="永久删除"
        cancelText="取消"
        danger
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}

/* ============================================================
 * 顶栏（取代旧 Header + 浮层 ProjectHeader）
 * ============================================================ */

interface TopBarProps {
  seriesList: import('../types').Series[];
  currentSeriesId: string | null;
  onSelect: (id: string | null) => void;
  onDelete: (id: string) => void;
  chatCollapsed: boolean;
  onToggleChat: () => void;
  progress: { done: number; total: number } | null;
  seriesTitle?: string;
  language?: Language;
  setLanguage?: (lang: Language) => void;
  onOpenModelConfig?: () => void;
  onExport?: () => void;
}

function TopBar(props: TopBarProps): React.ReactElement {
  const { t } = useLocalization();
  const [dropdown, setDropdown] = useState<'project' | 'lang' | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setDropdown(null);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const current = props.seriesList.find(s => s.id === props.currentSeriesId);

  return (
    <header
      ref={ref}
      style={{
        flexShrink: 0,
        background: 'var(--paper)',
        borderBottom: '1px solid var(--rule)',
        position: 'relative',
        zIndex: 30,
      }}
    >
      {/* —— 报头：两行布局，窄屏安全 —— */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '0.5rem',
          padding: '0.625rem 1.25rem 0.5rem',
        }}
      >
        {/* 第一行：刊名 + 编辑铭牌 + 主操作（项目、导出） */}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto auto', alignItems: 'center', gap: '1rem', minWidth: 0 }}>
          {/* 左：刊名 */}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.625rem', minWidth: 0, overflow: 'hidden' }}>
            <h1
              className="headline"
              style={{ fontSize: '1.25rem', fontStyle: 'italic', fontWeight: 700, lineHeight: 1, color: 'var(--ink)', whiteSpace: 'nowrap' }}
            >
              AI Manga Studio
            </h1>
            <span className="kicker" style={{ fontSize: '0.625rem', whiteSpace: 'nowrap' }}>
              连载刊 · Vol.&nbsp;1
            </span>
          </div>

          {/* 中：编辑铭牌（仅当前选题时显示） */}
          <div style={{ textAlign: 'center', minWidth: 0 }}>
            {props.seriesTitle ? (
              <>
                <div className="kicker kicker--accent" style={{ fontSize: '0.625rem' }}>本期连载</div>
                <div className="italic-serif" style={{ fontSize: '0.8125rem', color: 'var(--ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '14rem' }}>
                  {props.seriesTitle}
                </div>
              </>
            ) : (
              <div className="kicker" style={{ fontSize: '0.625rem', color: 'var(--ink-3)' }}>尚未选题</div>
            )}
          </div>

          {/* 右：项目切换 + 导出（高频） */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '0.5rem' }}>
            {/* 项目切换（最高频） */}
            <button
              onClick={() => setDropdown(d => d === 'project' ? null : 'project')}
              className="btn btn--ghost"
              style={{ padding: '0.375rem 0.75rem', fontSize: '0.8125rem' }}
            >
              <span className="kicker kicker--accent" style={{ fontSize: '0.5625rem' }}>项目</span>
              <span style={{ fontWeight: 600 }}>{current?.title || '新建连载'}</span>
              <span style={{ fontSize: '0.625rem', color: 'var(--ink-3)' }}>▾</span>
            </button>
          </div>
        </div>

        {/* 第二行：进度 + 次要按钮（语言/配置/聊天/导出）—— 紧凑同行 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          {props.progress && props.progress.total > 0 ? (
            <div className="progress-meter" title={`${props.progress.done} / ${props.progress.total} 页已完成`}>
              <span className="mono tnum">{props.progress.done.toString().padStart(2, '0')}</span>
              <div className="progress-meter__bar">
                <div className="progress-meter__fill" style={{ width: `${(props.progress.done / props.progress.total) * 100}%` }} />
              </div>
              <span className="mono tnum" style={{ color: 'var(--ink-3)' }}>{props.progress.total.toString().padStart(2, '0')}</span>
              <span className="kicker" style={{ fontSize: '0.5625rem', marginLeft: '0.25rem' }}>页</span>
            </div>
          ) : (
            <span className="kicker" style={{ fontSize: '0.5625rem', color: 'var(--ink-3)' }}>未开始</span>
          )}

          <div style={{ flex: 1 }} />

          {/* 折叠聊天 */}
          <button className="iconbtn" onClick={props.onToggleChat}
            title={props.chatCollapsed ? '展开助手' : '收起助手'}
            aria-label={props.chatCollapsed ? '展开助手' : '收起助手'}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              {props.chatCollapsed
                ? <path d="M15 6l-6 6 6 6" />
                : <path d="M9 6l6 6-6 6" />}
            </svg>
          </button>

          {/* 模型配置 */}
          {props.onOpenModelConfig && (
            <button className="iconbtn" onClick={props.onOpenModelConfig}
              title={t('modelConfig')} aria-label={t('modelConfig')}>
              <CogIcon className="w-4 h-4" />
            </button>
          )}

          {/* 语言切换 */}
          {props.language && props.setLanguage && (
            <div style={{ position: 'relative' }}>
              <button
                className="btn btn--link"
                onClick={() => setDropdown(d => d === 'lang' ? null : 'lang')}
                style={{ fontSize: '0.6875rem', padding: '0.25rem 0.5rem' }}
              >
                {props.language === 'zh' ? '中文' : props.language === 'en' ? 'EN' : 'JP'}
              </button>
              {dropdown === 'lang' && (
                <div style={{
                  position: 'absolute', top: '100%', right: 0, marginTop: '0.25rem',
                  background: 'var(--bg-card)', border: '1px solid var(--ink)',
                  zIndex: 31, minWidth: '6rem',
                }}>
                  {([['zh','中文'],['en','English'],['ja','日本語']] as [Language,string][]).map(([key, name]) => (
                    <button
                      key={key}
                      onClick={() => { props.setLanguage!(key); setDropdown(null); }}
                      style={{
                        display: 'block', width: '100%', textAlign: 'left',
                        padding: '0.5rem 0.875rem', fontSize: '0.8125rem',
                        background: props.language === key ? 'var(--bg-soft)' : 'transparent',
                        color: 'var(--ink)', border: 'none', cursor: 'pointer',
                      }}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 导出 */}
          {props.onExport && (
            <button className="btn btn--primary" onClick={props.onExport}
              style={{ padding: '0.375rem 0.75rem', fontSize: '0.75rem' }}>
              {t('export')}
            </button>
          )}
        </div>
      </div>

      {/* 项目下拉菜单（顶栏下方展开） */}
      {dropdown === 'project' && (
        <div
          className="card fade-in"
          style={{
            position: 'absolute',
            top: '100%',
            right: '1.5rem',
            marginTop: '0.25rem',
            minWidth: '20rem',
            maxHeight: '24rem',
            overflowY: 'auto',
            padding: 0,
            zIndex: 32,
          }}
        >
          <div className="kicker" style={{ padding: '0.625rem 0.875rem', borderBottom: '1px solid var(--rule-soft)' }}>
            你的连载 · {props.seriesList.length} 个
          </div>
          <button
            onClick={() => { props.onSelect(null); setDropdown(null); }}
            style={{
              display: 'flex', alignItems: 'center', gap: '0.5rem',
              width: '100%', padding: '0.625rem 0.875rem',
              background: props.currentSeriesId === null ? 'var(--bg-soft)' : 'transparent',
              border: 'none', borderBottom: '1px solid var(--rule-soft)',
              fontFamily: 'var(--font-body)', fontSize: '0.875rem', textAlign: 'left',
              color: 'var(--ink)', cursor: 'pointer',
            }}
          >
            <span style={{ fontWeight: 600 }}>＋  新建连载</span>
          </button>
          {props.seriesList.length === 0 && (
            <div style={{ padding: '1rem', textAlign: 'center', fontSize: '0.8125rem', color: 'var(--ink-3)' }}>
              还没有连载 · 先创建一个吧
            </div>
          )}
          {props.seriesList.map(s => {
            const totalPages = s.chapters.reduce((sum, c) => sum + c.pages.length, 0);
            const donePages = s.chapters.reduce((sum, c) => sum + c.pages.filter(p => p.status === 'done').length, 0);
            const active = props.currentSeriesId === s.id;
            return (
              <div
                key={s.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  borderBottom: '1px solid var(--rule-soft)',
                  background: active ? 'var(--bg-soft)' : 'transparent',
                }}
              >
                <button
                  onClick={() => { props.onSelect(s.id); setDropdown(null); }}
                  style={{
                    flex: 1, textAlign: 'left', padding: '0.625rem 0.875rem',
                    background: 'transparent', border: 'none',
                    color: 'var(--ink)', cursor: 'pointer',
                    display: 'flex', flexDirection: 'column', gap: '0.25rem',
                    minWidth: 0,
                  }}
                >
                  <span style={{ fontWeight: 600, fontSize: '0.875rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.title || '（未命名）'}
                  </span>
                  <span style={{ fontSize: '0.6875rem', color: 'var(--ink-3)' }}>
                    {s.chapters.length} 章 · {donePages}/{totalPages} 页
                  </span>
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); props.onDelete(s.id); }}
                  title="删除项目" aria-label="删除项目"
                  className="iconbtn"
                  style={{ marginRight: '0.5rem', color: 'var(--ink-3)' }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
                  </svg>
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* —— 报头下分割线 + 角落装饰 —— */}
      <div style={{ height: '4px', borderTop: '1px solid var(--rule)', borderBottom: '1px solid var(--rule)' }} />
      <style>{`
        .iconbtn {
          background: transparent;
          color: var(--ink-2);
          border: 1px solid transparent;
          padding: 0.375rem;
          border-radius: 2px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: color .15s ease, border-color .15s ease;
        }
        .iconbtn:hover { color: var(--accent); border-color: var(--rule-soft); }
      `}</style>
    </header>
  );
}