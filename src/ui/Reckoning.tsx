/**
 * The reckoning strip — Pocketa's signature element.
 *
 * A column of labelled figures, a rule, and a total: the visual grammar of a
 * page being hand-totalled. It exists because several of this product's
 * promises are promises about arithmetic the user is entitled to check —
 * Safe-to-Spend must show its own derivation (R12), a split must visibly total
 * its parent (§12), a refund must show the net (§11).
 *
 * So rather than hide the maths behind a headline number, the maths IS the
 * design. One component, used wherever the app owes an explanation.
 */

import { Money } from './Money';
import { cn } from './cn';

export interface ReckoningLine {
  key: string;
  label: string;
  /** Shown under the label in small type. Optional. */
  detail?: string;
  amount: number;
  /** Renders in the accent colour and heavier weight. */
  emphasis?: boolean;
  onClick?: () => void;
}

export interface ReckoningProps {
  lines: ReckoningLine[];
  total: { label: string; amount: number };
  currency?: string;
  hidden?: boolean;
  /** Show +/− explicitly on every line. Default true — the signs are the point. */
  showSigns?: boolean;
  className?: string;
  size?: 'sm' | 'base';
}

export function Reckoning({
  lines,
  total,
  currency,
  hidden = false,
  showSigns = true,
  className,
  size = 'base',
}: ReckoningProps) {
  return (
    <div className={cn('reckoning', className)} role="table" aria-label={total.label}>
      {lines.map((line) => {
        const Row = line.onClick ? 'button' : 'div';
        return (
          <Row
            key={line.key}
            {...(line.onClick
              ? { onClick: line.onClick, type: 'button' as const }
              : {})}
            className={cn(
              'contents',
              line.onClick && 'cursor-pointer',
            )}
            role="row"
          >
            <span
              role="cell"
              className={cn(
                'text-left',
                size === 'sm' ? 'text-[0.8125rem]' : 'text-sm',
                line.emphasis ? 'font-medium text-ink' : 'text-ink-2',
                line.onClick && 'hover:text-accent transition-colors',
              )}
            >
              {line.label}
              {line.detail && (
                <span className="block text-xs text-ink-4 leading-snug mt-0.5 max-w-[34ch]">
                  {line.detail}
                </span>
              )}
            </span>
            <span role="cell" className="text-right">
              <Money
                value={line.amount}
                currency={currency}
                hidden={hidden}
                size={size === 'sm' ? 'sm' : 'base'}
                sign={showSigns ? 'always' : 'auto'}
                symbol={false}
                tone={line.emphasis ? 'default' : line.amount < 0 ? 'negative' : 'default'}
                weight={line.emphasis ? 'medium' : 'normal'}
              />
            </span>
          </Row>
        );
      })}

      <div className="reckoning-rule reckoning-rule--total" aria-hidden="true" />

      <span className={cn('font-semibold text-ink', size === 'sm' ? 'text-sm' : 'text-[0.9375rem]')}>
        {total.label}
      </span>
      <span className="text-right">
        <Money
          value={total.amount}
          currency={currency}
          hidden={hidden}
          size={size === 'sm' ? 'base' : 'lg'}
          weight="semibold"
          symbol={false}
          tone={total.amount < 0 ? 'negative' : 'default'}
        />
      </span>
    </div>
  );
}

/**
 * A compact variant for inline use inside a form — split legs totalling their
 * parent, where the user needs to see the sum resolve as they type.
 */
export function ReckoningInline({
  lines,
  total,
  target,
  currency,
}: {
  lines: Array<{ key: string; label: string; amount: number }>;
  total: number;
  /** When supplied, the strip reports whether the lines reach it. */
  target?: number;
  currency?: string;
}) {
  const diff = target != null ? target - total : 0;
  const balanced = target == null || diff === 0;

  return (
    <div className="rounded-[--radius] border border-line bg-surface-2 px-3.5 py-3">
      <div className="reckoning">
        {lines.map((l) => (
          <div key={l.key} className="contents">
            <span className="text-[0.8125rem] text-ink-2 truncate">{l.label}</span>
            <span className="text-right">
              <Money value={l.amount} currency={currency} size="sm" symbol={false} />
            </span>
          </div>
        ))}
        <div className={cn('reckoning-rule', balanced && 'reckoning-rule--total')} aria-hidden="true" />
        <span className="text-[0.8125rem] font-medium text-ink">Total</span>
        <span className="text-right">
          <Money value={total} currency={currency} size="sm" weight="medium" symbol={false} />
        </span>
      </div>

      {target != null && !balanced && (
        <p className="mt-2.5 flex items-center gap-1.5 text-xs text-warn">
          <span aria-hidden="true">▲</span>
          {diff > 0 ? (
            <>
              <Money value={diff} currency={currency} size="xs" symbol={false} className="text-warn" /> left
              to assign
            </>
          ) : (
            <>
              Over by{' '}
              <Money value={-diff} currency={currency} size="xs" symbol={false} className="text-warn" />
            </>
          )}
        </p>
      )}
    </div>
  );
}
