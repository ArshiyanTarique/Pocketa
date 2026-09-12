import * as React from 'react';
import {
  Archive,
  ArchiveRestore,
  CloudUpload,
  Database,
  Download,
  FileSpreadsheet,
  FileText,
  Info,
  LogOut,
  Plus,
  Printer,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Upload,
  Coins,
  Pencil } from 'lucide-react';
import { Card, CardHeader, Badge, Button, Notice, Progress, Segmented } from '../ui/primitives';
import { Sheet, Confirm } from '../ui/Sheet';
import { Field, Select, TextInput, Toggle } from '../ui/fields';
import { ImportWizard } from '../components/ImportWizard';
import { toast } from '../ui/toast';
import { cn } from '../ui/cn';
import { navigate, useRoute } from '../app/router';
import { useAccountMap, useCategories, useToday } from '../app/useLedger';
import { useStore } from '../store/useStore';
import { CURRENCIES } from '../core/money';
import { formatDate, monthRange, nowIso } from '../core/dates';
import { newId } from '../core/ids';
import {
  buildReportHtml,
  canShareFiles,
  deliverFile,
  deliverText,
  timestampedName,
  type Delivery,
  transactionsToCsv,
  transactionsToExcelXml } from '../data/exchange';
import { formatBytes, requestPersistence, storageEstimate, totalBytes } from '../data/attachments';
import { checkIntegrity, summariseIssues, type Dataset, type IntegrityReport } from '../data/integrity';
import { encodeBackup, decodeBackup, formatBackupSize } from '../data/backup';
import { CARPOOL_SCHEMA_SQL } from '../data/carpoolSchema';
import { SCHEMA_SQL, syncConfigured, getSession, signInWithGoogle, signInWithEmail, signOut } from '../data/sync';
import { describeSync, useSync } from '../app/useSync';
import {
  categoryBreakdown,
  computeBalances,
  computeNetWorth,
  live,
  summarisePeriod } from '../core/projections';
import { CREATABLE_CATEGORY_CLASSES } from './constants';
import type { Account, ID } from '../core/types';

type SettingsTab = 'account' | 'appearance' | 'money' | 'categories' | 'data';

const TABS: Array<{ value: SettingsTab; label: string }> = [
  { value: 'account', label: 'Account' },
  { value: 'appearance', label: 'Appearance' },
  { value: 'money', label: 'Money' },
  { value: 'categories', label: 'Categories' },
  { value: 'data', label: 'Data' },
];

/**
 * Seven stacked cards became five tabs. The tab is the URL segment, so
 * "Settings → Data" is a link the rest of the app can point at.
 */
export function SettingsScreen() {
  const route = useRoute();
  const tab = (TABS.some((t) => t.value === route.segment) ? route.segment : 'account') as SettingsTab;

  return (
    <div className="space-y-5">
      <Segmented
        label="Settings section"
        value={tab}
        onChange={(v) => navigate(`/settings/${v}`, { replace: true })}
        options={TABS}
        className="max-w-full overflow-x-auto no-scrollbar"
      />
      <div key={tab} className="fade-in space-y-4">
        {tab === 'account' && (
          <>
            <SyncSection />
            <AboutSection />
          </>
        )}
        {tab === 'appearance' && <AppearanceSection />}
        {tab === 'money' && (
          <>
            <MoneySection />
            <SafeToSpendSection />
          </>
        )}
        {tab === 'categories' && <CategoriesSection />}
        {tab === 'data' && <DataSection />}
      </div>
    </div>
  );
}

// ===========================================================================

function SyncSection() {
  const sync = useSync();
  const [session, setSession] = React.useState<Awaited<ReturnType<typeof getSession>>>(null);
  const [email, setEmail] = React.useState('');
  const [sent, setSent] = React.useState(false);
  const [showSql, setShowSql] = React.useState(false);

  // The session and the namespace are owned by the sync engine in the shell, so
  // that signing in works from anywhere rather than only from this screen.
  React.useEffect(() => {
    if (!syncConfigured) return;
    void getSession().then(setSession);
  }, [sync.email]);

  // Syncing is automatic; this is the "do it right now" button, and it goes
  // through the same engine rather than running a second one alongside it.
  function runSync() {
    sync.syncNow();
  }

  if (!syncConfigured) {
    return (
      <Card>
        <CardHeader eyebrow="Your account" title="Sync across devices" />
        <div className="px-5 pb-5">
          <Notice tone="neutral" icon={<Info className="size-4" />} title="Not set up in this build">
            Pocketa works fully offline on this device without an account. To sync a phone and a
            laptop, connect a Supabase project by setting <code className="tnum text-[0.75rem]">VITE_SUPABASE_URL</code> and{' '}
            <code className="tnum text-[0.75rem]">VITE_SUPABASE_ANON_KEY</code>, then run the table
            setup below in that project.
          </Notice>
          <Button size="sm" variant="secondary" className="mt-3" onClick={() => setShowSql(true)}>
            Show the setup SQL
          </Button>
          <p className="mt-3 text-xs leading-relaxed text-ink-4">
            Your ledger stays in your own project, isolated per account by row-level security. Until
            then, use Export and Import below to move data between devices.
          </p>
        </div>

        <Sheet open={showSql} onClose={() => setShowSql(false)} title="Sync setup" size="lg">
          <div className="space-y-3 pb-2">
            <p className="text-sm leading-relaxed text-ink-2">
              Run this once in your Supabase project&apos;s SQL editor. It creates a single
              append-only table and restricts every row to the account that wrote it.
            </p>
            <pre className="tnum max-h-72 overflow-auto rounded-[--radius] border border-line bg-surface-2 p-4 text-[0.6875rem] leading-relaxed">
              {SCHEMA_SQL}
            </pre>
            <Button
              variant="secondary"
              full
              onClick={() => {
                void navigator.clipboard.writeText(SCHEMA_SQL);
                toast.saved('Ledger SQL copied');
              }}
            >
              Copy the ledger SQL
            </Button>

            <div className="border-t border-line pt-3">
              <h3 className="eyebrow mb-1.5">Carpool</h3>
              <p className="mb-2 text-sm leading-relaxed text-ink-2">
                Only needed if you want carpool teams, invite links and route search. It is a
                separate set of tables with its own rules, so nothing here can widen access to your
                transactions.
              </p>
              <Button
                variant="secondary"
                full
                onClick={() => {
                  void navigator.clipboard.writeText(CARPOOL_SCHEMA_SQL);
                  toast.saved('Carpool SQL copied');
                }}
              >
                Copy the carpool SQL
              </Button>
            </div>
          </div>
        </Sheet>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        eyebrow="Your account"
        title={session ? session.user.email ?? 'Signed in' : 'Sync across devices'}
        action={
          session && (
            <Button
              size="sm"
              variant="ghost"
              icon={<LogOut className="size-3.5" />}
              onClick={async () => {
                // The engine watches auth and moves the app back to the local
                // ledger on its own; this only has to end the session.
                await signOut();
                setSession(null);
                toast.show('Signed out', 'Your data stays on this device.');
              }}
            >
              Sign out
            </Button>
          )
        }
      />
      <div className="px-5 pb-5">
        {session ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3 rounded-[--radius] border border-line px-3.5 py-3">
              <div className="min-w-0">
                <p className="text-[0.8125rem] font-medium text-ink">{describeSync(sync)}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-ink-3">
                  Changes go up on their own. Sign in with this account on another device and the
                  whole ledger appears there.
                </p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                loading={sync.phase === 'syncing'}
                disabled={!sync.online}
                icon={<RefreshCw className="size-3.5" />}
                onClick={runSync}
              >
                Sync now
              </Button>
            </div>

            {sync.phase === 'failed' && sync.online && (
              <Notice tone="warn" title="Not reaching your account">
                <p>{sync.error}</p>
                <p className="mt-1.5">
                  Nothing is lost — everything is saved here and goes up as soon as it can.
                </p>
              </Notice>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-[0.8125rem] leading-relaxed text-ink-2">
              Pocketa works without an account. Sign in to back your ledger up and pick it up on
              another device.
            </p>
            <Button
              variant="primary"
              full
              icon={<CloudUpload className="size-4" />}
              onClick={async () => {
                const r = await signInWithGoogle();
                if (!r.ok) toast.error('Could not sign in', r.error);
              }}
            >
              Continue with Google
            </Button>
            <div className="flex items-center gap-3 text-xs text-ink-4">
              <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
            </div>
            {sent ? (
              <Notice tone="positive">Check {email} for a sign-in link.</Notice>
            ) : (
              <div className="flex gap-2">
                <TextInput
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  aria-label="Email address"
                />
                <Button
                  variant="secondary"
                  disabled={!email.includes('@')}
                  onClick={async () => {
                    const r = await signInWithEmail(email);
                    if (r.ok) setSent(true);
                    else toast.error('Could not send the link', r.error);
                  }}
                >
                  Send link
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

// ===========================================================================

function AppearanceSection() {
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);

  return (
    <Card>
      <CardHeader eyebrow="Appearance" title="How Pocketa looks" />
      <div className="space-y-4 px-5 pb-5">
        <Field label="Theme">
          <Segmented
            value={settings.theme}
            onChange={(v) => void updateSettings({ theme: v })}
            options={[
              { value: 'system', label: 'System' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
          />
        </Field>

        <Toggle
          checked={settings.hideAmounts}
          onChange={(v) => void updateSettings({ hideAmounts: v })}
          label="Hide amounts"
          description="Replaces every figure with dots. Useful on a shared screen."
        />

        <Field label="Week starts on">
          <Select
            value={String(settings.weekStartsOn)}
            onChange={(e) => void updateSettings({ weekStartsOn: Number(e.target.value) as 0 | 1 })}
          >
            <option value="1">Monday</option>
            <option value="0">Sunday</option>
          </Select>
        </Field>
      </div>
    </Card>
  );
}

// ===========================================================================

function MoneySection() {
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const accounts = useStore((s) => s.accounts);
  const [editingRates, setEditingRates] = React.useState(false);

  const usedCurrencies = React.useMemo(() => {
    const set = new Set(accounts.map((a) => a.currency));
    set.delete(settings.baseCurrency);
    return [...set];
  }, [accounts, settings.baseCurrency]);

  const missing = usedCurrencies.filter((c) => !settings.fxRates[c]);

  return (
    <Card>
      <CardHeader eyebrow="Money" title="Currency" />
      <div className="space-y-4 px-5 pb-5">
        <Field
          label="Base currency"
          hint="Totals, budgets and net worth are reported in this currency. Each transaction keeps the currency it happened in."
        >
          <Select
            value={settings.baseCurrency}
            onChange={(e) => void updateSettings({ baseCurrency: e.target.value })}
          >
            {Object.values(CURRENCIES).map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} — {c.name}
              </option>
            ))}
          </Select>
        </Field>

        {usedCurrencies.length > 0 && (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="eyebrow">Exchange rates</h3>
              <Button size="sm" variant="ghost" icon={<Coins className="size-3.5" />} onClick={() => setEditingRates(true)}>
                Edit
              </Button>
            </div>
            <ul className="space-y-1.5">
              {usedCurrencies.map((code) => (
                <li key={code} className="flex items-center justify-between text-[0.8125rem]">
                  <span className="text-ink-2">1 {code}</span>
                  <span className="tnum text-ink">
                    {settings.fxRates[code] ? `${settings.fxRates[code]} ${settings.baseCurrency}` : <span className="text-negative">not set</span>}
                  </span>
                </li>
              ))}
            </ul>
            {missing.length > 0 && (
              <Notice tone="warn" className="mt-3">
                Transactions in {missing.join(', ')} cannot be recorded until a rate is set.
                Pocketa will not guess one.
              </Notice>
            )}
            <p className="mt-3 text-xs leading-relaxed text-ink-4">
              A rate is frozen onto each transaction when you record it, so past reports never
              change when today&apos;s rate moves.
            </p>
          </div>
        )}
      </div>

      {editingRates && <RatesEditor onClose={() => setEditingRates(false)} currencies={usedCurrencies} />}
    </Card>
  );
}

function RatesEditor({ onClose, currencies }: { onClose: () => void; currencies: string[] }) {
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const [draft, setDraft] = React.useState<Record<string, string>>(() =>
    Object.fromEntries(currencies.map((c) => [c, String(settings.fxRates[c] ?? '')])),
  );

  async function save() {
    const rates: Record<string, number> = { ...settings.fxRates };
    for (const [code, value] of Object.entries(draft)) {
      const n = Number(value);
      if (Number.isFinite(n) && n > 0) rates[code] = n;
      else delete rates[code];
    }
    await updateSettings({ fxRates: rates, fxUpdatedAt: nowIso() });
    toast.saved('Exchange rates updated');
    onClose();
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="Exchange rates"
      description={`How many ${settings.baseCurrency} one unit of each currency is worth.`}
      footer={
        <div className="flex gap-2.5">
          <Button variant="secondary" full onClick={onClose}>Cancel</Button>
          <Button variant="primary" full onClick={() => void save()}>Save rates</Button>
        </div>
      }
    >
      <div className="space-y-3 pb-2">
        {currencies.map((code) => (
          <Field key={code} label={`1 ${code} =`}>
            <div className="flex items-center gap-2">
              <TextInput
                inputMode="decimal"
                value={draft[code] ?? ''}
                onChange={(e) => setDraft({ ...draft, [code]: e.target.value })}
                placeholder="278.50"
                className="tnum"
              />
              <span className="shrink-0 text-sm text-ink-3">{settings.baseCurrency}</span>
            </div>
          </Field>
        ))}
        <Notice tone="neutral" icon={<Info className="size-4" />}>
          Changing a rate affects only transactions recorded from now on. Existing ones keep the
          rate they were recorded with.
        </Notice>
      </div>
    </Sheet>
  );
}

// ===========================================================================

function SafeToSpendSection() {
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);

  return (
    <Card>
      <CardHeader eyebrow="Safe to spend" title="How it is worked out" />
      <div className="space-y-4 px-5 pb-5">
        <Field label="Look ahead" hint="Bills falling due inside this window are reserved.">
          <Select
            value={String(settings.safeToSpendHorizon)}
            onChange={(e) => void updateSettings({ safeToSpendHorizon: Number(e.target.value) })}
          >
            {[7, 14, 30, 45, 60].map((d) => (
              <option key={d} value={d}>{d} days</option>
            ))}
          </Select>
        </Field>

        <Toggle
          checked={settings.safeToSpendReserveGoals}
          onChange={(v) => void updateSettings({ safeToSpendReserveGoals: v })}
          label="Reserve planned goal contributions"
          description="Holds back what you have said you will put aside this month, until you have put it aside."
        />

        <Notice tone="neutral" icon={<Info className="size-4" />}>
          Safe to Spend is a transparent budgeting calculation, not financial advice. The dashboard
          always shows the full derivation.
        </Notice>
      </div>
    </Card>
  );
}

// ===========================================================================

function CategoriesSection() {
  const [kind, setKind] = React.useState<'expense_category' | 'income_category'>('expense_category');
  const [showArchived, setShowArchived] = React.useState(false);
  const [editing, setEditing] = React.useState<Account | 'new' | null>(null);
  const tree = useCategories(kind, showArchived);
  const accounts = useStore((s) => s.accounts);
  const transactions = useStore((s) => s.transactions);

  const usage = React.useMemo(() => {
    const counts = new Map<ID, number>();
    for (const t of live(transactions)) {
      for (const p of t.postings) counts.set(p.accountId, (counts.get(p.accountId) ?? 0) + 1);
    }
    return counts;
  }, [transactions]);

  const archivedCount = accounts.filter(
    (a) => CREATABLE_CATEGORY_CLASSES.includes(a.class) && a.archived,
  ).length;

  return (
    <Card>
      <CardHeader
        eyebrow="Organisation"
        title="Categories"
        action={
          <Button size="sm" variant="secondary" icon={<Plus className="size-3.5" />} onClick={() => setEditing('new')}>
            Add
          </Button>
        }
      />
      <div className="px-5 pb-5">
        <Segmented
          label="Report kind"
          size="sm"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'expense_category', label: 'Spending' },
            { value: 'income_category', label: 'Income' },
          ]}
        />

        <ul className="mt-3 space-y-0.5">
          {tree.map(({ parent, children }) => (
            <li key={parent.id}>
              <CategoryRow account={parent} count={usage.get(parent.id) ?? 0} onEdit={() => setEditing(parent)} />
              {children.map((child) => (
                <CategoryRow
                  key={child.id}
                  account={child}
                  count={usage.get(child.id) ?? 0}
                  nested
                  onEdit={() => setEditing(child)}
                />
              ))}
            </li>
          ))}
        </ul>

        {archivedCount > 0 && (
          <button
            onClick={() => setShowArchived((v) => !v)}
            className="mt-3 text-[0.8125rem] text-ink-3 transition-colors hover:text-ink"
          >
            {showArchived ? 'Hide' : 'Show'} {archivedCount} archived
          </button>
        )}

        <Notice tone="neutral" className="mt-4" icon={<Info className="size-4" />}>
          Categories are archived rather than deleted, so transactions filed against them keep their
          history and every past report still adds up.
        </Notice>
      </div>

      {editing && (
        <CategoryEditor
          account={editing === 'new' ? null : editing}
          kind={kind}
          onClose={() => setEditing(null)}
        />
      )}
    </Card>
  );
}

function CategoryRow({
  account,
  count,
  nested,
  onEdit }: {
  account: Account;
  count: number;
  nested?: boolean;
  onEdit: () => void;
}) {
  return (
    <div
      className={cn(
        'group flex items-center gap-2.5 rounded-[9px] px-2 py-1.5 transition-colors hover:bg-surface-2',
        nested && 'ml-6',
        account.archived && 'opacity-55',
      )}
    >
      <span
        className="size-2.5 shrink-0 rounded-full"
        style={{ background: account.color ?? 'var(--ink-4)' }}
        aria-hidden="true"
      />
      <span className={cn('flex-1 truncate text-[0.8125rem]', nested ? 'text-ink-2' : 'font-medium text-ink')}>
        {account.name}
      </span>
      {account.archived && <Badge tone="neutral">Archived</Badge>}
      {count > 0 && <span className="tnum text-[0.6875rem] text-ink-4">{count}</span>}
      {/* Always visible: a hover-revealed control cannot be reached on a
          touch screen, and 36px is the smallest comfortable thumb target. */}
      <button
        onClick={onEdit}
        className="flex size-9 shrink-0 items-center justify-center rounded-[9px] text-ink-4 opacity-70 transition-all hover:bg-surface-2 hover:text-ink hover:opacity-100 focus-visible:opacity-100"
        aria-label={`Edit ${account.name}`}
      >
        <Pencil className="size-3.5" />
      </button>
    </div>
  );
}

function CategoryEditor({
  account,
  kind,
  onClose }: {
  account: Account | null;
  kind: 'expense_category' | 'income_category';
  onClose: () => void;
}) {
  const saveAccount = useStore((s) => s.saveAccount);
  const archiveAccount = useStore((s) => s.archiveAccount);
  const settings = useStore((s) => s.settings);
  const transactions = useStore((s) => s.transactions);
  // An existing category keeps its own kind; a new one takes the tab's kind.
  const effectiveKind =
    account?.class === 'expense_category' || account?.class === 'income_category'
      ? account.class
      : kind;
  const tree = useCategories(effectiveKind);

  const isNew = !account;
  const [name, setName] = React.useState(account?.name ?? '');
  const [parentId, setParentId] = React.useState<ID | ''>(account?.parentId ?? '');
  const [color, setColor] = React.useState(account?.color ?? '#4C9AFF');
  const [confirmArchive, setConfirmArchive] = React.useState(false);

  const usedBy = account
    ? live(transactions).filter((t) => t.postings.some((p) => p.accountId === account.id)).length
    : 0;

  const parents = tree.map((t) => t.parent).filter((p) => p.id !== account?.id);

  async function save() {
    if (!name.trim()) return;
    const row: Account = {
      id: account?.id ?? newId('acc'),
      class: account?.class ?? kind,
      name: name.trim(),
      parentId: parentId || null,
      currency: account?.currency ?? settings.baseCurrency,
      icon: account?.icon ?? null,
      color,
      archived: account?.archived ?? false,
      archivedAt: account?.archivedAt ?? null,
      system: false,
      sortOrder: account?.sortOrder ?? 999,
      notes: null,
      createdAt: account?.createdAt ?? nowIso(),
      updatedAt: nowIso() };
    await saveAccount(row, isNew);
    toast.saved(isNew ? 'Category added' : 'Category updated');
    onClose();
  }

  const PALETTE = [
    '#F97362', '#4C9AFF', '#8B7CF6', '#F0A23B', '#3FBF7F', '#3AB7C4',
    '#E45FA8', '#B08A5E', '#6E8BD6', '#22A8B0', '#94A3B8', '#8E9AAB',
  ];

  return (
    <Sheet
      open
      onClose={onClose}
      title={isNew ? 'New category' : `Edit ${account!.name}`}
      footer={
        <div className="flex gap-2.5">
          {!isNew && (
            <Button
              variant="secondary"
              icon={account!.archived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}
              onClick={() =>
                account!.archived ? void archiveAccount(account!.id, false).then(onClose) : setConfirmArchive(true)
              }
            >
              {account!.archived ? 'Restore' : 'Archive'}
            </Button>
          )}
          <Button variant="primary" full onClick={() => void save()}>
            {isNew ? 'Add category' : 'Save changes'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4 pb-2">
        <Field label="Name" htmlFor="c-name">
          <TextInput id="c-name" data-autofocus value={name} onChange={(e) => setName(e.target.value)} />
        </Field>

        <Field label="Sits under" optional hint="Leave empty to make this a top-level category.">
          <Select value={parentId} onChange={(e) => setParentId(e.target.value as ID)}>
            <option value="">Top level</option>
            {parents.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </Select>
        </Field>

        <Field label="Colour">
          <div className="flex flex-wrap gap-2">
            {PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                aria-label={`Colour ${c}`}
                className={cn(
                  'size-8 rounded-[10px] transition-transform',
                  color === c ? 'ring-2 ring-ink ring-offset-2 ring-offset-[--surface]' : 'hover:scale-110',
                )}
                style={{ background: c }}
              />
            ))}
          </div>
        </Field>

        {!isNew && usedBy > 0 && (
          <Notice tone="neutral">
            <span className="tnum font-medium">{usedBy}</span> transaction{usedBy === 1 ? ' uses' : 's use'} this
            category. Renaming it updates them everywhere; archiving leaves them untouched.
          </Notice>
        )}
      </div>

      <Confirm
        open={confirmArchive}
        onClose={() => setConfirmArchive(false)}
        title={`Archive ${account?.name}?`}
        confirmLabel="Archive"
        body={
          <>
            The category disappears from pickers, but the{' '}
            <span className="tnum font-medium">{usedBy}</span> transaction{usedBy === 1 ? '' : 's'} filed
            against it keep it, and every past report still adds up. Nothing is deleted.
          </>
        }
        onConfirm={async () => {
          await archiveAccount(account!.id, true);
          toast.saved('Category archived');
          onClose();
        }}
      />
    </Sheet>
  );
}

// ===========================================================================

function DataSection() {
  const store = useStore();
  const accounts = useAccountMap();
  const asOf = useToday();
  const sharing = React.useMemo(() => canShareFiles(), []);
  const [importing, setImporting] = React.useState(false);
  const [confirmRestore, setConfirmRestore] = React.useState<unknown | null>(null);
  const [confirmReset, setConfirmReset] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const txns = React.useMemo(
    () => live(store.transactions).slice().sort((a, b) => b.date.localeCompare(a.date)),
    [store.transactions],
  );

  /** Say what actually happened, rather than assuming a download. */
  function announce(what: string, how: Delivery, detail?: string) {
    if (how === 'cancelled') return;
    if (how === 'shared') return toast.saved(`${what} shared`);
    toast.saved(detail ? `${what} saved — ${detail}` : `${what} saved to your downloads`);
  }

  async function exportCsv() {
    if (txns.length === 0) return toast.error('Nothing to export yet');
    const how = await deliverText(
      timestampedName('pocketa-transactions', 'csv'),
      transactionsToCsv(txns, { accounts, baseCurrency: store.settings.baseCurrency }),
      'text/csv',
    );
    announce('CSV', how);
  }

  async function exportExcel() {
    if (txns.length === 0) return toast.error('Nothing to export yet');
    const how = await deliverText(
      timestampedName('pocketa-transactions', 'xls'),
      transactionsToExcelXml(txns, { accounts, baseCurrency: store.settings.baseCurrency }),
      'application/vnd.ms-excel',
    );
    announce('Spreadsheet', how);
  }

  async function exportBackup(includeReceipts: boolean) {
    const snapshot = await store.exportBackup(includeReceipts);
    const { blob, filename, compressed } = await encodeBackup(
      snapshot,
      timestampedName('pocketa-backup', '').replace(/.$/, ''),
    );
    const how = await deliverFile(filename, blob);
    if (how === 'cancelled') return;

    toast.saved(
      how === 'shared'
        ? `Backup shared — ${formatBackupSize(blob.size)}`
        : `Backup saved — ${formatBackupSize(blob.size)}`,
      {
        label: 'What is in it?',
        run: () =>
          toast.show(
            how === 'shared' ? 'Sent wherever you chose' : 'Check your downloads folder',
            [
              includeReceipts
                ? 'It holds your whole ledger and your receipts.'
                : 'It holds the ledger but no receipt images.',
              compressed ? 'Restore reads it compressed or not.' : '',
            ]
              .filter(Boolean)
              .join(' '),
          ),
      },
    );
  }

  function openReport() {
    const range = monthRange(asOf);
    const balances = computeBalances(store.transactions);
    const summary = summarisePeriod(store.transactions, accounts, range, asOf);
    const netWorth = computeNetWorth(balances, accounts);
    const categories = categoryBreakdown(store.transactions, accounts, range);
    const periodTxns = txns.filter((t) => t.date >= range.from && t.date <= range.to);

    const html = buildReportHtml({
      title: 'Pocketa statement',
      periodLabel: formatDate(range.from, 'month'),
      generatedAt: formatDate(asOf, 'long'),
      baseCurrency: store.settings.baseCurrency,
      summary: {
        income: summary.income,
        expenses: summary.expenses,
        savings: summary.savings,
        savingsRate: summary.savingsRate },
      netWorth,
      categories: categories.map((c) => ({ name: c.name, amount: c.amount })),
      accounts: store.accounts
        .filter((a) => ['cash', 'bank', 'savings', 'ewallet', 'investment', 'credit_card', 'loan'].includes(a.class) && !a.archived)
        .map((a) => ({ name: a.name, balance: balances.native.get(a.id) ?? 0, currency: a.currency })),
      transactions: periodTxns.map((t) => {
        const cat = t.postings
          .map((p) => accounts.get(p.accountId))
          .find((a) => a?.class === 'expense_category' || a?.class === 'income_category');
        const amount = t.postings.filter((p) => p.baseAmount > 0).reduce((s, p) => s + p.baseAmount, 0);
        return {
          date: t.date,
          title: t.merchant ?? cat?.name ?? 'Transaction',
          category: cat?.name ?? '—',
          amount: t.kind === 'income' ? amount : -amount };
      }) });

    const w = window.open('', '_blank');
    if (!w) return toast.error('Your browser blocked the report window', 'Allow pop-ups for Pocketa and try again.');
    w.document.write(html);
    w.document.close();
    setTimeout(() => w.print(), 400);
  }

  async function onBackupFile(file: File) {
    try {
      setConfirmRestore(await decodeBackup(file));
    } catch (err) {
      toast.error(
        'That file could not be read',
        err instanceof Error && /compressed/.test(err.message)
          ? err.message
          : 'A Pocketa backup is a .json or .json.gz file.',
      );
    }
  }

  return (
    <Card>
      <CardHeader eyebrow="Your data" title="Import, export and backup" />
      <div className="space-y-5 px-5 pb-5">
        <div>
          <h3 className="eyebrow mb-2">Bring data in</h3>
          <Button variant="secondary" full icon={<Upload className="size-4" />} onClick={() => setImporting(true)}>
            Import from CSV
          </Button>
          <p className="mt-2 text-xs leading-relaxed text-ink-4">
            You map the columns and review every row, with likely duplicates flagged, before
            anything is added.
          </p>
        </div>

        <div>
          <h3 className="eyebrow mb-2">Take data out</h3>
          {sharing && (
            <p className="mb-2.5 text-xs leading-relaxed text-ink-3">
              These open your phone&apos;s share sheet, so a file can go straight to Drive,
              WhatsApp or anywhere else — rather than into a downloads folder to be found later.
            </p>
          )}
          <div className="grid gap-2 sm:grid-cols-3">
            <Button variant="secondary" icon={<FileText className="size-4" />} onClick={() => void exportCsv()}>
              CSV
            </Button>
            <Button variant="secondary" icon={<FileSpreadsheet className="size-4" />} onClick={() => void exportExcel()}>
              Spreadsheet
            </Button>
            <Button variant="secondary" icon={<Printer className="size-4" />} onClick={openReport}>
              PDF report
            </Button>
          </div>
        </div>

        <div>
          <h3 className="eyebrow mb-2">Backup</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            <Button variant="secondary" icon={<Download className="size-4" />} onClick={() => void exportBackup(true)}>
              Save a backup
            </Button>
            <Button variant="secondary" icon={<Database className="size-4" />} onClick={() => fileRef.current?.click()}>
              Restore a backup
            </Button>
          </div>
          {store.attachments.length > 0 && (
            <button
              onClick={() => void exportBackup(false)}
              className="mt-1 inline-flex min-h-9 items-center text-xs text-accent underline-offset-2 hover:underline"
            >
              Save a smaller backup without receipts
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept=".json,.gz,application/json,application/gzip"
            className="sr-only"
            // Opened by the visible button above; keeping it out of the tab
            // order stops a keyboard user landing on an unnamed control.
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onBackupFile(file);
              e.target.value = '';
            }}
          />
          <p className="mt-2 text-xs leading-relaxed text-ink-4">
            A backup contains your entire ledger, its full audit history and — unless you choose
            otherwise — your receipts. Restoring replaces everything currently on this device.
          </p>
        </div>

        <StorageReadout />

        <DataAudit />

        <div className="border-t border-line pt-4">
          <h3 className="eyebrow mb-2">Start over</h3>
          <Button variant="secondary" className="text-negative" icon={<ShieldAlert className="size-4" />} onClick={() => setConfirmReset(true)}>
            Erase everything on this device
          </Button>
        </div>
      </div>

      {importing && <ImportWizard onClose={() => setImporting(false)} />}

      <Confirm
        open={confirmRestore != null}
        onClose={() => setConfirmRestore(null)}
        title="Replace everything with this backup?"
        tone="danger"
        confirmLabel="Restore backup"
        requirePhrase="RESTORE"
        body={
          <>
            <p>
              Every account, transaction, budget, bill, goal and audit record currently on this
              device will be <strong>permanently replaced</strong> by the contents of the backup file.
            </p>
            <p className="mt-2">
              This cannot be undone. If you are not certain, cancel and save a backup of what is here
              first.
            </p>
          </>
        }
        onConfirm={async () => {
          const result = await store.restoreBackup(confirmRestore);
          if (result.ok) toast.saved('Backup restored');
          else toast.error('Restore failed', result.error);
          setConfirmRestore(null);
        }}
      />

      <Confirm
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        title="Erase everything?"
        tone="danger"
        confirmLabel="Erase everything"
        requirePhrase="ERASE"
        body={
          <>
            <p>
              This deletes every account, transaction, budget, bill, goal and audit record on this
              device, and cannot be undone.
            </p>
            <p className="mt-2">Save a backup first if there is any chance you will want this data back.</p>
          </>
        }
        onConfirm={async () => {
          await store.resetEverything();
          toast.show('Everything erased', 'Pocketa has started fresh.');
        }}
      />
    </Card>
  );
}

// ===========================================================================

/**
 * What the browser is actually giving us.
 *
 * Shown because an app that keeps everything on-device owes the user a view of
 * the ceiling — and because a browser can evict an origin's data under storage
 * pressure unless persistence has been granted.
 */
/**
 * Check the ledger against the rules the browser cannot enforce.
 *
 * IndexedDB has no foreign keys and no check constraints, so nothing stops a
 * reference going stale after a restore, a sync, or a bug. Running the check is
 * read-only and instant; the reassuring answer is the common one, and it is
 * worth being able to get it on demand rather than trusting that it is true.
 */
function DataAudit() {
  const store = useStore();
  const [report, setReport] = React.useState<IntegrityReport | null>(null);

  const dataset: Dataset = {
    ...store,
    settings: [store.settings],
  };

  return (
    <div className="border-t border-line pt-4">
      <h3 className="eyebrow mb-2">Check this ledger</h3>
      <p className="mb-2.5 text-xs leading-relaxed text-ink-3">
        Looks for anything pointing at something that is no longer there, and for any transaction
        whose two sides do not cancel. Nothing is changed by looking.
      </p>

      <Button
        size="sm"
        variant="secondary"
        icon={<ShieldCheck className="size-3.5" />}
        onClick={() => setReport(checkIntegrity(dataset))}
      >
        Run the check
      </Button>

      {report && report.issues.length === 0 && (
        <Notice tone="positive" className="mt-2.5" title="Everything adds up">
          <p>
            {report.counts.transactions} transaction
            {report.counts.transactions === 1 ? '' : 's'} across {report.counts.accounts} accounts
            and categories, every one balanced and every reference intact.
          </p>
        </Notice>
      )}

      {report && report.issues.length > 0 && (
        <Notice
          tone={report.ok ? 'warn' : 'negative'}
          className="mt-2.5"
          title={
            report.ok
              ? `${report.repairable} thing${report.repairable === 1 ? '' : 's'} to tidy up`
              : `${report.fatal} problem${report.fatal === 1 ? '' : 's'} found`
          }
        >
          <ul className="space-y-1">
            {summariseIssues(report).slice(0, 6).map((line) => (
              <li key={line}>• {line}</li>
            ))}
          </ul>
          <p className="mt-2">
            {report.ok
              ? 'None of these affect any figure. They are cleared automatically when a backup is restored.'
              : 'Export a backup before doing anything else, then get in touch — this should not happen.'}
          </p>
        </Notice>
      )}
    </div>
  );
}

function StorageReadout() {
  const attachments = useStore((s) => s.attachments);
  const [estimate, setEstimate] = React.useState<{ used: number; quota: number } | null>(null);
  const [persistent, setPersistent] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    void storageEstimate().then(setEstimate);
    if (typeof navigator !== 'undefined' && navigator.storage?.persisted) {
      void navigator.storage.persisted().then(setPersistent).catch(() => setPersistent(null));
    }
  }, [attachments.length]);

  const receiptBytes = totalBytes(attachments);
  const pct = estimate && estimate.quota > 0 ? estimate.used / estimate.quota : 0;

  return (
    <div className="border-t border-line pt-4">
      <h3 className="eyebrow mb-2">Storage</h3>

      <div className="space-y-2.5">
        <div className="flex items-center justify-between text-[0.8125rem]">
          <span className="text-ink-2">
            {attachments.length} receipt{attachments.length === 1 ? '' : 's'}
          </span>
          <span className="tnum text-ink">{formatBytes(receiptBytes)}</span>
        </div>

        {estimate && estimate.quota > 0 && (
          <>
            <Progress value={pct} tone={pct > 0.85 ? 'warn' : 'accent'} label="Storage used" />
            <p className="text-xs text-ink-3">
              {formatBytes(estimate.used)} of about {formatBytes(estimate.quota)} available to
              Pocketa on this device.
            </p>
          </>
        )}

        {persistent === false && (
          <Notice tone="warn" title="Storage is not marked as persistent">
            <p>
              Browsers may clear a site&apos;s data when a device runs low on space. Granting
              persistence tells this one not to.
            </p>
            <Button
              size="sm"
              variant="secondary"
              className="mt-2.5"
              onClick={async () => {
                const granted = await requestPersistence();
                setPersistent(granted);
                if (granted) toast.saved('Storage is now persistent');
                else toast.warn('The browser declined', 'Keep saving backups instead.');
              }}
            >
              Ask the browser to keep this data
            </Button>
          </Notice>
        )}

        {persistent === true && (
          <p className="text-xs text-positive">
            This browser has agreed not to evict Pocketa&apos;s data.
          </p>
        )}
      </div>
    </div>
  );
}

function AboutSection() {
  const store = useStore();
  const counts = {
    transactions: live(store.transactions).length,
    accounts: store.accounts.filter((a) => !['expense_category', 'income_category', 'adjustment', 'opening_balance'].includes(a.class)).length,
    categories: store.accounts.filter((a) => a.class === 'expense_category' || a.class === 'income_category').length,
    ops: store.ops.length };

  return (
    <Card>
      <CardHeader eyebrow="About" title="Pocketa" />
      <div className="px-5 pb-5">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Object.entries(counts).map(([key, value]) => (
            <div key={key} className="rounded-[--radius] border border-line px-3 py-2.5 text-center">
              <dd className="tnum text-lg font-semibold text-ink">{value}</dd>
              <dt className="mt-0.5 text-[0.6875rem] capitalize text-ink-4">
                {key === 'ops' ? 'history entries' : key}
              </dt>
            </div>
          ))}
        </dl>

        <p className="mt-4 text-xs leading-relaxed text-ink-4">
          Every figure Pocketa shows is summed from your transactions rather than stored, so a
          balance can never drift from the ledger behind it. Deleting is reversible, editing keeps
          a record of what changed, and nothing leaves this device unless you sign in.
        </p>
      </div>
    </Card>
  );
}
