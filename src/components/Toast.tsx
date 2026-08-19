import React, { createContext, useCallback, useContext, useState } from 'react';

/* —— Toast：杂志风短消息（取代错误条堆叠） —— */

export type ToastVariant = 'default' | 'success' | 'error';
export interface ToastItem {
  id: number;
  text: string;
  variant: ToastVariant;
}

interface ToastCtx {
  push(text: string, variant?: ToastVariant): void;
}

const Ctx = createContext<ToastCtx | null>(null);

export function useToast(): ToastCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useToast must be used within <ToastProvider>');
  return v;
}

export function ToastProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((text: string, variant: ToastVariant = 'default') => {
    const id = Date.now() + Math.random();
    setItems(prev => [...prev, { id, text, variant }]);
    setTimeout(() => {
      setItems(prev => prev.filter(t => t.id !== id));
    }, 4000);
  }, []);
  return (
    <Ctx.Provider value={{ push }}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {items.map(t => (
          <div
            key={t.id}
            className={`toast ${t.variant === 'error' ? 'toast--error' : ''} ${t.variant === 'success' ? 'toast--success' : ''}`}
          >
            <span className="kicker kicker--accent" style={{ color: 'inherit', opacity: 0.7 }}>
              {t.variant === 'error' ? '错误' : t.variant === 'success' ? '完成' : '提示'}
            </span>
            <span className="flex-1">{t.text}</span>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}