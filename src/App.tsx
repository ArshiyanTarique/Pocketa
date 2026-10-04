import * as React from 'react';
import { MotionConfig } from 'motion/react';
import { RouterProvider, useRoute, navigate } from './app/router';
import { ErrorBoundary } from './app/ErrorBoundary';
import { Shell } from './app/Shell';
import { Toaster, toast } from './ui/toast';
import { Button, EmptyState, SkeletonRows, Card } from './ui/primitives';
import { QuickAdd } from './components/QuickAdd';
import { useStore } from './store/useStore';
import { Dashboard } from './screens/Dashboard';
import { Transactions } from './screens/Transactions';
import { Plan, More } from './screens/Destinations';
import { applyFont } from './app/fonts';
import { setDateLanguage } from './core/dates';

import { tr } from './app/i18n';
/**
 * The daily screens load with the shell. The rest arrive on first visit —
 * the service worker precaches every chunk, so this costs nothing offline
 * and shortens the first paint on a fresh install or after an update.
 */
const Accounts = React.lazy(() => import('./screens/Accounts').then((m) => ({ default: m.Accounts })));
const Budgets = React.lazy(() => import('./screens/Budgets').then((m) => ({ default: m.Budgets })));
const Bills = React.lazy(() => import('./screens/Bills').then((m) => ({ default: m.Bills })));
const Carpool = React.lazy(() => import('./screens/Carpool').then((m) => ({ default: m.Carpool })));
const Goals = React.lazy(() => import('./screens/Goals').then((m) => ({ default: m.Goals })));
const Debts = React.lazy(() => import('./screens/Debts').then((m) => ({ default: m.Debts })));
const Analytics = React.lazy(() => import('./screens/Analytics').then((m) => ({ default: m.Analytics })));
const SettingsScreen = React.lazy(() => import('./screens/Settings').then((m) => ({ default: m.SettingsScreen })));
const JoinInvite = React.lazy(() => import('./screens/JoinInvite').then((m) => ({ default: m.JoinInvite })));

// ---------------------------------------------------------------------------
// Accent color presets — mapped to CSS custom properties on :root
// ---------------------------------------------------------------------------

type AccentColor = 'gold' | 'blue' | 'green' | 'red' | 'purple' | 'slate' | 'teal' | 'orange' | 'pink';

const ACCENTS: Record<AccentColor, {
  accent: string; fill: string; hover: string; soft: string; ink: string;
}> = {
  // fill values are calibrated so that white ink (#ffffff) clears 4.5:1 WCAG AA.
  gold:   { accent: '#7a5c07', fill: '#e3b53a', hover: '#d4a52a', soft: '#f7edcf', ink: '#1c1400' },
  blue:   { accent: '#1a4fd6', fill: '#386ee9', hover: '#2a5fd8', soft: '#dce8ff', ink: '#ffffff' },
  green:  { accent: '#1c7a52', fill: '#37b47e', hover: '#2da06e', soft: '#dcf2e7', ink: '#04160e' },
  red:    { accent: '#b52b2b', fill: '#d53b3b', hover: '#c43030', soft: '#fde8e8', ink: '#ffffff' },
  purple: { accent: '#683c8d', fill: '#8b63b4', hover: '#7a56a0', soft: '#ede2f6', ink: '#ffffff' },
  slate:  { accent: '#374151', fill: '#4b5563', hover: '#374151', soft: '#e5e7eb', ink: '#ffffff' },
  teal:   { accent: '#0e7490', fill: '#07809d', hover: '#06708a', soft: '#cffafe', ink: '#ffffff' },
  orange: { accent: '#c2410c', fill: '#bd5711', hover: '#a84c0e', soft: '#ffedd5', ink: '#ffffff' },
  pink:   { accent: '#be185d', fill: '#cb3e84', hover: '#b83375', soft: '#fce7f3', ink: '#ffffff' },
};

export function applyAccent(color: string) {
  const p = ACCENTS[color as AccentColor] ?? ACCENTS.blue;
  const r = document.documentElement;
  // The palette goes in as raw values; index.css turns them into the live
  // --accent tokens per theme. Setting --accent-soft here directly would pin
  // the light-theme tint in dark mode, where it sits pale under white text.
  r.style.setProperty('--user-accent',       p.accent);
  r.style.setProperty('--user-accent-fill',  p.fill);
  r.style.setProperty('--user-accent-hover', p.hover);
  r.style.setProperty('--user-accent-soft',  p.soft);
  r.style.setProperty('--user-accent-ink',   p.ink);
  r.dataset.accent = color;
}

function applyFontSize(size: string) {
  // Set class on <html> so the CSS `html.text-scale-* body` rules apply.
  // We do NOT change html font-size directly — that would scale ALL rem-based
  // layout widths (sidebars, panels, max-widths). Instead, only body font-size
  // is scaled via the class → CSS chain.
  const r = document.documentElement;
  r.classList.remove('text-scale-large', 'text-scale-xlarge');
  if (size === 'large') r.classList.add('text-scale-large');
  else if (size === 'xlarge') r.classList.add('text-scale-xlarge');
}

function applyDensity(density: string) {
  const r = document.documentElement;
  r.dataset.density = density ?? 'comfortable';
}

function applyLanguage(lang: string) {
  const r = document.documentElement;
  // Set dir/lang on <html> so RTL works correctly.
  // The layout uses logical properties (start/end) where possible, and
  // the rail switches to the opposite side in RTL via CSS.
  r.lang = lang === 'ur' ? 'ur' : 'en';
  r.dir = lang === 'ur' ? 'rtl' : 'ltr';
  setDateLanguage(lang === 'ur' ? 'ur' : 'en');
}


export default function App() {
  return (
    <ErrorBoundary>
      <RouterProvider>
        {/* One easing and one respect-the-OS switch for every scripted motion. */}
        <MotionConfig reducedMotion="user" transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}>
          <Boot />
          <Toaster />
        </MotionConfig>
      </RouterProvider>
    </ErrorBoundary>
  );
}

function Boot() {
  const status = useStore((s) => s.status);
  const error = useStore((s) => s.error);
  const init = useStore((s) => s.init);
  const theme = useStore((s) => s.settings.theme);
  const accentColor = useStore((s) => s.settings.accentColor);
  const fontSize = useStore((s) => s.settings.fontSize ?? 'normal');
  const density = useStore((s) => s.settings.density ?? 'comfortable');
  const language = useStore((s) => s.settings.language ?? 'en');
  const fontFamily = useStore((s) => s.settings.fontFamily ?? 'classic');
  const [quickAdd, setQuickAdd] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);

  React.useEffect(() => {
    void init('local');
  }, [init]);

  // Post the bills the user asked Pocketa to handle, once data is loaded, and
  // always announce it — opting in is not a licence to act unannounced.
  const status2 = useStore((s) => s.status);
  const runAutoPost = useStore((s) => s.runAutoPost);
  const runBudgetRollovers = useStore((s) => s.runBudgetRollovers);
  const autoPosted = React.useRef(false);
  React.useEffect(() => {
    if (status2 !== 'ready' || autoPosted.current) return;
    autoPosted.current = true;
    void runAutoPost().then(({ posted }) => {
      if (posted.length > 0) {
        toast.saved(
          `${posted.length} bill${posted.length === 1 ? '' : 's'} recorded automatically`,
          { label: 'Review', run: () => navigate('/bills') },
        );
      }
    });
    void runBudgetRollovers().then(({ transferred }) => {
      if (transferred.length > 0) {
        toast.saved(
          transferred.length === 1
            ? `${transferred[0].name} surplus moved to savings`
            : `${transferred.length} budget surpluses moved to savings`,
          { label: 'Review', run: () => navigate('/transactions') },
        );
      }
    });
  }, [status2, runAutoPost, runBudgetRollovers]);

  // Keep the document theme and the stored preference in step.
  React.useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') {
      delete root.dataset.theme;
      try { localStorage.removeItem('pocketa.theme'); } catch { /* private mode */ }
    } else {
      root.dataset.theme = theme;
      try { localStorage.setItem('pocketa.theme', theme); } catch { /* private mode */ }
    }
  }, [theme]);

  // Apply the accent color whenever it changes.
  React.useEffect(() => {
    applyAccent((accentColor ?? 'blue') as string);
  }, [accentColor]);

  // Apply font size scale.
  React.useEffect(() => {
    applyFontSize(fontSize);
  }, [fontSize]);

  // Apply density.
  React.useEffect(() => {
    applyDensity(density);
  }, [density]);

  // Apply language / RTL direction.
  React.useEffect(() => {
    applyLanguage(language);
  }, [language]);

  // Apply the typeface pairing.
  React.useEffect(() => {
    applyFont(fontFamily);
  }, [fontFamily]);

  // N adds a transaction from anywhere, the way a ledger app should.
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        setEditingId(null);
        setQuickAdd(true);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function openAdd(id?: string | null) {
    setEditingId(id ?? null);
    setQuickAdd(true);
  }

  if (status === 'error') {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-paper p-6">
        <Card className="max-w-md p-2">
          <EmptyState
            title={tr('Pocketa could not open your data')}
            body={
              error ??
              'Your browser blocked local storage. Private browsing and some privacy extensions prevent Pocketa from saving anything.'
            }
            action={
              <Button variant="primary" onClick={() => void init('local')}>{tr('Try again')}</Button>
            }
          />
        </Card>
      </div>
    );
  }

  if (status !== 'ready') {
    return (
      <div className="min-h-dvh bg-paper p-6">
        <div className="mx-auto max-w-2xl space-y-4 pt-10">
          <Card className="p-5">
            <SkeletonRows rows={2} />
          </Card>
          <Card className="p-5">
            <SkeletonRows rows={4} />
          </Card>
        </div>
      </div>
    );
  }

  return (
    <Shell onQuickAdd={() => openAdd(null)}>
      <ErrorBoundary where={window.location.hash}>
        <React.Suspense fallback={<SkeletonRows rows={4} />}>
          <Screen onQuickAdd={openAdd} />
        </React.Suspense>
      </ErrorBoundary>
      <QuickAdd
        open={quickAdd}
        editingId={editingId}
        onClose={() => {
          setQuickAdd(false);
          setEditingId(null);
        }}
      />
    </Shell>
  );
}

function Screen({ onQuickAdd }: { onQuickAdd: (id?: string | null) => void }) {
  const route = useRoute();

  switch (route.path) {
    case '/':
      return <Dashboard onQuickAdd={() => onQuickAdd(null)} />;
    case '/transactions':
      return <Transactions onEdit={onQuickAdd} onAdd={() => onQuickAdd(null)} />;
    case '/accounts':
      return <Accounts />;
    case '/budgets':
      return <Budgets />;
    case '/bills':
      return <Bills />;
    case '/carpool':
      return <Carpool />;
    case '/goals':
      return <Goals />;
    case '/debts':
      return <Debts />;
    case '/analytics':
      return <Analytics />;
    case '/settings':
      return <SettingsScreen />;
    case '/plan':
      return <Plan />;
    case '/more':
    case '/me':
      return <More />;
    case '/join':
      return <JoinInvite token={route.segment} />;
    default:
      return (
        <Card>
          <EmptyState
            title={tr('That page does not exist')}
            body={tr('The link may be out of date.')}
            action={
              <Button variant="primary" onClick={() => (window.location.hash = '/')}>{tr('Back to dashboard')}</Button>
            }
          />
        </Card>
      );
  }
}
