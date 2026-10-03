import * as React from 'react';
import {
  LayoutGrid,
  ArrowLeftRight,
  Wallet,
  PieChart,
  CalendarClock,
  Target,
  HandCoins,
  ChartNoAxesCombined,
  CarFront,
  Settings2,
  Plus,
  CloudOff,
  ClipboardList,
  Ellipsis,
} from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '../ui/cn';
import { Link, useRoute } from './router';
import { usePanelState } from '../ui/Sheet';
import { AccountBadge } from './AccountBadge';
import { useSync, useSyncEngine } from './useSync';
import { useT } from './i18n';

export interface NavItem {
  path: string;
  label: string;
  /** One plain sentence saying what the screen is for. Shown on the Plan and More lists. */
  purpose: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
}

export interface NavGroup {
  /** Null for the daily group, which needs no heading. */
  title: string | null;
  items: NavItem[];
}

/**
 * Navigation is grouped by what the screens are *for*, and every destination
 * is visible by name. A newcomer should be able to find "Bills" by reading the
 * word "Bills", not by guessing which icon or which "more" menu hides it.
 */
export const DAILY: NavItem[] = [
  { path: '/', label: 'Home', purpose: 'What you can spend and what needs attention', icon: LayoutGrid },
  { path: '/transactions', label: 'Activity', purpose: 'Everything you have recorded', icon: ArrowLeftRight },
  { path: '/carpool', label: 'Carpool', purpose: 'Log trips and see who owes what', icon: CarFront },
];

export const PLAN: NavItem[] = [
  { path: '/bills', label: 'Bills', purpose: 'What you pay regularly', icon: CalendarClock },
  { path: '/budgets', label: 'Budgets', purpose: 'Limits you set on spending', icon: PieChart },
  { path: '/goals', label: 'Goals', purpose: 'What you are saving for', icon: Target },
];

export const MONEY: NavItem[] = [
  { path: '/accounts', label: 'Accounts', purpose: 'Your banks, cash and cards', icon: Wallet },
  { path: '/debts', label: 'People', purpose: 'Who owes you and who you owe', icon: HandCoins },
  { path: '/analytics', label: 'Reports', purpose: 'Where your money went', icon: ChartNoAxesCombined },
];

export const SETTINGS: NavItem = {
  path: '/settings',
  label: 'Settings',
  purpose: 'Account, appearance, currency and data',
  icon: Settings2,
};

export const GROUPS: NavGroup[] = [
  { title: null, items: DAILY },
  { title: 'Plan', items: PLAN },
  { title: 'Money', items: MONEY },
];

/** The phone's two menu tabs. */
export const PLAN_TAB: NavItem = { path: '/plan', label: 'Plan', purpose: 'Bills, budgets and goals', icon: ClipboardList };
export const MORE_TAB: NavItem = { path: '/more', label: 'More', purpose: 'Everything else', icon: Ellipsis };

/** Every real destination, flat. */
export const NAV: NavItem[] = [...DAILY, ...PLAN, ...MONEY, SETTINGS];

/** Which group heading a path sits under, for the desktop title. */
export function groupOf(path: string): string | null {
  for (const g of GROUPS) if (g.items.some((i) => i.path === path)) return g.title;
  return null;
}

export function Shell({
  children,
  onQuickAdd,
}: {
  children: React.ReactNode;
  onQuickAdd: () => void;
}) {
  const route = useRoute();
  const panels = usePanelState((s) => s.open);

  return (
    <div className="min-h-dvh bg-paper">
      <Sidebar current={route.path} onQuickAdd={onQuickAdd} />

      {/*
        Content offset:
        - LTR: pad-left for the sidebar, optionally pad-right for a sheet panel
        - RTL: pad-right for the sidebar (it sits on the right in RTL), optionally pad-left for panel
        overflow-x-hidden prevents any large-text reflow from creating a horizontal scrollbar.
      */}
      <div
        className={cn(
          'transition-[padding] duration-200 ease-out overflow-x-hidden',
          'lg:ps-[3.5rem]',
          panels > 0 && 'lg:pe-[26rem]',
        )}
      >
        <TopBar />
        <main
          className="mx-auto w-full max-w-[68rem] px-4 pb-28 pt-4 sm:px-6 lg:pb-10 lg:pt-5"
          key={route.path}
        >
          <div className="rise">{children}</div>
        </main>
      </div>

      <TabBar current={route.path} onQuickAdd={onQuickAdd} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Desktop sidebar
//
// Rests as a strip of icons so the page has the room; opens to full labels
// the moment the pointer arrives (or keyboard focus lands in it), which is
// always before a click. Group headings become hairlines when closed so the
// grouping still reads at a glance.
// ---------------------------------------------------------------------------

/** Text that is present when the rail is open and silent when it is closed. */
const RAIL_LABEL =
  'whitespace-nowrap opacity-0 transition-opacity duration-150 group-hover/rail:opacity-100 group-has-[:focus-visible]/rail:opacity-100';

function Sidebar({ current, onQuickAdd }: { current: string; onQuickAdd: () => void }) {
  const t = useT();
  return (
    <aside
      className={cn(
        'group/rail fixed inset-y-0 start-0 z-30 hidden w-[3.5rem] flex-col border-e border-line bg-surface lg:flex',
        'overflow-hidden transition-[width,box-shadow] duration-200 ease-out',
        'hover:w-[13rem] hover:shadow-[var(--shadow-lg)] [&:has(:focus-visible)]:w-[13rem]',
      )}
      aria-label="Main"
    >
      {/* Logo row */}
      <div className="flex h-14 w-[13rem] shrink-0 items-center ps-[0.875rem]">
        <img src="/favicon.svg" alt="" className="size-7 shrink-0 rounded-[--radius-sm]" />
        <span className={cn('display ms-2.5 text-[1.0625rem]', RAIL_LABEL)}>Pocketa</span>
      </div>

      {/* Add button — the one action taken from every screen. Buttons and links
          fill the rail's inner width (2.5rem closed, 12rem open) so their
          backgrounds stay centred under the icon instead of being clipped at
          the rail's edge. */}
      <div className="shrink-0 px-2">
        <button
          onClick={onQuickAdd}
          className={cn(
            'flex h-10 w-full items-center rounded-[--radius] bg-accent-fill ps-[0.725rem]',
            'text-[0.875rem] font-semibold text-[--accent-ink] transition-all hover:bg-accent-hover active:scale-[0.98]',
            'shadow-[0_1px_3px_rgb(0_0_0/0.12),0_4px_12px_-2px_rgb(0_0_0/0.08)]',
          )}
        >
          <Plus className="size-4 shrink-0" strokeWidth={2.5} />
          <span className={cn('ms-3 truncate', RAIL_LABEL)}>{t('Add transaction')}</span>
        </button>
      </div>

      {/* Groups */}
      <nav className="mt-3 flex-1 overflow-y-auto overflow-x-hidden px-2 pb-4">
        {GROUPS.map((group, gi) => (
          <div key={group.title ?? 'daily'} className={cn(gi > 0 && 'mt-3')}>
            {group.title && (
              <div className="relative mb-1.5 h-5">
                {/* Closed: a hairline. Open: the heading. */}
                <span
                  className="absolute inset-x-2 top-1/2 h-px bg-line transition-opacity duration-150 group-hover/rail:opacity-0 group-has-[:focus-visible]/rail:opacity-0"
                  aria-hidden="true"
                />
                <p className={cn('ps-3 pt-1 text-[0.6875rem] font-semibold uppercase tracking-widest text-ink-4', RAIL_LABEL)}>
                  {t(group.title)}
                </p>
              </div>
            )}
            <ul className="space-y-0.5">
              {group.items.map((item) => (
                <li key={item.path}>
                  <SidebarLink item={item} active={current === item.path} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="shrink-0 border-t border-line px-2 py-3">
        <SidebarLink item={SETTINGS} active={current === SETTINGS.path} />
      </div>
    </aside>
  );
}

function SidebarLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  const t = useT();
  return (
    <Link
      to={item.path}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'relative flex h-9 w-full items-center rounded-[--radius] ps-[0.725rem] pe-2 text-[0.875rem] transition-colors',
        active ? 'bg-ink font-semibold text-paper' : 'font-medium text-ink-2 hover:bg-surface-2 hover:text-ink',
      )}
    >
      {active && (
        <span
          className="absolute inset-y-2 start-0 w-[3px] rounded-full bg-accent-fill"
          aria-hidden="true"
        />
      )}
      <Icon className={cn('size-[1.05rem] shrink-0', !active && 'text-ink-3')} strokeWidth={active ? 2.2 : 1.8} />
      <span className={cn('ms-3 truncate', RAIL_LABEL)}>{t(item.label)}</span>
    </Link>
  );
}

export function useOnline(): boolean {
  const [online, setOnline] = React.useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );
  React.useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return online;
}

// ---------------------------------------------------------------------------
// Top bar
// ---------------------------------------------------------------------------

function TopBar() {
  const online = useOnline();
  const route = useRoute();
  useSyncEngine();
  const sync = useSync();
  const t = useT();

  const item =
    NAV.find((n) => n.path === route.path) ??
    (route.path === PLAN_TAB.path ? PLAN_TAB : route.path === MORE_TAB.path ? MORE_TAB : null);
  const group = groupOf(route.path);
  const title = item ? t(item.label) : route.path === '/join' ? t('Join') : 'Pocketa';

  return (
    <header className="safe-top sticky top-0 z-20 border-b border-line/60 bg-paper/92 backdrop-blur-md">
      <div className="mx-auto flex h-12 w-full max-w-[68rem] items-center px-4 sm:px-6">
        {/* Logo — phone only; the sidebar carries it on desktop */}
        <img src="/favicon.svg" alt="" className="size-7 rounded-[--radius-sm] lg:hidden" />

        {/* Desktop: Group › Screen, left-aligned so it agrees with the sidebar */}
        <h1 className="hidden items-center gap-1.5 text-[0.9375rem] font-semibold tracking-[-0.01em] text-ink lg:flex">
          {group && (
            <>
              <span className="font-medium text-ink-4">{t(group)}</span>
              <span className="text-ink-4" aria-hidden="true">›</span>
            </>
          )}
          {title}
        </h1>

        {/* Phone: centred screen name */}
        <h1 className="pointer-events-none absolute left-1/2 -translate-x-1/2 text-[0.9375rem] font-semibold tracking-[-0.01em] text-ink lg:hidden">
          {title}
        </h1>

        {/* Right controls */}
        <div className="ms-auto flex items-center gap-2">
          {!online && (
            <span className="flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 text-[0.6875rem] font-semibold text-ink-3">
              <CloudOff className="size-3" />
              {t('Offline')}
            </span>
          )}
          <AccountBadge sync={sync} />
        </div>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Phone tab bar
//
// Five slots, every one labelled. The active pill slides between items rather
// than appearing and disappearing, so a change of screen reads as a move.
// ---------------------------------------------------------------------------

const TABS_LEFT: NavItem[] = [DAILY[0], DAILY[1]];
const TABS_RIGHT: NavItem[] = [PLAN_TAB, MORE_TAB];

function tabActive(tab: NavItem, current: string): boolean {
  if (tab.path === current) return true;
  if (tab.path === PLAN_TAB.path) return PLAN.some((n) => n.path === current);
  if (tab.path === MORE_TAB.path)
    return current === DAILY[2].path || current === SETTINGS.path || MONEY.some((n) => n.path === current);
  return false;
}

function TabBar({ current, onQuickAdd }: { current: string; onQuickAdd: () => void }) {
  const t = useT();
  return (
    <nav
      className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-line/80 bg-surface/96 backdrop-blur-xl lg:hidden"
      aria-label="Main"
    >
      <div className="mx-auto grid h-16 max-w-lg grid-cols-5 items-center px-1">
        {TABS_LEFT.map((item) => (
          <TabLink key={item.path} item={item} active={tabActive(item, current)} />
        ))}

        <button
          onClick={onQuickAdd}
          className="flex flex-col items-center justify-center gap-0.5 text-[0.6875rem] font-semibold text-accent"
        >
          <span
            className={cn(
              'flex size-9 items-center justify-center rounded-full bg-accent-fill text-[--accent-ink]',
              'shadow-[var(--shadow-md)] transition-transform active:scale-90',
            )}
            aria-hidden="true"
          >
            <Plus className="size-5" strokeWidth={2.5} />
          </span>
          {t('Add')}
        </button>

        {TABS_RIGHT.map((item) => (
          <TabLink key={item.path} item={item} active={tabActive(item, current)} />
        ))}
      </div>
    </nav>
  );
}

function TabLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  const t = useT();
  return (
    <Link
      to={item.path}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'relative isolate flex h-full flex-col items-center justify-center gap-0.5 rounded-[--radius] text-[0.6875rem] font-semibold transition-colors',
        active ? 'text-accent' : 'text-ink-3 hover:text-ink',
      )}
    >
      {active && (
        <motion.span
          layoutId="tab-active"
          className="absolute inset-x-2 inset-y-1.5 -z-10 rounded-[--radius] bg-accent-soft"
          transition={{ type: 'spring', bounce: 0.18, duration: 0.42 }}
          aria-hidden="true"
        />
      )}
      <Icon className="size-[1.2rem]" strokeWidth={active ? 2.2 : 1.8} />
      {t(item.label)}
    </Link>
  );
}
