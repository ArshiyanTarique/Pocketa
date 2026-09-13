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

      <div
        className={cn(
          'lg:pl-[4.5rem] transition-[padding] duration-200 ease-out overflow-x-hidden',
          panels > 0 && 'lg:pr-[26rem]',
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
    <aside
      className={cn(
        'group/rail fixed inset-y-0 left-0 z-30 hidden w-[4.5rem] flex-col border-r border-line bg-surface lg:flex',
        'transition-[width] duration-200 ease-out hover:w-[13rem] [&:has(:focus-visible)]:w-[13rem]',
      )}
    >
      <div className="flex h-14 items-center px-[1.125rem]">
        <Wordmark compact />
      </div>

      <div className="px-2.5">
        <button
          onClick={onQuickAdd}
          className={cn(
            'flex h-10 w-full items-center gap-3 overflow-hidden rounded-[--radius] bg-accent-fill px-3',
            'font-semibold text-[--accent-ink] transition-all hover:bg-accent-hover active:scale-[0.98]',
          )}
          aria-label="Add transaction (N)"
        >
          <Plus className="size-4 shrink-0" strokeWidth={2.5} />
          <span className="whitespace-nowrap text-[0.8125rem] opacity-0 transition-opacity group-hover/rail:opacity-100 group-has-[:focus-visible]/rail:opacity-100">
            Add
          </span>
        </button>
      </div>

      <nav className="mt-3 flex-1 space-y-0.5 overflow-y-auto px-2.5 pb-4">
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
        'flex h-10 items-center gap-3 overflow-hidden rounded-[--radius] px-3 transition-colors',
        active ? 'bg-ink text-paper' : 'text-ink-3 hover:bg-surface-2 hover:text-ink',
      )}
    >
      <Icon className="size-[1.1rem] shrink-0" strokeWidth={active ? 2.2 : 1.8} />
      <span className="whitespace-nowrap text-[0.8125rem] font-semibold opacity-0 transition-opacity group-hover/rail:opacity-100 group-has-[:focus-visible]/rail:opacity-100">
        {item.label}
      </span>
    </Link>
  );
}

function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <Link to="/" className="flex items-center gap-2" aria-label="Pocketa home">
      <img src="/favicon.svg" alt="Pocketa" className="size-8 rounded-[--radius-sm]" />
      {!compact && <span className="display text-[1.125rem]">Pocketa</span>}
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

const PAGE_NAMES: Record<string, string> = {
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

function TopBar() {
  const online = useOnline();
  const route = useRoute();
  useSyncEngine();
  const sync = useSync();
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);

  function cycleTheme() {
    const order = ['system', 'light', 'dark'] as const;
    const next = order[(order.indexOf(settings.theme) + 1) % order.length];
    void updateSettings({ theme: next });
  }

  const ThemeIcon = settings.theme === 'light' ? Sun : settings.theme === 'dark' ? Moon : MonitorSmartphone;
  const pageTitle = PAGE_NAMES[route.path] ?? 'Pocketa';

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
        <div className="ml-auto flex items-center gap-0.5">
          {!online && (
            <span
              className="mr-1.5 flex items-center gap-1 rounded-full bg-surface-2 px-2 py-1 text-[0.625rem] font-semibold text-ink-4"
              title="Working offline"
            >
              <CloudOff className="size-3" />
            </span>
          )}
          <span className="mr-0.5">
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
