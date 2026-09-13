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
  Moon,
  Sun,
  MonitorSmartphone,
  CloudOff,
  CircleUserRound,
} from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '../ui/cn';
import { Link, navigate, useRoute } from './router';
import { useStore } from '../store/useStore';
import { IconButton } from '../ui/primitives';
import { usePanelState } from '../ui/Sheet';
import { AccountBadge } from './AccountBadge';
import { useSync, useSyncEngine } from './useSync';
import { useT } from './i18n';

export interface NavItem {
  path: string;
  label: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
}

/**
 * Navigation follows how often things are used, not how many screens exist.
 *
 * Four destinations carry the daily loop — glance, record, check activity,
 * log the carpool. Everything monthly or rarer lives under Me, which is not a
 * "more" menu but a screen in its own right: a list of destinations with a
 * live figure beside each, so it answers questions before you tap.
 */
export const PRIMARY: NavItem[] = [
  { path: '/', label: 'Home', icon: LayoutGrid },
  { path: '/transactions', label: 'Activity', icon: ArrowLeftRight },
  { path: '/carpool', label: 'Carpool', icon: CarFront },
  { path: '/me', label: 'Me', icon: CircleUserRound },
];

export const SECONDARY: NavItem[] = [
  { path: '/accounts', label: 'Accounts', icon: Wallet },
  { path: '/budgets', label: 'Budgets', icon: PieChart },
  { path: '/bills', label: 'Bills', icon: CalendarClock },
  { path: '/debts', label: 'Debts', icon: HandCoins },
  { path: '/goals', label: 'Goals', icon: Target },
  { path: '/analytics', label: 'Analytics', icon: ChartNoAxesCombined },
  { path: '/settings', label: 'Settings', icon: Settings2 },
];

/** Kept for anything that still imports the flat list. */
export const NAV: NavItem[] = [...PRIMARY, ...SECONDARY];

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
      <Rail current={route.path} onQuickAdd={onQuickAdd} />

      {/*
        Content offset:
        - LTR: pad-left for the rail, optionally pad-right for a sheet panel
        - RTL: pad-right for the rail (rail is on the right in RTL), optionally pad-left for panel
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

      <PillBar current={route.path} onQuickAdd={onQuickAdd} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Desktop rail
// ---------------------------------------------------------------------------

function Rail({ current, onQuickAdd }: { current: string; onQuickAdd: () => void }) {
  const secondaryActive = SECONDARY.some((n) => n.path === current);
  return (
    /*
      inset-y-0 + start-0 = sticks to the logical start edge (left in LTR, right in RTL).
      Collapsed: 3.5rem wide, icons centered.
      Expanded on hover: 13rem wide, items left-aligned with px-3.
    */
    <aside
      className={cn(
        'group/rail fixed inset-y-0 start-0 z-30 hidden w-[3.5rem] flex-col border-e border-line bg-surface lg:flex',
        'transition-[width] duration-200 ease-out hover:w-[13rem] [&:has(:focus-visible)]:w-[13rem]',
      )}
    >
      {/* Logo row */}
      <div className="flex h-14 shrink-0 items-center justify-center overflow-hidden px-0 group-hover/rail:justify-start group-hover/rail:px-3">
        <img src="/favicon.svg" alt="Pocketa" className="size-7 shrink-0 rounded-[--radius-sm]" />
        <span className="display ms-2.5 whitespace-nowrap text-[1.0625rem] opacity-0 transition-opacity group-hover/rail:opacity-100 group-has-[:focus-visible]/rail:opacity-100">
          Pocketa
        </span>
      </div>

      {/* Add button */}
      <div className="shrink-0 px-2">
        <button
          onClick={onQuickAdd}
          className={cn(
            'flex h-9 w-full items-center justify-center overflow-hidden rounded-[--radius] bg-accent-fill',
            'font-semibold text-[--accent-ink] transition-all hover:bg-accent-hover active:scale-[0.98]',
            'group-hover/rail:justify-start group-hover/rail:gap-3 group-hover/rail:px-3',
          )}
          aria-label="Add transaction (N)"
        >
          <Plus className="size-4 shrink-0" strokeWidth={2.5} />
          <span className="whitespace-nowrap text-[0.8125rem] opacity-0 transition-opacity group-hover/rail:opacity-100 group-has-[:focus-visible]/rail:opacity-100">
            Add
          </span>
        </button>
      </div>

      {/* Nav links */}
      <nav className="mt-2 flex-1 space-y-0.5 overflow-y-auto px-2 pb-4">
        {PRIMARY.map((item) => (
          <RailLink
            key={item.path}
            item={item}
            active={current === item.path || (item.path === '/me' && secondaryActive)}
          />
        ))}
      </nav>
    </aside>
  );
}

function RailLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      to={item.path}
      title={item.label}
      aria-current={active ? 'page' : undefined}
      className={cn(
        // Collapsed: full width, icon centered. Expanded: left-aligned with gap+padding.
        'flex h-9 w-full items-center justify-center overflow-hidden rounded-[--radius] transition-colors',
        'group-hover/rail:justify-start group-hover/rail:gap-3 group-hover/rail:px-3',
        active ? 'bg-ink text-paper' : 'text-ink-3 hover:bg-surface-2 hover:text-ink',
      )}
    >
      <Icon className="size-[1.05rem] shrink-0" strokeWidth={active ? 2.2 : 1.8} />
      <span className="whitespace-nowrap text-[0.8125rem] font-semibold opacity-0 transition-opacity group-hover/rail:opacity-100 group-has-[:focus-visible]/rail:opacity-100">
        {item.label}
      </span>
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
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const t = useT();

  function cycleTheme() {
    const order = ['system', 'light', 'dark'] as const;
    const next = order[(order.indexOf(settings.theme) + 1) % order.length];
    void updateSettings({ theme: next });
  }

  const ThemeIcon = settings.theme === 'light' ? Sun : settings.theme === 'dark' ? Moon : MonitorSmartphone;

  // Translate page name — keys match the English labels in i18n.ts
  const PAGE_KEY: Record<string, string> = {
    '/': 'Pocketa',
    '/transactions': 'Activity',
    '/accounts': 'Accounts',
    '/budgets': 'Budgets',
    '/bills': 'Bills',
    '/carpool': 'Carpool',
    '/goals': 'Goals',
    '/debts': 'Debts',
    '/analytics': 'Analytics',
    '/settings': 'Settings',
    '/me': 'Me',
    '/join': 'Join',
  };
  const pageTitle = t(PAGE_KEY[route.path] ?? 'Pocketa');

  return (
    <header className="safe-top sticky top-0 z-20 border-b border-line/60 bg-paper/92 backdrop-blur-md">
      <div className="mx-auto flex h-12 w-full max-w-[68rem] items-center px-4 sm:px-6">
        {/* Logo — mobile only */}
        <div className="flex items-center gap-2 lg:hidden">
          <img src="/favicon.svg" alt="Pocketa" className="size-7 rounded-[--radius-sm]" />
        </div>

        {/* Page title — centred */}
        <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 text-[0.9375rem] font-semibold text-ink tracking-[-0.01em]">
          {pageTitle}
        </span>

        {/* Right controls */}
        <div className="ms-auto flex items-center gap-0.5">
          {!online && (
            <span
              className="me-1.5 flex items-center gap-1 rounded-full bg-surface-2 px-2 py-1 text-[0.625rem] font-semibold text-ink-4"
              title="Working offline"
            >
              <CloudOff className="size-3" />
            </span>
          )}
          <span className="me-0.5">
            <AccountBadge sync={sync} />
          </span>
          <IconButton label={`Theme: ${settings.theme}`} onClick={cycleTheme}>
            <ThemeIcon className="size-4" />
          </IconButton>
        </div>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Phone bar
//
// Four destinations and the add button. The active pill slides between items
// rather than appearing and disappearing, so a change of screen reads as a
// move, not a swap.
// ---------------------------------------------------------------------------

function PillBar({ current, onQuickAdd }: { current: string; onQuickAdd: () => void }) {
  const secondaryActive = SECONDARY.some((n) => n.path === current);
  const isActive = (item: NavItem) => current === item.path || (item.path === '/me' && secondaryActive);

  return (
    <nav
      className="safe-bottom fixed inset-x-0 bottom-0 z-30 flex justify-center px-4 pb-3 lg:hidden"
      aria-label="Main"
    >
      <div className="flex items-center gap-0.5 rounded-full border border-line/80 bg-surface/96 px-1.5 py-1.5 shadow-[var(--shadow-lg)] backdrop-blur-xl">
        {PRIMARY.slice(0, 2).map((item) => (
          <PillLink key={item.path} item={item} active={isActive(item)} />
        ))}

        <button
          onClick={onQuickAdd}
          aria-label="Add transaction"
          className={cn(
            'mx-1 flex size-11 items-center justify-center rounded-full bg-accent-fill text-[--accent-ink]',
            'shadow-[var(--shadow-md)] transition-transform active:scale-90',
          )}
        >
          <Plus className="size-5" strokeWidth={2.5} />
        </button>

        {PRIMARY.slice(2).map((item) => (
          <PillLink key={item.path} item={item} active={isActive(item)} />
        ))}
      </div>
    </nav>
  );
}

function PillLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      to={item.path}
      aria-label={item.label}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'relative isolate flex h-10 items-center gap-1.5 rounded-full px-3.5 transition-colors duration-200',
        active ? 'text-paper' : 'text-ink-3 hover:text-ink',
      )}
    >
      {active && (
        <motion.span
          layoutId="pill-active"
          className="absolute inset-0 -z-10 rounded-full bg-ink"
          transition={{ type: 'spring', bounce: 0.18, duration: 0.42 }}
          aria-hidden="true"
        />
      )}
      <Icon className="size-[1.1rem]" strokeWidth={active ? 2.2 : 1.8} />
      {active && <span className="text-[0.75rem] font-semibold">{item.label}</span>}
    </Link>
  );
}

/** Secondary destinations as a grid — used by the Me screen on wide layouts. */
export function MoreNav({ onNavigate }: { onNavigate: () => void }) {
  const route = useRoute();
  return (
    <div className="grid grid-cols-3 gap-2">
      {SECONDARY.map((item) => {
        const Icon = item.icon;
        const active = route.path === item.path;
        return (
          <button
            key={item.path}
            onClick={() => {
              navigate(item.path);
              onNavigate();
            }}
            className={cn(
              'flex aspect-square flex-col items-center justify-center gap-1.5 rounded-[--radius-lg] border text-[0.75rem] font-semibold transition-colors',
              active ? 'border-ink bg-ink text-paper' : 'border-line bg-surface text-ink-2 hover:bg-surface-2 hover:text-ink',
            )}
          >
            <Icon className={cn('size-5', active ? 'text-paper' : 'text-ink-3')} strokeWidth={1.8} />
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
