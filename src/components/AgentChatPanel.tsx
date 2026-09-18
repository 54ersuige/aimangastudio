import React, { useEffect, useRef, useState } from 'react';
import type { ChatMessage, AgentCard, AgentStage } from '../types';
import type { AgentEngine } from '../services/agentEngine';
import { CharacterRelationshipGraph } from './CharacterRelationshipGraph';

function extractReadableText(description: string): string {
  if (!description) return '';
  const cleaned = description.replace(
    /^(远景|中景|近景|特写|全景|侧影|俯拍|仰拍|跟拍|鸟瞰|微距|长镜头)[，,。\s]*/i,
    '',
  );
  const noBrackets = cleaned.replace(/[（(][^）)]*(?:侧影|背影|正面|侧面|背影|特写)[^）)]*[）)]/g, '');
  if (noBrackets.replace(/\s/g, '').length < 5) return '';
  return noBrackets.trim();
}

interface Props {
  engine: AgentEngine;
  stage: AgentStage;
  messages: ChatMessage[];
  busy: boolean;
  onApprove: () => void;
  onRegenerate: () => void;
  onReset: () => void;
  onCollapse?: () => void;
}

/* —— 杂志风"刊中刊"侧栏 —— */

const STAGES: { key: AgentStage; label: string; num: string }[] = [
  { key: 'awaiting_logline',    label: '灵感',   num: 'I'   },
  { key: 'reviewing_worldview', label: '世界观', num: 'II'  },
  { key: 'reviewing_characters',label: '角色',   num: 'III' },
  { key: 'reviewing_chapters',  label: '话目',   num: 'IV'  },
  { key: 'producing_pages',     label: '逐话生成',num: 'V'   },
];

export function AgentChatPanel({ engine, stage, messages, busy, onApprove, onRegenerate, onReset, onCollapse }: Props): React.ReactElement {
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busy]);

  useEffect(() => {
    if (messages.length === 0) onReset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    await engine.onUserMessage(text);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  const activeIdx = Math.max(0, STAGES.findIndex(s => s.key === stage));

  return (
    <aside
      style={{
        width: '380px',
        flexShrink: 0,
        borderLeft: '1px solid var(--rule)',
        background: 'var(--paper)',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
      }}
    >
      {/* —— 报头：刊中刊 —— */}
      <div style={{ padding: '0.875rem 1.25rem 0.75rem', borderBottom: '1px solid var(--rule)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div className="kicker kicker--accent">刊中刊</div>
            <div className="italic-serif" style={{ fontSize: '1rem', fontWeight: 600 }}>创作助手</div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button onClick={onReset} className="btn btn--link" style={{ fontSize: '0.6875rem' }} title="重置对话">重置</button>
            {onCollapse && (
              <button onClick={onCollapse} className="iconbtn" title="收起侧栏" aria-label="收起侧栏">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 6l6 6-6 6"/></svg>
              </button>
            )}
          </div>
        </div>

        {/* —— 罗马数字阶段指示 —— */}
        <div style={{ marginTop: '0.875rem', display: 'flex', gap: '0.5rem', alignItems: 'baseline' }}>
          {STAGES.map((s, i) => {
            const isActive = i === activeIdx;
            const isDone = i < activeIdx;
            return (
              <React.Fragment key={s.key}>
                <div style={{ textAlign: 'center', minWidth: '2.75rem' }}>
                  <div
                    className="chapter-num"
                    style={{
                      fontSize: isActive ? '1.375rem' : '0.875rem',
                      color: isActive ? 'var(--accent)' : isDone ? 'var(--ink-2)' : 'var(--ink-3)',
                      textDecoration: isDone ? 'line-through' : 'none',
                      transition: 'all .15s ease',
                    }}
                  >
                    {s.num}
                  </div>
                  <div style={{
                    fontSize: '0.625rem',
                    color: isActive ? 'var(--ink)' : 'var(--ink-3)',
                    marginTop: '0.125rem',
                    letterSpacing: '0.05em',
                  }}>{s.label}</div>
                </div>
                {i < STAGES.length - 1 && (
                  <div style={{
                    flex: 1,
                    height: '1px',
                    background: i < activeIdx ? 'var(--ink)' : 'var(--rule-soft)',
                    alignSelf: 'center',
                    marginBottom: '1rem',
                  }} />
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* —— 聊天流 —— */}
      <div
        ref={scrollRef}
        style={{ flex: 1, overflowY: 'auto', padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.875rem' }}
      >
        {messages.map(m => (
          <Bubble key={m.id} message={m} onApprove={onApprove} onRegenerate={onRegenerate} busy={busy} />
        ))}
        {busy && (
          <div style={{ alignSelf: 'flex-start' }}>
            <div style={{
              background: 'var(--bg-card)', border: '1px solid var(--rule-soft)',
              padding: '0.5rem 0.75rem', fontSize: '0.8125rem', color: 'var(--ink-2)',
              display: 'flex', alignItems: 'center', gap: '0.375rem',
            }}>
              <span className="kicker kicker--accent" style={{ fontSize: '0.5625rem' }}>思考中</span>
              <span style={{ display: 'inline-block', width: 6, height: 6, background: 'var(--accent)', animation: 'pulse 1s infinite' }} />
              <span style={{ display: 'inline-block', width: 6, height: 6, background: 'var(--accent)', animation: 'pulse 1s infinite', animationDelay: '120ms' }} />
              <span style={{ display: 'inline-block', width: 6, height: 6, background: 'var(--accent)', animation: 'pulse 1s infinite', animationDelay: '240ms' }} />
            </div>
          </div>
        )}
      </div>

      {/* —— 输入区 —— */}
      <div style={{ borderTop: '1px solid var(--rule)', padding: '0.875rem 1.25rem', background: 'var(--paper)' }}>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={busy ? 'AI 正在处理…' : '回车发送，Shift+回车换行'}
          rows={2}
          disabled={busy}
          style={{
            width: '100%', resize: 'vertical',
            fontFamily: 'var(--font-body)', fontSize: '0.875rem',
            background: 'transparent', border: '1px solid var(--rule-soft)',
            padding: '0.5rem 0.625rem', color: 'var(--ink)',
            minHeight: '3rem', maxHeight: '8rem',
          }}
        />
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.625rem', alignItems: 'center' }}>
          <button
            onClick={send}
            disabled={busy || !input.trim()}
            className="btn btn--primary"
            style={{ padding: '0.5rem 0.875rem', fontSize: '0.8125rem' }}
          >
            发送 ▸
          </button>
          <div style={{ flex: 1 }} />
          {(stage === 'reviewing_chapters' && messages.some(m => m.card?.kind === 'chapters')
            ? ['通过，进入逐话', '重新生成', '清空对话']
            : ['通过', '重新生成', '清空对话']
          ).map(t => (
            <button
              key={t}
              onClick={() => {
                if (busy) return;
                setInput('');
                void engine.onUserMessage(t);
              }}
              disabled={busy}
              className="btn btn--link"
              style={{ fontSize: '0.6875rem' }}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <style>{`
        @keyframes pulse { 0%,100%{opacity:0.3} 50%{opacity:1} }
      `}</style>
    </aside>
  );
}

type BubbleProps = {
  message: ChatMessage;
  onApprove: () => void;
  onRegenerate: () => void;
  busy: boolean;
};

const Bubble: React.FC<BubbleProps> = ({ message, onApprove, onRegenerate, busy }) => {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';

  if (isSystem) {
    return (
      <div style={{ alignSelf: 'center' }}>
        <span className="kicker" style={{ background: 'var(--bg-soft)', padding: '0.25rem 0.625rem' }}>
          {message.text}
        </span>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
      <div style={{ maxWidth: '92%', display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
        <div
          style={{
            padding: '0.625rem 0.875rem',
            fontSize: '0.875rem',
            lineHeight: 1.55,
            whiteSpace: 'pre-wrap',
            background: isUser ? 'var(--ink)' : message.error ? '#FBE9E4' : 'var(--bg-card)',
            color: isUser ? 'var(--paper)' : message.error ? 'var(--danger)' : 'var(--ink)',
            border: message.error ? '1px solid var(--danger)' : isUser ? 'none' : '1px solid var(--rule-soft)',
            borderRadius: '2px',
          }}
        >
          {renderInline(message.text)}
        </div>

        {message.pending && (
          <div className="kicker" style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
            <span style={{ display: 'inline-block', width: 6, height: 6, background: 'var(--accent)', animation: 'pulse 1s infinite' }} />
            正在执行
          </div>
        )}

        {message.card && <CardView card={message.card} onApprove={onApprove} onRegenerate={onRegenerate} disabled={busy} />}
      </div>
    </div>
  );
};

function renderInline(text: string): React.ReactNode[] {
  const tokens = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return tokens.map((t, i) => {
    if (/^\*\*[^*]+\*\*$/.test(t)) {
      return <strong key={i} style={{ fontWeight: 600 }}>{t.slice(2, -2)}</strong>;
    }
    if (/^`[^`]+$/.test(t)) {
      return <code key={i} style={{ background: 'var(--bg-soft)', padding: '0 0.25rem', fontSize: '0.8125rem' }}>{t.slice(1, -1)}</code>;
    }
    return <React.Fragment key={i}>{t}</React.Fragment>;
  });
}

function CardView({
  card, onApprove, onRegenerate, disabled,
}: {
  card: AgentCard; onApprove: () => void; onRegenerate: () => void; disabled: boolean;
}): React.ReactElement {
  switch (card.kind) {
    case 'worldview':
      return <WorldviewCard w={card.worldview} onApprove={onApprove} onRegenerate={onRegenerate} disabled={disabled} />;
    case 'characters':
      return <CharactersCard chars={card.characters} onApprove={onApprove} onRegenerate={onRegenerate} disabled={disabled} />;
    case 'chapters':
      return <ChaptersCard chs={card.chapters} onApprove={onApprove} onRegenerate={onRegenerate} disabled={disabled} />;
    case 'page_preview':
      return <PagePreviewCard chapterTitle={card.chapterTitle} page={card.page} />;
  }
}

function ApproveBar({ onApprove, onRegenerate, disabled }: { onApprove: () => void; onRegenerate: () => void; disabled: boolean }) {
  return (
    <div style={{ display: 'flex', gap: '0.5rem', paddingTop: '0.625rem', marginTop: '0.625rem', borderTop: '1px solid var(--rule-soft)' }}>
      <button onClick={onApprove} disabled={disabled} className="btn btn--primary" style={{ padding: '0.375rem 0.75rem', fontSize: '0.75rem' }}>
        通过 ✓
      </button>
      <button onClick={onRegenerate} disabled={disabled} className="btn btn--ghost" style={{ padding: '0.375rem 0.75rem', fontSize: '0.75rem' }}>
        重新生成
      </button>
    </div>
  );
}

function WorldviewCard({ w, onApprove, onRegenerate, disabled }: { w: import('../types').Worldview; onApprove: () => void; onRegenerate: () => void; disabled: boolean }): React.ReactElement {
  if (!w) {
    return (
      <div className="card fade-in" style={{ padding: '0.75rem 0.875rem', width: '320px', maxWidth: '100%' }}>
        <div className="kicker kicker--accent" style={{ marginBottom: '0.5rem' }}>世界观</div>
        <div className="deck" style={{ fontSize: '0.8125rem' }}>（世界观数据缺失 — 请在主工作台点击「重新生成」。）</div>
        <ApproveBar onApprove={onApprove} onRegenerate={onRegenerate} disabled={disabled} />
      </div>
    );
  }
  return (
    <div className="card fade-in" style={{ padding: '0.875rem 1rem', width: '320px', maxWidth: '100%' }}>
      <div className="kicker kicker--accent" style={{ marginBottom: '0.5rem' }}>世界观 · 已生成</div>
      <div className="italic-serif" style={{ fontSize: '0.8125rem', color: 'var(--ink-2)', marginBottom: '0.625rem' }}>{w.summary}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem', marginBottom: '0.5rem' }}>
        <MiniChip label="时代" value={w.era} />
        <MiniChip label="画风" value={w.artStyle} />
        <MiniChip label="色调" value={w.paletteMood} />
      </div>
      <details style={{ paddingTop: '0.5rem', borderTop: '1px solid var(--rule-soft)' }}>
        <summary className="kicker" style={{ cursor: 'pointer' }}>展开背景设定 ▾</summary>
        <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', lineHeight: 1.6, whiteSpace: 'pre-wrap', color: 'var(--ink-2)' }}>{w.background}</div>
      </details>
      <ApproveBar onApprove={onApprove} onRegenerate={onRegenerate} disabled={disabled} />
    </div>
  );
}

function MiniChip({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: 'var(--bg-soft)', padding: '0.375rem 0.5rem' }}>
      <div className="kicker" style={{ fontSize: '0.5625rem' }}>{label}</div>
      <div style={{ fontSize: '0.6875rem', fontWeight: 600, lineHeight: 1.3, marginTop: '0.125rem' }}>{value}</div>
    </div>
  );
}

function CharactersCard({ chars, onApprove, onRegenerate, disabled }: { chars: import('../types').SeriesCharacter[]; onApprove: () => void; onRegenerate: () => void; disabled: boolean }): React.ReactElement {
  if (!chars || chars.length === 0) {
    return (
      <div className="card fade-in" style={{ padding: '0.75rem 0.875rem', width: '320px', maxWidth: '100%' }}>
        <div className="kicker kicker--accent" style={{ marginBottom: '0.5rem' }}>角色</div>
        <div className="deck" style={{ fontSize: '0.8125rem' }}>（暂无角色 — 在主工作台生成。）</div>
        <ApproveBar onApprove={onApprove} onRegenerate={onRegenerate} disabled={disabled} />
      </div>
    );
  }
  const roleColor = (r: string) =>
    r === 'protagonist' ? 'var(--accent)'
    : r === 'antagonist' ? 'var(--ink)'
    : 'var(--ink-3)';
  const roleLabel = (r: string) =>
    r === 'protagonist' ? '主角' : r === 'antagonist' ? '反派' : '配角';
  return (
    <div className="card fade-in" style={{ padding: '0.875rem 1rem', width: '320px', maxWidth: '100%' }}>
      <div className="kicker kicker--accent" style={{ marginBottom: '0.5rem' }}>角色 · {chars.length} 位</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '24rem', overflowY: 'auto' }}>
        {chars.map(c => (
          <div key={c.id} style={{ display: 'flex', gap: '0.5rem', padding: '0.5rem', background: 'var(--bg-soft)' }}>
            {(c.referenceImages?.[0] || c.referenceImage) ? (
              <img src={(c.referenceImages && c.referenceImages[0]) || c.referenceImage} alt={c.name} style={{ width: '3.25rem', height: '3.25rem', objectFit: 'cover', flexShrink: 0 }} />
            ) : (
              <div style={{ width: '3.25rem', height: '3.25rem', background: 'var(--bg-paper-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.625rem', color: 'var(--ink-3)', flexShrink: 0 }}>无图</div>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                <span style={{ fontWeight: 600, fontSize: '0.8125rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                <span style={{ fontSize: '0.5625rem', color: roleColor(c.role), textTransform: 'uppercase', letterSpacing: '0.1em' }}>{roleLabel(c.role)}</span>
              </div>
              <div style={{ fontSize: '0.6875rem', color: 'var(--ink-2)', marginTop: '0.125rem', lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{c.description}</div>
            </div>
          </div>
        ))}
      </div>
      {chars.length >= 2 && (
        <div style={{ marginTop: '0.625rem', paddingTop: '0.625rem', borderTop: '1px solid var(--rule-soft)' }}>
          <div className="kicker" style={{ fontSize: '0.5625rem', marginBottom: '0.375rem' }}>人物关系</div>
          <CharacterRelationshipGraph characters={chars} height={150} />
        </div>
      )}
      <ApproveBar onApprove={onApprove} onRegenerate={onRegenerate} disabled={disabled} />
    </div>
  );
}

function ChaptersCard({ chs, onApprove, onRegenerate, disabled }: { chs: import('../types').Chapter[]; onApprove: () => void; onRegenerate: () => void; disabled: boolean }): React.ReactElement {
  if (!chs || chs.length === 0) {
    return (
      <div className="card fade-in" style={{ padding: '0.75rem 0.875rem', width: '320px', maxWidth: '100%' }}>
        <div className="kicker kicker--accent" style={{ marginBottom: '0.5rem' }}>话目大纲</div>
        <div className="deck" style={{ fontSize: '0.8125rem' }}>（暂无话目 — 回复「开始拆分」生成。）</div>
        <ApproveBar onApprove={onApprove} onRegenerate={onRegenerate} disabled={disabled} />
      </div>
    );
  }
  return (
    <div className="card fade-in" style={{ padding: '0.875rem 1rem', width: '320px', maxWidth: '100%' }}>
      <div className="kicker kicker--accent" style={{ marginBottom: '0.5rem' }}>话目大纲 · {chs.length} 话</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem', maxHeight: '22rem', overflowY: 'auto' }}>
        {chs.map((c, i) => (
          <div key={c.id} style={{ padding: '0.5rem', background: 'var(--bg-soft)' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
              <span style={{ fontWeight: 600, fontSize: '0.8125rem' }}>
                <span className="chapter-num" style={{ fontSize: '0.8125rem', marginRight: '0.25rem' }}>第 {i + 1} 话</span>
                《{c.title}》
              </span>
              <span className="mono" style={{ fontSize: '0.625rem', color: 'var(--ink-3)' }}>{c.pages.reduce((n, p) => n + p.panels.length, 0)} 格</span>
            </div>
            <div style={{ fontSize: '0.6875rem', color: 'var(--ink-2)', lineHeight: 1.45, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{c.summary}</div>
          </div>
        ))}
      </div>
      <ApproveBar onApprove={onApprove} onRegenerate={onRegenerate} disabled={disabled} />
    </div>
  );
}

function PagePreviewCard({ chapterTitle, page }: { chapterTitle: string; page: import('../types').SeriesPage }): React.ReactElement {
  if (!page) {
    return (
      <div className="card fade-in" style={{ padding: '0.75rem 0.875rem', width: '320px', maxWidth: '100%' }}>
        <div className="kicker kicker--accent" style={{ marginBottom: '0.5rem' }}>分镜预览</div>
        <div className="deck" style={{ fontSize: '0.8125rem' }}>（页面数据缺失）</div>
      </div>
    );
  }
  return (
    <div className="card fade-in" style={{ padding: '0.875rem 1rem', width: '320px', maxWidth: '100%' }}>
      <div className="kicker kicker--accent" style={{ marginBottom: '0.5rem' }}>
        分镜预览 · {chapterTitle} · {page.panels.length} 格
      </div>
      {page.sceneDescription && (
        <div style={{ fontSize: '0.75rem', lineHeight: 1.5, whiteSpace: 'pre-wrap', background: 'var(--bg-soft)', padding: '0.5rem', marginBottom: '0.5rem' }}>{page.sceneDescription}</div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
        {page.panels.map(p => {
          const readerText = p.dialogue || extractReadableText(p.description);
          return (
            <div key={p.index} style={{ fontSize: '0.6875rem', borderLeft: '2px solid var(--accent)', paddingLeft: '0.5rem' }}>
              <div className="kicker" style={{ fontSize: '0.5625rem' }}>第 {p.index} 格</div>
              {readerText && <div style={{ marginTop: '0.125rem', fontStyle: 'italic', color: 'var(--ink-2)', lineHeight: 1.45 }}>{readerText}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function toRoman(n: number): string {
  const map: [number, string][] = [[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']];
  let r = ''; let v = n;
  for (const [k, s] of map) { while (v >= k) { r += s; v -= k; } }
  return r;
}