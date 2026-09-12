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
import { Me } from './screens/Me';

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

type AccentColor = 'gold' | 'blue' | 'green' | 'red' | 'purple' | 'slate';

const ACCENTS: Record<AccentColor, {
  accent: string; fill: string; hover: string; soft: string; ink: string;
}> = {
  gold:   { accent: '#7a5c07', fill: '#e3b53a', hover: '#d4a52a', soft: '#f7edcf', ink: '#1c1400' },
  blue:   { accent: '#1a4fd6', fill: '#3b74f5', hover: '#2a63e8', soft: '#dce8ff', ink: '#ffffff' },
  green:  { accent: '#1c7a52', fill: '#37b47e', hover: '#2da06e', soft: '#dcf2e7', ink: '#04160e' },
  red:    { accent: '#b52b2b', fill: '#e84040', hover: '#d43030', soft: '#fde8e8', ink: '#ffffff' },
  purple: { accent: '#683c8d', fill: '#a072cf', hover: '#8f60bc', soft: '#ede2f6', ink: '#ffffff' },
  slate:  { accent: '#374151', fill: '#4b5563', hover: '#374151', soft: '#e5e7eb', ink: '#ffffff' },
};

export function applyAccent(color: AccentColor) {
  const p = ACCENTS[color] ?? ACCENTS.blue;
  const r = document.documentElement;
  r.style.setProperty('--accent',       p.accent);
  r.style.setProperty('--accent-fill',  p.fill);
  r.style.setProperty('--accent-hover', p.hover);
  r.style.setProperty('--accent-soft',  p.soft);
  r.style.setProperty('--accent-ink',   p.ink);
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
    applyAccent((accentColor ?? 'blue') as AccentColor);
  }, [accentColor]);

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
            title="Pocketa could not open your data"
            body={
              error ??
              'Your browser blocked local storage. Private browsing and some privacy extensions prevent Pocketa from saving anything.'
            }
            action={
              <Button variant="primary" onClick={() => void init('local')}>
                Try again
              </Button>
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
      return <Transactions onEdit={onQuickAdd} />;
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
    case '/me':
      return <Me />;
    case '/join':
      return <JoinInvite token={route.segment} />;
    default:
      return (
        <Card>
          <EmptyState
            title="That page does not exist"
            body="The link may be out of date."
            action={
              <Button variant="primary" onClick={() => (window.location.hash = '/')}>
                Back to dashboard
              </Button>
            }
          />
        </Card>
      );
  }
}
