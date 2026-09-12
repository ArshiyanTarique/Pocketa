/**
 * The fan: your accounts as a row of cards.
 *
 * Money lives in accounts, and the accounts a person carries are physical
 * things — a bank card, a wallet of notes, a credit card. So each is drawn as
 * one, coloured by what it is, in a horizontal row that snaps card to card.
 *
 * This is the dashboard's signature and its main navigation: tap a card and
 * you are in that account. It replaces a list with a subtitle on every line.
 */

import * as React from 'react';
import {
  Banknote,
  CreditCard,
  Landmark,
  PiggyBank,
  Plus,
  Smartphone,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { Money } from '../ui/Money';
import { cn } from '../ui/cn';
import { navigate } from '../app/router';
import { useAccountMap, useBalances } from '../app/useLedger';
import { useStore } from '../store/useStore';
import { availableCredit, balanceOf } from '../core/projections';
import { LIABILITY_CLASSES, type Account, type AccountClass, type ID } from '../core/types';

/**
 * Which note each kind of account is printed on, and the ink that reads on it.
 *
 * These are the theme-stable `--card-*` tokens: a banknote is the same colour
 * at night. Each fill is paired with an ink that clears 4.5:1 on it — dark on
 * the light notes (gold, jade), white on the dark ones.
 */
const NOTE: Record<string, { color: string; ink: string; icon: React.ComponentType<{ className?: string }>; label: string }> = {
  cash: { color: 'var(--card-gold)', ink: 'var(--card-gold-ink)', icon: Wallet, label: 'Cash' },
  bank: { color: 'var(--card-cerulean)', ink: 'var(--card-cerulean-ink)', icon: Landmark, label: 'Bank' },
  savings: { color: 'var(--card-plum)', ink: 'var(--card-plum-ink)', icon: PiggyBank, label: 'Savings' },
  ewallet: { color: 'var(--card-jade)', ink: 'var(--card-jade-ink)', icon: Smartphone, label: 'Wallet' },
  investment: { color: 'var(--card-teal)', ink: 'var(--card-teal-ink)', icon: TrendingUp, label: 'Investment' },
  credit_card: { color: 'var(--card-rust)', ink: 'var(--card-rust-ink)', icon: CreditCard, label: 'Credit card' },
  loan: { color: 'var(--card-brown)', ink: 'var(--card-brown-ink)', icon: Banknote, label: 'Loan' },
};

const SHOWN: AccountClass[] = ['cash', 'bank', 'savings', 'ewallet', 'investment', 'credit_card', 'loan'];

export function AccountFan({
  onSelect,
  onAdd,
  className,
  size = 'md',
}: {
  onSelect?: (id: ID) => void;
  onAdd?: () => void;
  className?: string;
  size?: 'md' | 'lg';
}) {
  const accounts = useStore((s) => s.accounts);
  const hidden = useStore((s) => s.settings.hideAmounts);
  const balances = useBalances();
  useAccountMap();

  const visible = React.useMemo(
    () =>
      accounts
        .filter((a) => SHOWN.includes(a.class) && !a.archived)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    [accounts],
  );

  const fan = React.useRef<HTMLDivElement>(null);
  const drag = useDragToScroll(fan);
  const { index, count, goTo } = useFanPosition(fan, visible.length + (onAdd ? 1 : 0));

  if (visible.length === 0) return null;

  return (
    <div className={cn('-mx-4 sm:-mx-6', className)}>
      <div
        ref={fan}
        className={cn('fan stagger', drag.dragging && 'cursor-grabbing select-none [scroll-snap-type:none]')}
        role="list"
        aria-label="Your accounts"
        {...drag.handlers}
      >
        {visible.map((account) => (
          <NoteCard
            key={account.id}
            account={account}
            balance={balanceOf(balances, account.id)}
            credit={availableCredit(account, balances)}
            hidden={hidden}
            size={size}
            onClick={() => (onSelect ? onSelect(account.id) : navigate(`/accounts/${account.id}`))}
          />
        ))}
        {onAdd && (
          <button
            type="button"
            onClick={onAdd}
            role="listitem"
            aria-label="Add an account"
            className={cn(
              'flex flex-col items-center justify-center gap-2 rounded-[--radius-xl] border-2 border-dashed border-line-strong text-ink-3',
              'transition-colors hover:border-accent hover:text-accent',
              size === 'lg' ? 'h-[9.5rem] w-[14rem]' : 'h-[8.25rem] w-[12rem]',
            )}
          >
            <Plus className="size-5" />
            <span className="text-xs font-semibold">Add account</span>
          </button>
        )}
      </div>

      {count > 1 && (
        <div className="flex justify-center gap-1.5 px-4 sm:px-6" role="tablist" aria-label="Which card is in view">
          {Array.from({ length: count }, (_, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={`Card ${i + 1} of ${count}`}
              onClick={() => goTo(i)}
              className="flex h-4 items-center px-0.5"
            >
              <span
                className={cn(
                  'block h-1.5 rounded-full transition-all duration-200',
                  i === index ? 'w-4 bg-ink' : 'w-1.5 bg-line-strong hover:bg-ink-3',
                )}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Mouse users can grab the fan and pull it, the way it already works with a
 * finger. Snap is suspended while the pointer is down and returns on release,
 * so the strip settles on a card. A drag of more than a few pixels swallows
 * the click that would otherwise open the card under the cursor.
 */
function useDragToScroll(ref: React.RefObject<HTMLDivElement | null>) {
  const [dragging, setDragging] = React.useState(false);
  const state = React.useRef({ startX: 0, startLeft: 0, moved: false, pointerId: -1 });

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse' || e.button !== 0 || !ref.current) return;
    state.current = { startX: e.clientX, startLeft: ref.current.scrollLeft, moved: false, pointerId: e.pointerId };
    setDragging(true);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging || !ref.current || e.pointerId !== state.current.pointerId) return;
    const dx = e.clientX - state.current.startX;
    if (Math.abs(dx) > 4) {
      if (!state.current.moved) {
        state.current.moved = true;
        ref.current.setPointerCapture(e.pointerId);
      }
      ref.current.scrollLeft = state.current.startLeft - dx;
    }
  };
  const end = (e: React.PointerEvent) => {
    if (!dragging) return;
    setDragging(false);
    if (ref.current?.hasPointerCapture(e.pointerId)) ref.current.releasePointerCapture(e.pointerId);
  };
  const onClickCapture = (e: React.MouseEvent) => {
    if (state.current.moved) {
      e.preventDefault();
      e.stopPropagation();
      state.current.moved = false;
    }
  };

  return {
    dragging,
    handlers: { onPointerDown, onPointerMove, onPointerUp: end, onPointerCancel: end, onClickCapture },
  };
}

/** Which card is centred, and a way to centre another. */
function useFanPosition(ref: React.RefObject<HTMLDivElement | null>, count: number) {
  const [index, setIndex] = React.useState(0);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const centre = el.scrollLeft + el.clientWidth / 2;
      let best = 0;
      let bestDist = Infinity;
      Array.from(el.children).forEach((child, i) => {
        const c = child as HTMLElement;
        const mid = c.offsetLeft + c.offsetWidth / 2;
        const dist = Math.abs(mid - centre);
        if (dist < bestDist) {
          bestDist = dist;
          best = i;
        }
      });
      setIndex(best);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [ref, count]);

  const goTo = React.useCallback(
    (i: number) => {
      const el = ref.current;
      const child = el?.children[i] as HTMLElement | undefined;
      if (!el || !child) return;
      el.scrollTo({ left: child.offsetLeft - (el.clientWidth - child.offsetWidth) / 2, behavior: 'smooth' });
    },
    [ref],
  );

  return { index, count, goTo };
}

export function NoteCard({
  account,
  balance,
  credit,
  hidden,
  onClick,
  size = 'md',
  className,
}: {
  account: Account;
  balance: number;
  credit: number | null;
  hidden: boolean;
  onClick?: () => void;
  size?: 'md' | 'lg';
  className?: string;
}) {
  const note = NOTE[account.class] ?? NOTE.cash;
  const Icon = note.icon;
  const liability = LIABILITY_CLASSES.includes(account.class);
  // A card's own colour wins; the class colour is the default note it prints on.
  const color = account.color ?? note.color;

  return (
    <button
      type="button"
      role="listitem"
      onClick={onClick}
      aria-label={`${account.name}, ${note.label}`}
      style={{ ['--note' as string]: color, ['--note-ink' as string]: note.ink }}
      className={cn(
        'note-card flex flex-col justify-between p-4 text-left',
        size === 'lg' ? 'h-[9.5rem] w-[15.5rem]' : 'h-[8.25rem] w-[13rem]',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[0.8125rem] font-semibold leading-tight">{account.name}</p>
          <p className="mt-0.5 text-[0.6875rem] font-semibold uppercase tracking-wide opacity-80">
            {account.institution || note.label}
            {account.last4 && ` · ${account.last4}`}
          </p>
        </div>
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[--note-ink]/15">
          <Icon className="size-3.5" />
        </span>
      </div>

      <div>
        <Money
          value={liability ? -balance : balance}
          currency={account.currency}
          hidden={hidden}
          size={size === 'lg' ? 'xl' : 'lg'}
          weight="semibold"
          className="block text-[--note-ink]"
        />
        {credit != null && (
          <p className="mt-0.5 text-[0.6875rem] font-medium opacity-80">
            {hidden ? '••••' : <><Money value={credit} currency={account.currency} size="xs" symbol={false} className="text-[--note-ink]" /> available</>}
          </p>
        )}
      </div>
    </button>
  );
}
