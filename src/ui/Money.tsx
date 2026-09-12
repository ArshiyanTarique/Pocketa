/**
 * How Pocketa renders a number.
 *
 * Every monetary figure in the app goes through this component, which means
 * every figure is monospaced, tabular, and column-alignable. That single rule
 * is the product's visual signature: a column of amounts in Pocketa lines up
 * the way a column of amounts in a ledger lines up.
 *
 * It also means there is exactly one place that decides how money looks, so
 * "hide amounts" and currency formatting are enforced everywhere at once.
 */

import * as React from 'react';
import { animate } from 'motion';
import { formatMoney, type FormatOptions } from '../core/money';
import { cn } from './cn';

export type AmountTone = 'default' | 'positive' | 'negative' | 'muted' | 'auto';

export interface MoneyProps extends FormatOptions {
  /** Minor units. Always minor units. */
  value: number;
  currency?: string;
  /** 'auto' colours by sign; the rest are explicit. */
  tone?: AmountTone;
  size?: 'xs' | 'sm' | 'base' | 'lg' | 'xl' | 'display';
  weight?: 'normal' | 'medium' | 'semibold';
  /** Replace digits with dots, for the privacy toggle. */
  hidden?: boolean;
  className?: string;
  title?: string;
  /**
   * Count from the previous value to the new one when it changes in place.
   * On by default for the large figures, where a jump reads as a glitch;
   * off in rows, where the number is new each time anyway.
   */
  animate?: boolean;
}

const SIZES: Record<NonNullable<MoneyProps['size']>, string> = {
  xs: 'text-[0.6875rem]',
  sm: 'text-[0.8125rem]',
  base: 'text-[0.9375rem]',
  lg: 'text-lg',
  xl: 'text-2xl',
  display: 'text-[2.5rem] sm:text-[3.25rem] leading-[0.95] tracking-[-0.035em]',
};

const WEIGHTS = {
  normal: 'font-normal',
  medium: 'font-medium',
  semibold: 'font-semibold',
} as const;

export function Money(props: MoneyProps) {
  const animated = props.animate ?? (props.size === 'display' || props.size === 'xl');
  // Two components so the thousands of row figures never mount an effect.
  return animated && !props.hidden ? <CountingMoney {...props} /> : <StaticMoney {...props} />;
}

function CountingMoney(props: MoneyProps) {
  const shown = useCountUp(props.value);
  return <StaticMoney {...props} value={shown} title={props.title ?? formatMoney(props.value, props.currency, props)} />;
}

/**
 * Follows `target` with a 400ms ease-out whenever it changes; the first value
 * is shown as is, since the entrance is the `.count-in` keyframe's job.
 */
function useCountUp(target: number): number {
  const [shown, setShown] = React.useState(target);
  const previous = React.useRef(target);

  React.useEffect(() => {
    const from = previous.current;
    previous.current = target;
    if (from === target) return;
    const reduce =
      typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    // With reduced motion the tween is zero-length: the same path, no count.
    const controls = animate(from, target, {
      duration: reduce ? 0 : 0.4,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => setShown(Math.round(v)),
      onComplete: () => setShown(target),
    });
    return () => controls.stop();
  }, [target]);

  return shown;
}

function StaticMoney({
  value,
  currency,
  tone = 'default',
  size = 'base',
  weight = 'normal',
  hidden = false,
  className,
  title,
  animate: _animate,
  ...format
}: MoneyProps) {
  void _animate;
  const resolvedTone =
    tone === 'auto' ? (value > 0 ? 'positive' : value < 0 ? 'negative' : 'muted') : tone;

  const toneClass = {
    default: 'text-ink',
    positive: 'text-positive',
    negative: 'text-negative',
    muted: 'text-ink-3',
  }[resolvedTone];

  const text = formatMoney(value, currency, format);

  return (
    <span
      className={cn('tnum whitespace-nowrap', SIZES[size], WEIGHTS[weight], toneClass, className)}
      title={title ?? (hidden ? undefined : text)}
      aria-label={hidden ? 'Amount hidden' : text}
    >
      {hidden ? mask(text) : text}
    </span>
  );
}

/** Keep the shape of the figure so layouts do not jump when amounts are hidden. */
function mask(text: string): string {
  return text.replace(/[0-9]/g, '•');
}

/**
 * A number that is not money — counts, percentages, days. Still tabular, so it
 * sits correctly beside amounts in the same column.
 */
export function Num({
  children,
  className,
  size = 'base',
}: {
  children: React.ReactNode;
  className?: string;
  size?: NonNullable<MoneyProps['size']>;
}) {
  return <span className={cn('tnum', SIZES[size], className)}>{children}</span>;
}

export function Percent({
  value,
  className,
  size = 'base',
  digits = 0,
}: {
  /** A fraction: 0.42 renders as 42%. */
  value: number | null;
  className?: string;
  size?: NonNullable<MoneyProps['size']>;
  digits?: number;
}) {
  if (value == null || !Number.isFinite(value)) {
    return <span className={cn('tnum text-ink-4', SIZES[size], className)}>—</span>;
  }
  return (
    <span className={cn('tnum', SIZES[size], className)}>
      {(value * 100).toFixed(digits)}%
    </span>
  );
}
