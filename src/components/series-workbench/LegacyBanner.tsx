import React, { useEffect, useState, useCallback } from 'react';

/**
 * Legacy 红条 —— 2026-09-07 反馈层 P3。
 *
 * 启动时拉 /api/audit/legacy-list，若有 legacy 角色（缺必填字段）就显示红条。
 * 点击「去补全」按钮跳到对应 series 的角色编辑卡（由父组件传 onJump 回调）。
 */
export interface LegacyItem {
  seriesId: string;
  seriesTitle: string;
  characterId: string;
  characterName: string;
  role: string;
}

interface Props {
  onJump?: (seriesId: string, characterId: string) => void;
}

export function LegacyBanner({ onJump }: Props) {
  const [items, setItems] = useState<LegacyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState(false);

  const reload = useCallback(async (signal?: AbortSignal) => {
    try {
      const r = await fetch('/api/audit/legacy-list', { signal });
      if (!r.ok) return;
      const j = await r.json();
      if (signal?.aborted) return;
      setItems(j.list || []);
    } catch (e: any) {
      // 用户主动取消（HMR / StrictMode 双调用 / 组件卸载）— 静默。
      if (e?.name === 'AbortError') return;
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    reload(controller.signal);
    // 每 30s 拉一次（用户在编辑角色时实时更新）
    const t = setInterval(() => reload(controller.signal), 30000);
    return () => {
      clearInterval(t);
      controller.abort();
    };
  }, [reload]);

  if (loading) return null;
  if (items.length === 0) return null;
  if (dismissed) return null;

  return (
    <div
      style={{
        background: 'var(--accent-soft, #fff4e0)',
        border: '1px solid var(--accent-warn, #d97706)',
        borderRadius: '8px',
        padding: '0.75rem 1rem',
        marginBottom: '1rem',
        display: 'flex',
        alignItems: 'flex-start',
        gap: '0.75rem',
      }}
      role="alert"
    >
      <div style={{ fontSize: '1.25rem', lineHeight: 1 }}>⚠️</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>
          {items.length} 个角色缺必填字段（legacy）
        </div>
        <div style={{ fontSize: '0.85rem', color: 'var(--ink-2, #555)', marginBottom: '0.5rem' }}>
          这些角色的 gender / ageBand / outfit / visualAnchors 字段不全，
          生图模型对自由文本外貌的遵循度低，会出现「主角变女性」「服装跳变」等问题。
          点击下方名字直接跳转补全。
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
          {items.map(it => (
            <button
              key={`${it.seriesId}-${it.characterId}`}
              onClick={() => onJump?.(it.seriesId, it.characterId)}
              style={{
                fontSize: '0.8rem',
                padding: '0.25rem 0.625rem',
                borderRadius: '999px',
                border: '1px solid var(--accent-warn, #d97706)',
                background: 'white',
                color: 'var(--accent-warn, #d97706)',
                cursor: 'pointer',
              }}
              title={`${it.seriesTitle} · ${it.role}`}
            >
              {it.characterName} <span style={{ opacity: 0.6 }}>· {it.seriesTitle}</span>
            </button>
          ))}
        </div>
      </div>
      <button
        onClick={() => setDismissed(true)}
        style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '1rem' }}
        aria-label="关闭"
      >×</button>
    </div>
  );
}