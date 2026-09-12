import { ArrowLeftRight, Split, Users, Undo2 } from 'lucide-react';
import { Money } from '../ui/Money';
import { Dot } from '../ui/primitives';
import { cn } from '../ui/cn';
import { describeTransaction, signedAmount } from '../app/txnDisplay';
import { MOVEMENT_KINDS, type Account, type ID, type Transaction } from '../core/types';

export function TransactionRow({
  txn,
  accounts,
  hidden,
  onClick,
  showDate,
  dateLabel,
  className,
}: {
  txn: Transaction;
  accounts: ReadonlyMap<ID, Account>;
  hidden?: boolean;
  onClick?: () => void;
  showDate?: boolean;
  dateLabel?: string;
  className?: string;
}) {
  const d = describeTransaction(txn, accounts);
  const isMovement = MOVEMENT_KINDS.includes(txn.kind);
  const Tag = onClick ? 'button' : 'div';

  return (
    <Tag
      {...(onClick ? { onClick, type: 'button' as const } : {})}
      className={cn(
        'flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors',
        onClick && 'hover:bg-surface-2 active:bg-surface-2',
        txn.voided && 'opacity-45',
        className,
      )}
    >
      <Dot color={d.color}>
        {isMovement ? (
          <ArrowLeftRight className="size-[0.9rem]" strokeWidth={2} />
        ) : txn.kind === 'refund' ? (
          <Undo2 className="size-[0.9rem]" strokeWidth={2} />
        ) : (
          d.initial
        )}
      </Dot>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              'truncate text-sm font-medium text-ink',
              txn.voided && 'line-through',
            )}
          >
            {d.title}
          </span>
          {d.isSplit && <Split className="size-3 shrink-0 text-ink-4" aria-label="Split" />}
          {d.isShared && <Users className="size-3 shrink-0 text-ink-4" aria-label="Shared" />}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-ink-3">
          {showDate && dateLabel && (
            <>
              <span className="tnum">{dateLabel}</span>
              <span aria-hidden="true">·</span>
            </>
          )}
          <span className="truncate">{d.subtitle}</span>
        </div>
      </div>

      <div className="shrink-0 text-right">
        <Money
          value={signedAmount(d)}
          hidden={hidden}
          size="sm"
          weight="medium"
          symbol={false}
          sign={d.direction === 'neutral' ? 'never' : 'always'}
          tone={
            d.direction === 'in' ? 'positive' : d.direction === 'out' ? 'default' : 'muted'
          }
        />
        {d.nativeAmount != null && d.nativeCurrency && (
          <div className="mt-0.5">
            <Money
              value={d.nativeAmount}
              currency={d.nativeCurrency}
              hidden={hidden}
              size="xs"
              tone="muted"
            />
          </div>
        )}
        {txn.tags.length > 0 && (
          <div className="mt-0.5 truncate text-[0.625rem] text-ink-4">
            {txn.tags.slice(0, 2).map((t) => `#${t}`).join(' ')}
          </div>
        )}
      </div>
    </Tag>
  );
}
