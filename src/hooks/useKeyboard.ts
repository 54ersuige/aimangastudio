import { useEffect } from 'react';

/* —— 全局键盘快捷键（无依赖版） —— */

export interface KeyBinding {
  /** 匹配按键（不区分大小写，特殊键使用 KeyboardEvent.key） */
  key: string;
  /** 修饰键（默认无） */
  mod?: 'ctrl' | 'meta' | 'alt' | 'shift';
  /** 动作 */
  action(): void;
  /** 启用条件；false 时不绑定 */
  enabled?: boolean;
  /** 在 input/textarea 内是否触发（默认 false，避免影响输入） */
  inEditable?: boolean;
}

export function useKeyboard(bindings: KeyBinding[]): void {
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const editable = !!target && (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      );
      for (const b of bindings) {
        if (b.enabled === false) continue;
        if (editable && !b.inEditable) continue;
        const matchesKey = e.key.toLowerCase() === b.key.toLowerCase();
        const matchesMod = (() => {
          switch (b.mod) {
            case 'ctrl':  return e.ctrlKey && !e.metaKey;
            case 'meta':  return e.metaKey && !e.ctrlKey;
            case 'alt':   return e.altKey;
            case 'shift': return e.shiftKey;
            default:      return !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;
          }
        })();
        if (matchesKey && matchesMod) {
          e.preventDefault();
          b.action();
          return;
        }
      }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [bindings]);
}