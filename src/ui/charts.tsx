/**
 * Charts, kept deliberately few.
 *
 * The brief asks for useful information over decorative charts, so this file
 * holds only shapes that answer a question a number cannot: a direction over
 * time, a proportion between parts, a comparison across months. Anything a
 * figure states more precisely is left as a figure.
 */

import * as React from 'react';
import { cn } from './cn';
import { formatMoney } from '../core/money';
import { formatDate, formatMonthShort, type CalendarDate } from '../core/dates';

// ---------------------------------------------------------------------------
// Sparkline — direction over time, no axes
// ---------------------------------------------------------------------------

export function Sparkline({
  values,
  className,
  height = 40,
  tone = 'accent',
  fill = true,
}: {
  values: number[];
  className?: string;
  height?: number;
  tone?: 'accent' | 'positive' | 'negative';
  fill?: boolean;
}) {
  const id = React.useId();
  if (values.length < 2) return <div className={className} style={{ height }} />;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const w = 100;
  const pad = 2;

  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = height - pad - ((v - min) / span) * (height - pad * 2);
    return [x, y] as const;
  });

  const line = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
  const area = `${line} L${w},${height} L0,${height} Z`;
  const stroke = { accent: 'var(--accent)', positive: 'var(--positive)', negative: 'var(--negative)' }[tone];

  return (
    <svg
      viewBox={`0 0 ${w} ${height}`}
      preserveAspectRatio="none"
      className={cn('w-full', className)}
      style={{ height }}
      aria-hidden="true"
    >
      {fill && (
        <>
          <defs>
            <linearGradient id={`spark-${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity="0.18" />
              <stop offset="100%" stopColor={stroke} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#spark-${id})`} />
        </>
      )}
      <path
        d={line}
        fill="none"
        stroke={stroke}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Proportion bar — one bar, many parts
// ---------------------------------------------------------------------------

export interface Slice {
  key: string;
  label: string;
  amount: number;
  color: string | null;
}

export function ProportionBar({
  slices,
  currency,
  hidden,
  className,
}: {
  slices: Slice[];
  currency?: string;
  hidden?: boolean;
  className?: string;
}) {
  const total = slices.reduce((s, x) => s + x.amount, 0);
  if (total <= 0) return null;

  return (
    <div className={cn('flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full', className)}>
      {slices.map((s) => (
        <div
          key={s.key}
          className="h-full first:rounded-l-full last:rounded-r-full transition-[width] duration-500"
          style={{
            width: `${(s.amount / total) * 100}%`,
            background: s.color ?? 'var(--ink-4)',
          }}
          title={hidden ? s.label : `${s.label} — ${formatMoney(s.amount, currency)}`}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Category bars — the spending breakdown
// ---------------------------------------------------------------------------

export function CategoryBars({
  slices,
  currency,
  hidden,
  max,
  onSelect,
}: {
  slices: Slice[];
  currency?: string;
  hidden?: boolean;
  max?: number;
  onSelect?: (key: string) => void;
}) {
  const peak = max ?? Math.max(...slices.map((s) => s.amount), 1);

  return (
    <ul className="space-y-2.5">
      {slices.map((s) => {
        const Tag = onSelect ? 'button' : 'div';
        return (
          <li key={s.key}>
            <Tag
              {...(onSelect ? { onClick: () => onSelect(s.key), type: 'button' as const } : {})}
              className={cn('w-full text-left', onSelect && 'group')}
            >
              <div className="mb-1.5 flex items-baseline justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2 text-[0.8125rem] text-ink-2 group-hover:text-ink">
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ background: s.color ?? 'var(--ink-4)' }}
                    aria-hidden="true"
                  />
                  <span className="truncate">{s.label}</span>
                </span>
                <span className="tnum shrink-0 text-[0.8125rem] text-ink">
                  {hidden ? '••••' : formatMoney(s.amount, currency, { trimZeroDecimals: true })}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-sunken">
                <div
                  className="h-full rounded-full transition-[width] duration-500 ease-out"
                  style={{
                    width: `${Math.max(2, (s.amount / peak) * 100)}%`,
                    background: s.color ?? 'var(--ink-4)',
                  }}
                />
              </div>
            </Tag>
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Paired bars — income against expenses, month by month
// ---------------------------------------------------------------------------

export function IncomeExpenseBars({
  data,
  currency,
  hidden,
  height = 132,
}: {
  data: Array<{ date: CalendarDate; income: number; expenses: number }>;
  currency?: string;
  hidden?: boolean;
  height?: number;
}) {
  const peak = Math.max(...data.flatMap((d) => [d.income, d.expenses]), 1);

  return (
    <div className="flex items-end gap-2" style={{ height }}>
      {data.map((d) => (
        <div key={d.date} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
          <div className="flex h-full w-full items-end justify-center gap-[3px]">
            <div
              className="w-full max-w-[13px] rounded-t-[3px] bg-positive-fill/85 transition-[height] duration-500"
              style={{ height: `${Math.max(2, (d.income / peak) * 100)}%` }}
              title={hidden ? 'Income' : `Income ${formatMoney(d.income, currency)}`}
            />
            <div
              className="w-full max-w-[13px] rounded-t-[3px] bg-negative-fill/75 transition-[height] duration-500"
              style={{ height: `${Math.max(2, (d.expenses / peak) * 100)}%` }}
              title={hidden ? 'Expenses' : `Expenses ${formatMoney(d.expenses, currency)}`}
            />
          </div>
          <span className="tnum text-[0.625rem] text-ink-4">{formatMonthShort(d.date)}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Daily spend — a column per day
// ---------------------------------------------------------------------------

export function DailyBars({
  data,
  currency,
  hidden,
  height = 96,
  average,
}: {
  data: Array<{ date: CalendarDate; amount: number }>;
  currency?: string;
  hidden?: boolean;
  height?: number;
  average?: number;
}) {
  const peak = Math.max(...data.map((d) => d.amount), 1);

  return (
    <div className="relative" style={{ height }}>
      {average != null && average > 0 && (
        <div
          className="absolute inset-x-0 border-t border-dashed border-ink-4/50"
          style={{ bottom: `${(average / peak) * 100}%` }}
          aria-hidden="true"
        >
          <span className="tnum absolute -top-4 end-0 text-[0.625rem] text-ink-4">
            avg {hidden ? '••' : formatMoney(average, currency, { compact: true, symbol: false })}
          </span>
        </div>
      )}
      <div className="flex h-full items-end gap-px">
        {data.map((d) => (
          <div
            key={d.date}
            className={cn(
              'flex-1 rounded-t-[2px] transition-[height] duration-300',
              d.amount > 0 ? 'bg-accent-fill/70 hover:bg-accent-fill' : 'bg-line',
            )}
            style={{ height: d.amount > 0 ? `${Math.max(3, (d.amount / peak) * 100)}%` : '2px' }}
            title={
              hidden
                ? formatDate(d.date, 'short')
                : `${formatDate(d.date, 'short')} — ${formatMoney(d.amount, currency)}`
            }
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Net worth over time — a filled line with a zero baseline
// ---------------------------------------------------------------------------

export function NetWorthChart({
  data,
  currency,
  hidden,
  height = 168,
}: {
  data: Array<{ date: CalendarDate; net: number }>;
  currency?: string;
  hidden?: boolean;
  height?: number;
}) {
  const id = React.useId();
  if (data.length < 2) return null;

  const values = data.map((d) => d.net);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  const span = max - min || 1;
  const w = 300;
  const padY = 10;

  const y = (v: number) => height - padY - ((v - min) / span) * (height - padY * 2);
  const points = values.map((v, i) => [(i / (values.length - 1)) * w, y(v)] as const);
  const line = points.map(([px, py], i) => `${i === 0 ? 'M' : 'L'}${px.toFixed(1)},${py.toFixed(1)}`).join(' ');
  const zeroY = y(0);

  return (
    <div>
      <svg
        viewBox={`0 0 ${w} ${height}`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height }}
        aria-label="Net worth over time"
      >
        <defs>
          <linearGradient id={`nw-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.2" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {min < 0 && (
          <line
            x1="0"
            x2={w}
            y1={zeroY}
            y2={zeroY}
            stroke="var(--line-strong)"
            strokeWidth="1"
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
          />
        )}

        <path d={`${line} L${w},${zeroY} L0,${zeroY} Z`} fill={`url(#nw-${id})`} />
        <path
          d={line}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        <circle cx={points[points.length - 1][0]} cy={points[points.length - 1][1]} r="3" fill="var(--accent)" />
      </svg>

      <div className="mt-2 flex justify-between">
        <span className="tnum text-[0.625rem] text-ink-4">{formatMonthShort(data[0].date)}</span>
        <span className="tnum text-[0.625rem] text-ink-4">
          {hidden ? '••••' : formatMoney(values[values.length - 1], currency, { compact: true })}
        </span>
      </div>
    </div>
  );
}
