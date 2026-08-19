import React, { useState } from 'react';
import { VideoIcon, BookOpenIcon, GlobeIcon, KeyIcon, CogIcon } from './icons';
import { useLocalization } from '../hooks/useLocalization';
import { Language } from '../locales/locales';

/* —— Header · 杂志"报头" —— */

export interface HeaderProgress {
  done: number;
  total: number;
}

export interface HeaderProps {
  language: Language;
  setLanguage: (lang: Language) => void;
  onOpenApiKeyModal?: () => void;
  hasApiKey?: boolean;
  onOpenModelConfig?: () => void;
  onShowMangaViewer?: () => void;
  onShowWorldview?: () => void;
  onSwitchToVideo?: () => void;
  onExport?: () => void;
  /** 杂志报头右侧的进度条数据；为 null 时不渲染 */
  progress?: HeaderProgress | null;
  /** 项目名（用于报头日期线右侧） */
  seriesTitle?: string;
}

export function Header(props: HeaderProps): React.ReactElement {
  const { t } = useLocalization();
  const [isLangOpen, setIsLangOpen] = useState(false);

  const languages: { key: Language, name: string }[] = [
    { key: 'zh', name: t('chinese') },
    { key: 'en', name: t('english') },
    { key: 'ja', name: t('japanese') },
  ];

  const pct = props.progress && props.progress.total > 0
    ? Math.round((props.progress.done / props.progress.total) * 100)
    : 0;

  return (
    <header
      style={{
        background: 'var(--paper)',
        borderBottom: '1px solid var(--rule)',
      }}
      className="w-full z-20 relative flex-shrink-0"
    >
      {/* —— 报头：刊名 + 日期 + 期数 —— */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr auto 1fr',
          alignItems: 'center',
          padding: '0.625rem 1.5rem 0.5rem',
          gap: '1rem',
        }}
      >
        {/* 左：刊名 */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem' }}>
          <h1
            className="headline"
            style={{ fontSize: '1.5rem', fontStyle: 'italic', fontWeight: 700, lineHeight: 1, color: 'var(--ink)' }}
          >
            AI Manga Studio
          </h1>
          <span className="kicker" style={{ fontSize: '0.625rem' }}>连载刊 · Vol.&nbsp;1</span>
        </div>

        {/* 中：编辑铭牌 */}
        <div style={{ textAlign: 'center' }}>
          <div className="kicker kicker--accent" style={{ fontSize: '0.625rem' }}>编辑设计</div>
          <div className="italic-serif" style={{ fontSize: '0.875rem', color: 'var(--ink-2)' }}>
            {props.seriesTitle || '尚未选题'}
          </div>
        </div>

        {/* 右：进度 + 工具 */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '0.75rem' }}>
          {props.progress && (
            <div className="progress-meter" title={`已完成 ${props.progress.done} / 共 ${props.progress.total} 页`}>
              <span className="mono">{props.progress.done.toString().padStart(2, '0')}</span>
              <div className="progress-meter__bar">
                <div className="progress-meter__fill" style={{ width: `${pct}%` }} />
              </div>
              <span className="mono" style={{ color: 'var(--ink-3)' }}>{props.progress.total.toString().padStart(2, '0')}</span>
            </div>
          )}

          {props.onSwitchToVideo && (
            <button className="iconbtn" onClick={props.onSwitchToVideo} title={t('aiVideoProducer')} aria-label={t('aiVideoProducer')}>
              <VideoIcon className="w-4 h-4" />
            </button>
          )}
          {props.onShowMangaViewer && (
            <button className="iconbtn" onClick={props.onShowMangaViewer} title={t('viewCollection')} aria-label={t('viewCollection')}>
              <BookOpenIcon className="w-4 h-4" />
            </button>
          )}
          {props.onShowWorldview && (
            <button className="iconbtn" onClick={props.onShowWorldview} title={t('worldviewSettings')} aria-label={t('worldviewSettings')}>
              <GlobeIcon className="w-4 h-4" />
            </button>
          )}
          {props.onOpenApiKeyModal && (
            <button className="iconbtn" onClick={props.onOpenApiKeyModal} title={t('apiKey')} aria-label={t('apiKey')}>
              <KeyIcon className="w-4 h-4" />
            </button>
          )}
          {props.onOpenModelConfig && (
            <button className="iconbtn" onClick={props.onOpenModelConfig} title={t('modelConfig')} aria-label={t('modelConfig')}>
              <CogIcon className="w-4 h-4" />
            </button>
          )}

          <div style={{ position: 'relative' }}>
            <button
              className="btn btn--link"
              onClick={() => setIsLangOpen(o => !o)}
              style={{ fontSize: '0.75rem', letterSpacing: '0.05em', textTransform: 'uppercase' }}
            >
              {languages.find(l => l.key === props.language)?.name}
            </button>
            {isLangOpen && (
              <div style={{
                position: 'absolute', top: '100%', right: 0, marginTop: '0.25rem',
                background: 'var(--bg-card)', border: '1px solid var(--ink)',
                zIndex: 30, minWidth: '6rem',
              }}>
                {languages.map(({ key, name }) => (
                  <button
                    key={key}
                    onClick={() => { props.setLanguage(key); setIsLangOpen(false); }}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left',
                      padding: '0.5rem 0.875rem', fontSize: '0.8125rem',
                      background: props.language === key ? 'var(--bg-soft)' : 'transparent',
                      color: 'var(--ink)',
                      border: 'none',
                    }}
                  >
                    {name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {props.onExport && (
            <button className="btn btn--primary" onClick={props.onExport} style={{ padding: '0.5rem 0.875rem' }}>
              {t('export')}
            </button>
          )}
        </div>
      </div>

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