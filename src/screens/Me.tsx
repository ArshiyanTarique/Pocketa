/**
 * Me — everything monthly or rarer, as a list that already knows the answer.
 *
 * A "more" menu is a list of words. This is a list of destinations each with
 * the one figure you would have gone there to check: how much is in the
 * accounts, whether a budget is at risk, how many bills are due, how far the
 * goals have got, who is up on the debts. Most visits end here without a tap.
 */

import * as React from 'react';
import { ChevronRight, Eye, EyeOff } from 'lucide-react';
import { SECONDARY } from '../app/Shell';
import { Link } from '../app/router';
import { Money } from '../ui/Money';
import { cn } from '../ui/cn';
import { useAccountMap, useBalances, useOverview } from '../app/useLedger';
import { useStore } from '../store/useStore';
import { balanceOf, computeNetWorth } from '../core/projections';

export function Me() {
  const overview = useOverview();
  const balances = useBalances();
  const accounts = useAccountMap();
  const goals = useStore((s) => s.goals);
  const settings = useStore((s) => s.settings);
  const hidden = settings.hideAmounts;
  const currency = settings.baseCurrency;

  const updateSettings = useStore((s) => s.updateSettings);

  const netWorth = computeNetWorth(balances, accounts);
  const atRisk = overview.budgets.filter((b) => b.health === 'over' || b.health === 'projected_over').length;
  const due = overview.bills.filter((b) => b.daysUntilDue <= 7).length;
  const overdue = overview.overdue.length;

  const activeGoals = goals.filter((g) => !g.archived);
  const goalSaved = activeGoals.reduce((s, g) => s + balanceOf(balances, g.accountId), 0);
  const goalTarget = activeGoals.reduce((s, g) => s + g.targetAmount, 0);

  const owed = [...accounts.values()]
    .filter((a) => a.class === 'receivable' && !a.archived)
    .reduce((s, a) => s + balanceOf(balances, a.id), 0);
  const owing = [...accounts.values()]
    .filter((a) => a.class === 'payable' && !a.archived)
    .reduce((s, a) => s - balanceOf(balances, a.id), 0);
  const net = owed - owing;

  /** The one figure per destination, and its tone. */
  const status: Record<string, { figure: React.ReactNode; tone?: 'positive' | 'negative' | 'warn' | 'muted' }> = {
    '/accounts': {
      figure: <Money value={netWorth.net} currency={currency} hidden={hidden} size="sm" weight="semibold" symbol={false} compact />,
    },
    '/budgets': {
      figure:
        overview.budgets.length === 0
          ? 'None set'
          : atRisk > 0
            ? `${atRisk} at risk`
            : 'On track',
      tone: atRisk > 0 ? 'warn' : overview.budgets.length === 0 ? 'muted' : 'positive',
    },
    '/bills': {
      figure: overdue > 0 ? `${overdue} overdue` : due > 0 ? `${due} due this week` : 'Nothing due',
      tone: overdue > 0 ? 'negative' : due > 0 ? 'warn' : 'muted',
    },
    '/debts': {
      figure:
        net === 0 ? 'All square' : <Money value={net} currency={currency} hidden={hidden} size="sm" weight="semibold" symbol={false} sign="always" compact />,
      tone: net > 0 ? 'positive' : net < 0 ? 'negative' : 'muted',
    },
    '/goals': {
      figure: activeGoals.length === 0 ? 'None yet' : `${Math.round((goalTarget > 0 ? goalSaved / goalTarget : 0) * 100)}%`,
      tone: activeGoals.length === 0 ? 'muted' : undefined,
    },
    '/analytics': { figure: '' },
    '/settings': { figure: '' },
  };

  return (
    <div className="mx-auto max-w-xl space-y-6">
      {/* Net worth + hide toggle */}
      <div className="flex items-center justify-between px-1">
        <div>
          <p className="label">Net worth</p>
          <Money value={netWorth.net} currency={currency} hidden={hidden} size="xl" weight="semibold" symbol={false} compact className="mt-1" />
        </div>
        <button
          onClick={() => void updateSettings({ hideAmounts: !hidden })}
          className="flex size-9 items-center justify-center rounded-[--radius] text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
          aria-label={hidden ? 'Show amounts' : 'Hide amounts'}
        >
          {hidden ? <EyeOff className="size-[1.05rem]" /> : <Eye className="size-[1.05rem]" />}
        </button>
      </div>

      <ul className="divide-y divide-line rounded-[--radius-lg] border border-line bg-surface">
        {SECONDARY.map((item) => {
          const Icon = item.icon;
          const s = status[item.path];
          return (
            <li key={item.path}>
              <Link
                to={item.path}
                className="group flex h-[3.75rem] items-center gap-4 px-4 transition-colors hover:bg-surface-2/60"
              >
                <span className="flex size-9 items-center justify-center rounded-[--radius] bg-surface-2 text-ink-3 transition-colors group-hover:bg-accent-soft group-hover:text-accent">
                  <Icon className="size-[1.1rem]" strokeWidth={1.8} />
                </span>
                <span className="flex-1 text-[0.9375rem] font-medium text-ink">{item.label}</span>
                <span
                  className={cn(
                    'tnum text-[0.875rem] font-semibold',
                    s?.tone === 'positive' && 'text-positive',
                    s?.tone === 'negative' && 'text-negative',
                    s?.tone === 'warn' && 'text-warn',
                    s?.tone === 'muted' && 'text-ink-4',
                    !s?.tone && 'text-ink-3',
                  )}
                >
                  {s?.figure}
                </span>
                <ChevronRight className="size-4 text-ink-4 transition-transform group-hover:translate-x-0.5 rtl-flip" />
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
