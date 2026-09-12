import * as React from 'react';
import { create } from 'zustand';
import { cn } from './cn';

export type ToastTone = 'default' | 'positive' | 'negative' | 'warn';

export interface Toast {
  id: number;
  message: string;
  detail?: string;
  tone: ToastTone;
  /** A single follow-up action — usually Undo. */
  action?: { label: string; run: () => void };
  duration: number;
}

interface ToastStore {
  toasts: Toast[];
  push(t: Omit<Toast, 'id' | 'tone' | 'duration'> & { tone?: ToastTone; duration?: number }): number;
  dismiss(id: number): void;
}

let nextId = 1;

export const useToasts = create<ToastStore>()((set) => ({
  toasts: [],
  push(input) {
    const id = nextId++;
    const toast: Toast = {
      id,
      message: input.message,
      detail: input.detail,
      tone: input.tone ?? 'default',
      action: input.action,
      // Give people time to reach an Undo before it disappears.
      duration: input.duration ?? (input.action ? 7000 : 4000),
    };
    set((s) => ({ toasts: [...s.toasts, toast] }));
    return id;
  },
  dismiss(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));

/** Convenience helpers so callers never touch the store shape. */
export const toast = {
  show: (message: string, detail?: string) => useToasts.getState().push({ message, detail }),
  saved: (message: string, action?: Toast['action']) =>
    useToasts.getState().push({ message, tone: 'positive', action }),
  error: (message: string, detail?: string) =>
    useToasts.getState().push({ message, detail, tone: 'negative', duration: 6000 }),
  warn: (message: string, detail?: string) =>
    useToasts.getState().push({ message, detail, tone: 'warn' }),
};

export function Toaster() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 px-4 pb-[calc(env(safe-area-inset-bottom,0px)+5.5rem)] sm:items-end sm:pr-6 sm:pb-6"
      role="region"
      aria-live="polite"
      aria-label="Notifications"
    >
      {toasts.map((t) => (
        <ToastRow key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
      ))}
    </div>
  );
}

function ToastRow({ toast: t, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  React.useEffect(() => {
    const timer = window.setTimeout(onDismiss, t.duration);
    return () => window.clearTimeout(timer);
  }, [t.duration, onDismiss]);

  const accent = {
    default: 'border-l-ink-3',
    positive: 'border-l-positive',
    negative: 'border-l-negative',
    warn: 'border-l-warn',
  }[t.tone];

  return (
    <div
      className={cn(
        'pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-[--radius] border border-l-[3px]',
        'border-line bg-surface px-4 py-3 shadow-[var(--shadow-lg)]',
        'motion-safe:animate-[toast-in_240ms_cubic-bezier(0.22,1,0.36,1)]',
        accent,
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="text-[0.8125rem] font-medium text-ink">{t.message}</p>
        {t.detail && <p className="mt-0.5 text-xs leading-relaxed text-ink-3">{t.detail}</p>}
      </div>

      {t.action && (
        <button
          onClick={() => {
            t.action!.run();
            onDismiss();
          }}
          className="shrink-0 rounded-[7px] px-2 py-1 text-[0.8125rem] font-semibold text-accent transition-colors hover:bg-accent-soft"
        >
          {t.action.label}
        </button>
      )}

      <button
        onClick={onDismiss}
        aria-label="Dismiss"
        className="-mr-1 shrink-0 rounded p-1 text-ink-4 transition-colors hover:text-ink"
      >
        <svg viewBox="0 0 24 24" className="size-3.5" fill="none" aria-hidden="true">
          <path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      </button>

      <style>{`@keyframes toast-in{from{opacity:0;transform:translateY(8px) scale(0.98)}to{opacity:1;transform:none}}`}</style>
    </div>
  );
}
