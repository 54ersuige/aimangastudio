import React, { useEffect } from 'react';

/* —— ConfirmDialog：破坏性操作的二次确认（杂志风） —— */

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  onConfirm(): void;
  onCancel(): void;
}

export function ConfirmDialog(props: ConfirmDialogProps): React.ReactElement | null {
  const { open, title, description, confirmText = '确认', cancelText = '取消', danger, onConfirm, onCancel } = props;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      // 危险操作不绑定 Enter —— 防止弹窗刚打开时手滑 Enter 直接触发删除
      if (e.key === 'Enter' && !danger) onConfirm();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel, onConfirm, danger]);

  if (!open) return null;
  return (
    <div className="modal-veil" role="dialog" aria-modal="true" onClick={onCancel}>
      <div className="modal-card fade-in" onClick={e => e.stopPropagation()}>
        <div className="kicker kicker--accent" style={{ marginBottom: '0.5rem' }}>
          请确认
        </div>
        <h3 className="headline headline--lg" style={{ marginBottom: '0.75rem' }}>{title}</h3>
        {description && (
          <p className="deck" style={{ marginBottom: '1.25rem' }}>{description}</p>
        )}
        <hr className="rule" />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
          <button className="btn btn--ghost" onClick={onCancel} autoFocus={danger}>{cancelText}</button>
          <button
            className={`btn ${danger ? 'btn--danger' : 'btn--primary'}`}
            onClick={onConfirm}
            autoFocus={!danger}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}