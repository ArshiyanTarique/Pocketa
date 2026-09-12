import * as React from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from './cn';
import { useFieldLabelId } from './fieldContext';
import { Link } from '../app/router';

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

export function Card({
  className,
  children,
  as: As = 'section',
  ...rest
}: React.HTMLAttributes<HTMLElement> & { as?: React.ElementType }) {
  return (
    <As className={cn('card overflow-hidden', className)} {...rest}>
      {children}
    </As>
  );
}

/**
 * Kept for the screens that still use it. The eyebrow is rendered in the
 * display face now, and the title sits tighter, but the shape is unchanged so
 * nothing downstream has to move.
 */
export function CardHeader({
  title,
  eyebrow,
  action,
  className,
}: {
  title: React.ReactNode;
  eyebrow?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-start justify-between gap-4 px-4 pt-3.5 pb-2.5 sm:px-5', className)}>
      <div className="min-w-0">
        {eyebrow && <p className="label mb-1">{eyebrow}</p>}
        <h2 className="truncate text-[0.9375rem] font-semibold text-ink">{title}</h2>
      </div>
      {action && (
        <div className="-mr-1 -mt-1 shrink-0 [&_a]:inline-flex [&_a]:min-h-9 [&_a]:items-center [&_a]:px-1">
          {action}
        </div>
      )}
    </div>
  );
}

/**
 * A section heading that is not inside a card.
 *
 * The old design put every group of content in a white card with an eyebrow,
 * a title and a sentence. Ten screens of that reads as one screen ten times.
 * This is the replacement: one bold label in the display face, and a chevron
 * that says where tapping takes you. No sentence.
 */
export function SectionLabel({
  children,
  to,
  onClick,
  action,
  count,
  className,
}: {
  children: React.ReactNode;
  /** Where the whole heading links to. Renders a chevron. */
  to?: string;
  onClick?: () => void;
  /** Something on the right that is not a link, e.g. a total. */
  action?: React.ReactNode;
  /** A small figure beside the label — how many, how much. */
  count?: React.ReactNode;
  className?: string;
}) {
  const body = (
    <>
      <span className="display text-[1.0625rem]">{children}</span>
      {count != null && <span className="tnum ml-2 text-[0.8125rem] text-ink-3">{count}</span>}
      {(to || onClick) && (
        <ChevronRight className="ml-auto size-4 text-ink-4 transition-transform group-hover:translate-x-0.5" />
      )}
    </>
  );

  const shared = 'group flex min-h-9 items-center px-1';

  return (
    <div className={cn('flex items-center justify-between gap-3', className)}>
      {to ? (
        <Link to={to} className={cn(shared, 'flex-1 rounded-[--radius] hover:bg-surface-2')}>
          {body}
        </Link>
      ) : onClick ? (
        <button type="button" onClick={onClick} className={cn(shared, 'flex-1 rounded-[--radius] text-left hover:bg-surface-2')}>
          {body}
        </button>
      ) : (
        <div className={cn(shared, 'flex-1')}>{body}</div>
      )}
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/**
 * A compact figure with a label above it. Three of these in a row replace a
 * paragraph about the month.
 */
export function Tile({
  label,
  children,
  tone = 'default',
  onClick,
  className,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  tone?: 'default' | 'positive' | 'negative' | 'accent';
  onClick?: () => void;
  className?: string;
}) {
  const Tag = onClick ? 'button' : 'div';
  const tones = {
    default: '',
    positive: '[&_.tnum]:text-positive',
    negative: '[&_.tnum]:text-negative',
    accent: '[&_.tnum]:text-accent',
  };
  return (
    <Tag
      {...(onClick ? { onClick, type: 'button' as const } : {})}
      className={cn(
        'card flex min-w-0 flex-col gap-1 px-3.5 py-3 text-left',
        onClick && 'transition-transform hover:-translate-y-px active:translate-y-0',
        tones[tone],
        className,
      )}
    >
      <span className="label">{label}</span>
      <span className="truncate">{children}</span>
    </Tag>
  );
}

/**
 * A row that opens in place.
 *
 * The alternative — tap a row, a sheet slides over everything — loses the
 * list you were reading. Opening in place keeps the row where it was and lets
 * the detail come out of it, so the relationship between the two is visible.
 * The height animates through a CSS grid track, which needs no measuring and
 * no JavaScript in the frame.
 */
export function ExpandingRow({
  open,
  onToggle,
  summary,
  children,
  className,
  detailClassName,
  leading,
  trailing,
  tone,
}: {
  open: boolean;
  onToggle: () => void;
  /** The always-visible line. */
  summary: React.ReactNode;
  /** What is revealed. */
  children: React.ReactNode;
  className?: string;
  detailClassName?: string;
  leading?: React.ReactNode;
  /** Sits before the chevron; a figure, usually. */
  trailing?: React.ReactNode;
  /** A 3px stripe on the left, for a state that colours the whole row. */
  tone?: 'positive' | 'negative' | 'warn' | 'accent' | null;
}) {
  const id = React.useId();
  const stripes = {
    positive: 'border-l-positive-fill',
    negative: 'border-l-negative-fill',
    warn: 'border-l-warn-fill',
    accent: 'border-l-accent-fill',
  };
  return (
    <div className={cn('border-l-[3px]', tone ? stripes[tone] : 'border-l-transparent', className)}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={id}
        className={cn(
          'flex min-h-12 w-full items-center gap-3 px-3 py-2.5 text-left transition-colors',
          open ? 'bg-surface-2/60' : 'hover:bg-surface-2/60',
        )}
      >
        {leading}
        <span className="min-w-0 flex-1">{summary}</span>
        {trailing && <span className="shrink-0">{trailing}</span>}
        <ChevronRight
          className={cn('size-4 shrink-0 text-ink-4 transition-transform duration-200', open && 'rotate-90')}
          aria-hidden="true"
        />
      </button>
      <div id={id} className="disclose" data-open={open || undefined}>
        <div>
          <div className={cn('px-3 pb-4 pt-1', detailClassName)}>{children}</div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'quiet';
type ButtonSize = 'sm' | 'md' | 'lg';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  // The gold of a 5000 note, with ink on it. Reads as money, not as "submit".
  primary:
    'bg-accent-fill text-[--accent-ink] hover:bg-accent-hover active:scale-[0.985] shadow-[var(--shadow-sm)]',
  secondary:
    'bg-surface text-ink border border-line-strong hover:bg-surface-2 active:scale-[0.985]',
  ghost: 'text-ink-2 hover:text-ink hover:bg-surface-2',
  danger: 'bg-negative-fill text-white hover:opacity-90 active:scale-[0.985]',
  quiet: 'text-accent hover:bg-accent-soft',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  // The coarse-pointer bump keeps desktop density as designed while giving a
  // finger a target it can actually hit.
  sm: 'h-8 [@media(pointer:coarse)]:h-9 px-3 text-[0.8125rem] rounded-[--radius-sm] gap-1.5',
  md: 'h-10 px-4 text-sm rounded-[--radius] gap-2',
  lg: 'h-12 px-5 text-[0.9375rem] rounded-[--radius] gap-2',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: React.ReactNode;
  full?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, icon, full, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center font-semibold transition-all duration-150',
        'disabled:opacity-45 disabled:pointer-events-none select-none',
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        full && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner className="size-4" /> : icon}
      {children}
    </button>
  );
});

export function IconButton({
  label,
  className,
  children,
  ...rest
}: ButtonProps & { label: string }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex size-9 items-center justify-center rounded-[--radius] text-ink-2',
        'transition-colors hover:bg-surface-2 hover:text-ink active:scale-95',
        'disabled:opacity-40 disabled:pointer-events-none',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn('animate-spin', className)} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.2" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Badge / Pill
// ---------------------------------------------------------------------------

export type BadgeTone = 'neutral' | 'accent' | 'positive' | 'negative' | 'warn' | 'info';

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: 'bg-surface-2 text-ink-2 border-line',
  accent: 'bg-accent-soft text-accent border-transparent',
  positive: 'bg-positive-soft text-positive border-transparent',
  negative: 'bg-negative-soft text-negative border-transparent',
  warn: 'bg-warn-soft text-warn border-transparent',
  info: 'bg-info-soft text-info border-transparent',
};

export function Badge({
  tone = 'neutral',
  children,
  className,
  icon,
  title,
}: {
  tone?: BadgeTone;
  children: React.ReactNode;
  className?: string;
  icon?: React.ReactNode;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5',
        'text-[0.6875rem] font-semibold leading-[1.4] whitespace-nowrap',
        BADGE_TONES[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

export function Progress({
  value,
  tone = 'accent',
  className,
  label,
  /** Draws a tick at this fraction, e.g. how far through the period we are. */
  marker,
  markerLabel,
}: {
  value: number;
  tone?: 'accent' | 'positive' | 'warn' | 'negative';
  className?: string;
  label?: string;
  marker?: number;
  markerLabel?: string;
}) {
  const pct = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  const over = value > 1;
  const colors = {
    accent: 'bg-accent-fill',
    positive: 'bg-positive-fill',
    warn: 'bg-warn-fill',
    negative: 'bg-negative-fill',
  };

  return (
    <div
      className={cn('relative h-1.5 w-full overflow-hidden rounded-full bg-sunken', className)}
      role="progressbar"
      aria-valuenow={Math.round(pct * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div
        className={cn('h-full rounded-full transition-[width] duration-500 ease-out', colors[tone])}
        style={{ width: `${pct * 100}%` }}
      />
      {over && <div className="absolute inset-y-0 right-0 w-1 bg-negative-fill" aria-hidden="true" />}
      {marker != null && marker > 0 && marker < 1 && (
        <div
          className="absolute inset-y-0 w-px bg-ink"
          style={{ left: `${marker * 100}%` }}
          aria-hidden="true"
          title={markerLabel}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty and loading states
// ---------------------------------------------------------------------------

/**
 * An empty space is an invitation to act, not an essay. One line and, where
 * there is something to do, one button. The `body` is still accepted for the
 * few places that genuinely need a second line, and is otherwise dropped.
 */
export function EmptyState({
  icon,
  title,
  body,
  action,
  className,
  compact,
}: {
  icon?: React.ReactNode;
  title: string;
  body?: string;
  action?: React.ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact ? 'px-4 py-6' : 'px-6 py-10',
        className,
      )}
    >
      {icon && (
        <div className="mb-3 flex size-10 items-center justify-center rounded-[--radius] bg-surface-2 text-ink-3">
          {icon}
        </div>
      )}
      <h3 className="text-[0.9375rem] font-semibold text-ink">{title}</h3>
      {body && !compact && (
        <p className="mt-1 max-w-[36ch] text-[0.8125rem] leading-snug text-ink-3">{body}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn('animate-pulse rounded-[--radius-sm] bg-surface-2', className)}
      aria-hidden="true"
    />
  );
}

export function SkeletonRows({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('space-y-3', className)} aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="size-9 rounded-[--radius]" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-2.5 w-1/4" />
          </div>
          <Skeleton className="h-3.5 w-16" />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Segmented control
// ---------------------------------------------------------------------------

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
  size = 'md',
  label,
}: {
  options: Array<{ value: T; label: React.ReactNode; title?: string }>;
  value: T;
  onChange: (v: T) => void;
  className?: string;
  size?: 'sm' | 'md';
  label?: string;
}) {
  // A tablist is not a labelable element, so a `<label for>` cannot reach it.
  // When one of these sits inside a `Field`, point at that label instead.
  const fieldLabelId = useFieldLabelId();

  // The active pill slides between options rather than appearing under the
  // new one, so a change reads as a move. Measured from the buttons
  // themselves, so it is right for any label length and any font.
  const trackRef = React.useRef<HTMLDivElement>(null);
  const [pill, setPill] = React.useState<{ x: number; w: number } | null>(null);
  React.useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const measure = () => {
      const el = track.querySelector<HTMLElement>('[aria-selected="true"]');
      if (!el) return setPill(null);
      setPill({ x: el.offsetLeft, w: el.offsetWidth });
    };
    measure();
    // Absent in test environments; the pill then sits where it was measured.
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(track);
    return () => ro.disconnect();
  }, [value, options.length]);

  return (
    <div
      ref={trackRef}
      className={cn(
        'relative inline-flex items-center gap-0.5 rounded-full border border-line bg-surface-2 p-0.5',
        className,
      )}
      role="tablist"
      aria-label={label}
      aria-labelledby={!label ? fieldLabelId : undefined}
    >
      {pill && (
        <span
          aria-hidden="true"
          className="absolute top-0.5 bottom-0.5 rounded-full bg-ink shadow-[var(--shadow-sm)] transition-[transform,width] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]"
          style={{ width: pill.w, left: 0, transform: `translateX(${pill.x}px)` }}
        />
      )}
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            role="tab"
            aria-selected={active}
            title={opt.title}
            onClick={() => onChange(opt.value)}
            className={cn(
              'relative z-[1] rounded-full font-semibold transition-colors duration-200 whitespace-nowrap',
              size === 'sm'
                ? 'px-3 py-1.5 text-xs [@media(pointer:coarse)]:py-2'
                : 'px-3.5 py-2 text-[0.8125rem]',
              active ? 'text-paper' : 'text-ink-3 hover:text-ink',
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline notice
// ---------------------------------------------------------------------------

/**
 * For things that need attention. Not for explaining how the app works — that
 * is what made the old screens read like documentation. A coloured stripe on
 * the left carries the tone, so the box itself can stay quiet.
 */
export function Notice({
  tone = 'info',
  title,
  children,
  action,
  className,
  icon,
}: {
  tone?: 'info' | 'warn' | 'negative' | 'positive' | 'neutral';
  title?: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  icon?: React.ReactNode;
}) {
  const stripe = {
    info: 'border-l-info-fill',
    warn: 'border-l-warn-fill',
    negative: 'border-l-negative-fill',
    positive: 'border-l-positive-fill',
    neutral: 'border-l-line-strong',
  };
  const iconTone = {
    info: 'text-info',
    warn: 'text-warn',
    negative: 'text-negative',
    positive: 'text-positive',
    neutral: 'text-ink-3',
  };

  return (
    <div
      className={cn(
        'rounded-[--radius] border border-line border-l-[3px] bg-surface px-3.5 py-2.5',
        stripe[tone],
        className,
      )}
      role="status"
    >
      <div className="flex gap-2.5">
        {icon && <span className={cn('mt-px shrink-0', iconTone[tone])}>{icon}</span>}
        <div className="min-w-0 flex-1">
          {title && <p className="text-[0.8125rem] font-semibold text-ink">{title}</p>}
          {children && (
            <div className={cn('text-[0.8125rem] leading-snug text-ink-2', title && 'mt-0.5')}>
              {children}
            </div>
          )}
          {action && <div className="mt-2">{action}</div>}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Row — the workhorse list item
// ---------------------------------------------------------------------------

export function Row({
  leading,
  title,
  subtitle,
  trailing,
  trailingSub,
  onClick,
  className,
  dimmed,
}: {
  leading?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  trailing?: React.ReactNode;
  trailingSub?: React.ReactNode;
  onClick?: () => void;
  className?: string;
  dimmed?: boolean;
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      {...(onClick ? { onClick, type: 'button' as const } : {})}
      className={cn(
        'flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors sm:px-5',
        onClick && 'hover:bg-surface-2 active:bg-surface-2',
        dimmed && 'opacity-55',
        className,
      )}
    >
      {leading}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-ink">{title}</div>
        {subtitle && <div className="mt-0.5 truncate text-xs text-ink-3">{subtitle}</div>}
      </div>
      {(trailing || trailingSub) && (
        <div className="shrink-0 text-right">
          {trailing}
          {trailingSub && <div className="mt-0.5 text-xs text-ink-4">{trailingSub}</div>}
        </div>
      )}
    </Tag>
  );
}

/** A coloured token standing in for a category or account. */
export function Dot({
  color,
  className,
  children,
}: {
  color?: string | null;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        'flex size-9 shrink-0 items-center justify-center rounded-[--radius] text-[0.8125rem] font-semibold',
        className,
      )}
      style={{
        background: color ? `color-mix(in srgb, ${color} 18%, transparent)` : 'var(--surface-2)',
        // The glyph is the category colour pulled halfway to the text colour.
        // The raw hue on a tint of itself only reaches about 2:1; mixing toward
        // --ink clears 4.5:1 and self-corrects in dark mode because --ink flips.
        color: color ? `color-mix(in srgb, ${color} 50%, var(--ink))` : 'var(--ink-3)',
      }}
      aria-hidden="true"
    >
      {children}
    </span>
  );
}
