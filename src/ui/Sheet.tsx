import * as React from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { cn } from './cn';
import { Button, IconButton } from './primitives';

/**
 * One overlay component, three presentations.
 *
 * The product used to put everything — every detail, every edit, every
 * confirmation — in a modal over a dimmed page. Forty-three of them. You lost
 * your place every time, and on a wide screen the list you came from sat there
 * greyed out while the thing you tapped floated in the middle.
 *
 * So the same component now chooses how to present itself:
 *
 *   **panel**  — on a wide screen, a column that slides in from the right and
 *                sits beside the page. The page stays live: you can scroll the
 *                list and tap another row, and the panel follows. Not modal.
 *   **sheet**  — on a phone, rises from the bottom under the thumb. Modal.
 *   **dialog** — centred and modal, for the few things that must interrupt:
 *                confirmations, destructive actions.
 *
 * `presentation="auto"` (the default) picks panel or sheet by viewport, which
 * is what nearly every caller wants. `Confirm` asks for a dialog explicitly.
 */

export type Presentation = 'auto' | 'panel' | 'sheet' | 'dialog';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Wider layout for import previews and detail views. */
  size?: 'md' | 'lg' | 'xl';
  /** Prevent accidental dismissal when a form has unsaved input. */
  dismissable?: boolean;
  presentation?: Presentation;
}

const PANEL_QUERY = '(min-width: 1024px)';

export function useIsWide(): boolean {
  const [wide, setWide] = React.useState(
    () => typeof window !== 'undefined' && window.matchMedia(PANEL_QUERY).matches,
  );
  React.useEffect(() => {
    const mq = window.matchMedia(PANEL_QUERY);
    const onChange = () => setWide(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return wide;
}

/**
 * How many panels are open, so the page can make room rather than be covered.
 * The shell reads this and pads its right edge.
 */
export const usePanelState = create<{ open: number; add(): void; remove(): void }>()((set) => ({
  open: 0,
  add: () => set((s) => ({ open: s.open + 1 })),
  remove: () => set((s) => ({ open: Math.max(0, s.open - 1) })),
}));

export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  dismissable = true,
  presentation = 'auto',
}: SheetProps) {
  const wide = useIsWide();
  const mode: Exclude<Presentation, 'auto'> =
    presentation === 'auto' ? (wide ? 'panel' : 'sheet') : presentation;
  const modal = mode !== 'panel';

  const panelRef = React.useRef<HTMLDivElement>(null);
  const previouslyFocused = React.useRef<Element | null>(null);

  // Tell the shell a panel is open, so the page shifts instead of hiding.
  const add = usePanelState((s) => s.add);
  const remove = usePanelState((s) => s.remove);
  React.useEffect(() => {
    if (!open || mode !== 'panel') return;
    add();
    return () => remove();
  }, [open, mode, add, remove]);

  React.useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement;
    const { overflow } = document.body.style;
    if (modal) document.body.style.overflow = 'hidden';

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && dismissable) {
        e.stopPropagation();
        onClose();
        return;
      }
      // Only a modal traps focus. A panel is part of the page.
      if (!modal || e.key !== 'Tab' || !panelRef.current) return;
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    // A panel closes when you click the page, but the click still lands —
    // tapping another row swaps the panel's contents rather than just
    // dismissing it.
    function onPointerDown(e: PointerEvent) {
      if (modal || !dismissable || !panelRef.current) return;
      const target = e.target as Node;
      if (panelRef.current.contains(target)) return;
      // Anything inside another portal (a toast, a nested dialog) is not "the page".
      if ((target as HTMLElement).closest?.('[data-overlay]')) return;
      onClose();
    }

    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    const timer = window.setTimeout(() => {
      const target = panelRef.current?.querySelector<HTMLElement>(
        '[data-autofocus],input:not([type="hidden"]),textarea,select,button',
      );
      target?.focus({ preventScroll: true });
    }, 60);

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
      if (modal) document.body.style.overflow = overflow;
      window.clearTimeout(timer);
      (previouslyFocused.current as HTMLElement | null)?.focus?.({ preventScroll: true });
    };
  }, [open, onClose, dismissable, modal]);

  if (!open) return null;

  const widths = { md: 'sm:max-w-lg', lg: 'sm:max-w-2xl', xl: 'sm:max-w-4xl' };
  const panelWidths = { md: 'w-[26rem]', lg: 'w-[32rem]', xl: 'w-[40rem]' };

  const header = title && (
    <header className="flex items-start justify-between gap-4 px-5 pb-3 pt-4 sm:px-6 sm:pt-5">
      <div className="min-w-0">
        <h2 className="display text-[1.125rem]">{title}</h2>
        {description && <p className="mt-1 text-[0.8125rem] text-ink-3">{description}</p>}
      </div>
      {dismissable && (
        <IconButton label="Close" onClick={onClose} className="-mr-1.5 -mt-1">
          <svg viewBox="0 0 24 24" className="size-4.5" fill="none" aria-hidden="true">
            <path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </IconButton>
      )}
    </header>
  );

  const body = <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 sm:px-6">{children}</div>;

  const foot = footer && (
    <footer className="safe-bottom border-t border-line bg-surface px-5 py-3.5 sm:px-6">{footer}</footer>
  );

  if (mode === 'panel') {
    return createPortal(
      <aside
        ref={panelRef}
        data-overlay
        role="complementary"
        aria-label={title}
        className={cn(
          'fixed inset-y-0 right-0 z-40 flex max-w-[100vw] flex-col border-l border-line bg-surface shadow-[var(--shadow-lg)]',
          'motion-safe:animate-[panel-in_260ms_cubic-bezier(0.22,1,0.36,1)]',
          panelWidths[size],
        )}
      >
        {header}
        {body}
        {foot}
        <style>{`@keyframes panel-in{from{opacity:0;transform:translateX(12px)}to{opacity:1;transform:none}}`}</style>
      </aside>,
      document.body,
    );
  }

  return createPortal(
    <div
      data-overlay
      className={cn(
        'fixed inset-0 z-50 flex justify-center',
        mode === 'dialog' ? 'items-center p-4 sm:p-6' : 'items-end sm:items-center sm:p-6',
      )}
    >
      <div
        className="absolute inset-0 bg-[rgb(15_17_20/0.45)] backdrop-blur-[2px] fade-in"
        onClick={dismissable ? onClose : undefined}
        aria-hidden="true"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          'relative flex max-h-[92dvh] w-full flex-col bg-surface shadow-[var(--shadow-lg)]',
          mode === 'dialog'
            ? 'rounded-[--radius-xl] sm:max-w-md motion-safe:animate-[dialog-in_200ms_cubic-bezier(0.22,1,0.36,1)]'
            : cn('rounded-t-[--radius-xl] sm:rounded-[--radius-xl] motion-safe:animate-[sheet-up_260ms_cubic-bezier(0.22,1,0.36,1)]', widths[size]),
        )}
      >
        {mode === 'sheet' && (
          <div className="flex justify-center pt-2.5 sm:hidden" aria-hidden="true">
            <div className="h-1 w-9 rounded-full bg-line-strong" />
          </div>
        )}
        {header}
        {body}
        {foot}
      </div>

      <style>{`@keyframes sheet-up{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}@keyframes dialog-in{from{opacity:0;transform:scale(.98)}to{opacity:1;transform:none}}`}</style>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// Confirmation
// ---------------------------------------------------------------------------

export interface ConfirmProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  body?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
  /** Require the user to type this exact word. For irreversible actions. */
  requirePhrase?: string;
}

/**
 * Destructive actions require deliberate confirmation, and the genuinely
 * irreversible ones (restoring over a ledger, erasing everything) require the
 * user to type a phrase — a speed bump proportional to the consequence.
 *
 * Always a dialog: this is the one case where interrupting is the point.
 */
export function Confirm({
  open,
  onClose,
  onConfirm,
  title,
  body,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'default',
  requirePhrase,
}: ConfirmProps) {
  const [typed, setTyped] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (open) setTyped('');
  }, [open]);

  const unlocked = !requirePhrase || typed.trim().toUpperCase() === requirePhrase.toUpperCase();

  async function run() {
    setBusy(true);
    try {
      await onConfirm();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      size="md"
      presentation="dialog"
      footer={
        <div className="flex gap-2.5">
          <Button variant="secondary" full onClick={onClose} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            full
            onClick={run}
            disabled={!unlocked}
            loading={busy}
          >
            {confirmLabel}
          </Button>
        </div>
      }
    >
      {body && <div className="text-sm leading-relaxed text-ink-2">{body}</div>}

      {requirePhrase && (
        <div className="mt-4">
          <label htmlFor="confirm-phrase" className="text-[0.8125rem] font-medium text-ink-2">
            Type <span className="tnum font-semibold text-ink">{requirePhrase}</span> to continue
          </label>
          <input
            id="confirm-phrase"
            data-autofocus
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            className={cn(
              'mt-1.5 h-11 w-full rounded-[--radius] border bg-surface px-3 text-sm text-ink',
              'focus:border-accent focus:outline-none focus:ring-[3px] focus:ring-[color-mix(in_srgb,var(--accent)_18%,transparent)]',
              unlocked && typed ? 'border-positive' : 'border-line-strong',
            )}
          />
        </div>
      )}
    </Sheet>
  );
}
