/**
 * Plan and More — the phone's two menu screens.
 *
 * Each is a list of destinations that already knows the answer: icon, the
 * screen's name, one plain sentence saying what it is for, and the one figure
 * you would have gone there to check. Most visits end here without a tap.
 */

import * as React from 'react';
import { ChevronRight, Eye, EyeOff } from 'lucide-react';
import { DAILY, MONEY, PLAN, SETTINGS, type NavItem } from '../app/Shell';
import { Link } from '../app/router';
import { useT } from '../app/i18n';
import { Money } from '../ui/Money';
import { cn } from '../ui/cn';
import { useAccountMap, useBalances, useOverview } from '../app/useLedger';
import { useStore } from '../store/useStore';
import { balanceOf, computeNetWorth } from '../core/projections';

type Tone = 'positive' | 'negative' | 'warn' | 'muted';
interface Status {
  figure: React.ReactNode;
  tone?: Tone;
}

/** The one figure per destination, and its tone. */
function useDestinationStatus(): Record<string, Status> {
  const overview = useOverview();
  const balances = useBalances();
  const accounts = useAccountMap();
  const goals = useStore((s) => s.goals);
  const carpools = useStore((s) => s.carpools);
  const settings = useStore((s) => s.settings);
  const hidden = settings.hideAmounts;
  const currency = settings.baseCurrency;

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

  const money = (value: number, sign?: 'always') => (
    <Money value={value} currency={currency} hidden={hidden} size="sm" weight="semibold" symbol={false} compact sign={sign} />
  );

  return {
    '/carpool': {
      figure: carpools.some((c) => !c.archived) ? '' : 'Not set up',
      tone: 'muted',
    },
    '/accounts': { figure: money(netWorth.net) },
    '/budgets': {
      figure: overview.budgets.length === 0 ? 'None set' : atRisk > 0 ? `${atRisk} at risk` : 'On track',
      tone: atRisk > 0 ? 'warn' : overview.budgets.length === 0 ? 'muted' : 'positive',
    },
    '/bills': {
      figure: overdue > 0 ? `${overdue} overdue` : due > 0 ? `${due} due this week` : 'Nothing due',
      tone: overdue > 0 ? 'negative' : due > 0 ? 'warn' : 'muted',
    },
    '/debts': {
      figure: net === 0 ? 'All square' : money(net, 'always'),
      tone: net > 0 ? 'positive' : net < 0 ? 'negative' : 'muted',
    },
    '/goals': {
      figure:
        activeGoals.length === 0
          ? 'None yet'
          : `${Math.round((goalTarget > 0 ? goalSaved / goalTarget : 0) * 100)}% saved`,
      tone: activeGoals.length === 0 ? 'muted' : undefined,
    },
  };
}

function DestinationList({ items, status }: { items: NavItem[]; status: Record<string, Status> }) {
  const t = useT();
  return (
    <ul className="divide-y divide-line rounded-[--radius-lg] border border-line bg-surface">
      {items.map((item) => {
        const Icon = item.icon;
        const s = status[item.path];
        return (
          <li key={item.path}>
            <Link
              to={item.path}
              className="density-row group flex min-h-[4.25rem] items-center gap-4 px-4 transition-colors hover:bg-surface-2/60"
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-[--radius] bg-accent-soft text-accent">
                <Icon className="size-[1.15rem]" strokeWidth={1.9} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[0.9375rem] font-semibold text-ink">{t(item.label)}</span>
                <span className="block text-[0.8125rem] text-ink-3">{t(item.purpose)}</span>
              </span>
              {s?.figure ? (
                <span
                  className={cn(
                    'tnum shrink-0 text-[0.8125rem] font-semibold',
                    s.tone === 'positive' && 'text-positive',
                    s.tone === 'negative' && 'text-negative',
                    s.tone === 'warn' && 'text-warn',
                    s.tone === 'muted' && 'text-ink-4',
                    !s.tone && 'text-ink-2',
                  )}
                >
                  {s.figure}
                </span>
              ) : null}
              <ChevronRight className="size-4 shrink-0 text-ink-4 transition-transform group-hover:translate-x-0.5 rtl-flip" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function Plan() {
  const status = useDestinationStatus();
  return (
    <div className="mx-auto max-w-xl space-y-6">
      <DestinationList items={PLAN} status={status} />
    </div>
  );
}

export function More() {
  const status = useDestinationStatus();
  const balances = useBalances();
  const accounts = useAccountMap();
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const t = useT();
  const hidden = settings.hideAmounts;
  const netWorth = computeNetWorth(balances, accounts);

  return (
    <div className="mx-auto max-w-xl space-y-6">
      {/* Net worth + hide toggle */}
      <div className="flex items-center justify-between gap-4 px-1">
        <div>
          <p className="label">{t('Net worth')}</p>
          <Money
            value={netWorth.net}
            currency={settings.baseCurrency}
            hidden={hidden}
            size="xl"
            weight="semibold"
            symbol={false}
            compact
            className="mt-1"
          />
        </div>
        <button
          onClick={() => void updateSettings({ hideAmounts: !hidden })}
          className="flex h-9 items-center gap-2 rounded-[--radius] border border-line px-3 text-[0.8125rem] font-medium text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
        >
          {hidden ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          {hidden ? t('Show amounts') : t('Hide amounts')}
        </button>
      </div>

      <DestinationList items={[DAILY[2]]} status={status} />
      <DestinationList items={MONEY} status={status} />
      <DestinationList items={[SETTINGS]} status={status} />
    </div>
  );
}
