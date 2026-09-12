import * as React from 'react';
import {
  Archive,
  ArchiveRestore,
  Banknote,
  CreditCard,
  Landmark,
  Pencil,
  PiggyBank,
  Plus,
  Scale,
  Smartphone,
  TrendingUp,
  Wallet } from 'lucide-react';
import { Card, CardHeader, Badge, Button, EmptyState, Notice, Progress, Dot } from '../ui/primitives';
import { Money } from '../ui/Money';
import { Reckoning } from '../ui/Reckoning';
import { Sheet, Confirm } from '../ui/Sheet';
import { AmountInput, ChipGroup, DateInput, Field, Select, TextInput, Textarea, Toggle } from '../ui/fields';
import { TransactionRow } from '../components/TransactionRow';
import { useIncremental } from '../ui/useIncremental';
import { toast } from '../ui/toast';
import { cn } from '../ui/cn';
import { useAccountMap, useBalances, useToday } from '../app/useLedger';
import { navigate, useRoute } from '../app/router';
import { AccountFan } from '../components/AccountFan';
import { useStore, SYSTEM_IDS } from '../store/useStore';
import { accountLedger, availableCredit, balanceOf, computeNetWorth } from '../core/projections';
import { CURRENCIES } from '../core/money';
import { formatRelativeDay, nowIso } from '../core/dates';
import { newId } from '../core/ids';
import {
  ASSET_CLASSES,
  LIABILITY_CLASSES,
  type Account,
  type AccountClass,
  type ID } from '../core/types';

const CLASS_META: Record<string, { label: string; icon: React.ComponentType<{ className?: string }>; hint: string }> = {
  cash: { label: 'Cash', icon: Wallet, hint: 'Notes and coins you hold' },
  bank: { label: 'Bank account', icon: Landmark, hint: 'Current or chequing account' },
  savings: { label: 'Savings', icon: PiggyBank, hint: 'Set aside, but still yours to spend' },
  ewallet: { label: 'E-wallet', icon: Smartphone, hint: 'JazzCash, Easypaisa, SadaPay and the like' },
  investment: { label: 'Investment', icon: TrendingUp, hint: 'Stocks, funds, crypto' },
  credit_card: { label: 'Credit card', icon: CreditCard, hint: 'Spending here increases what you owe' },
  loan: { label: 'Loan', icon: Banknote, hint: 'Money borrowed from an institution' } };

const CREATABLE: AccountClass[] = ['cash', 'bank', 'savings', 'ewallet', 'investment', 'credit_card', 'loan'];

export function Accounts() {
  const accounts = useStore((s) => s.accounts);
  const settings = useStore((s) => s.settings);
  const balances = useBalances();
  const accountMap = useAccountMap();
  const hidden = settings.hideAmounts;

  const route = useRoute();
  const [editing, setEditing] = React.useState<Account | 'new' | null>(null);
  // `/accounts/<id>` opens straight into that account — that is where a tap on
  // a card in the dashboard fan lands.
  const [detailId, setDetailId] = React.useState<ID | null>(route.segment);
  const [showArchived, setShowArchived] = React.useState(false);

  React.useEffect(() => {
    if (route.segment) setDetailId(route.segment);
  }, [route.segment]);

  const visible = accounts.filter(
    (a) => CREATABLE.includes(a.class) && (showArchived || !a.archived),
  );

  const assets = visible.filter((a) => ASSET_CLASSES.includes(a.class));
  const liabilities = visible.filter((a) => LIABILITY_CLASSES.includes(a.class));
  const netWorth = computeNetWorth(balances, accountMap);
  const archivedCount = accounts.filter((a) => CREATABLE.includes(a.class) && a.archived).length;

  return (
    <div className="space-y-5">
      <section>
        <p className="label">Net worth</p>
        <div className="count-in mt-2 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <Money
            value={netWorth.net}
            currency={settings.baseCurrency}
            hidden={hidden}
            size="display"
            weight="semibold"
            tone={netWorth.net < 0 ? 'negative' : 'default'}
          />
          <div className="flex gap-5 pb-1.5 text-xs">
            <span className="flex flex-col">
              <span className="label">Own</span>
              <Money value={netWorth.assets} currency={settings.baseCurrency} hidden={hidden} size="sm" weight="semibold" symbol={false} />
            </span>
            <span className="flex flex-col">
              <span className="label">Owe</span>
              <Money value={netWorth.liabilities} currency={settings.baseCurrency} hidden={hidden} size="sm" weight="semibold" symbol={false} tone={netWorth.liabilities > 0 ? 'negative' : 'muted'} />
            </span>
          </div>
        </div>
        <div className="reckoning-rule reckoning-rule--total mt-4" aria-hidden="true" />
      </section>

      <AccountFan size="lg" onSelect={setDetailId} onAdd={() => setEditing('new')} />

      <div className="flex items-center justify-between">
        <h2 className="display text-[1.0625rem]">Every account</h2>
        <Button
          size="sm"
          variant="primary"
          icon={<Plus className="size-3.5" />}
          onClick={() => setEditing('new')}
        >
          Add account
        </Button>
      </div>

      {visible.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Wallet className="size-5" />}
            title="No accounts yet"
            body="Add the accounts you actually use, then set what is in each of them today. Everything else is worked out from your transactions."
            action={
              <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
                Add your first account
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {assets.length > 0 && (
            <AccountGroup
              title="Assets"
              accounts={assets}
              balances={balances}
              hidden={hidden}
              onSelect={setDetailId}
            />
          )}
          {liabilities.length > 0 && (
            <AccountGroup
              title="Liabilities"
              accounts={liabilities}
              balances={balances}
              hidden={hidden}
              onSelect={setDetailId}
            />
          )}
        </div>
      )}

      {archivedCount > 0 && (
        <button
          onClick={() => setShowArchived((v) => !v)}
          className="mx-auto block text-[0.8125rem] text-ink-3 transition-colors hover:text-ink"
        >
          {showArchived ? 'Hide' : 'Show'} {archivedCount} archived account
          {archivedCount === 1 ? '' : 's'}
        </button>
      )}

      {editing && (
        <AccountEditor
          account={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}

      {detailId && (
        <AccountDetail
          id={detailId}
          onClose={() => {
            setDetailId(null);
            // Drop the segment too, or tapping the same card again is a no-op.
            if (route.segment) navigate('/accounts', { replace: true });
          }}
          onEdit={(a) => {
            setDetailId(null);
            setEditing(a);
          }}
        />
      )}
    </div>
  );
}

function AccountGroup({
  title,
  accounts,
  balances,
  hidden,
  onSelect }: {
  title: string;
  accounts: Account[];
  balances: ReturnType<typeof useBalances>;
  hidden: boolean;
  onSelect: (id: ID) => void;
}) {
  const total = accounts.reduce((sum, a) => sum + (balances.base.get(a.id) ?? 0), 0);

  return (
    <Card>
      <CardHeader
        title={title}
        action={
          <Money
            value={title === 'Liabilities' ? -total : total}
            hidden={hidden}
            size="sm"
            weight="medium"
            tone={title === 'Liabilities' && total !== 0 ? 'negative' : 'default'}
          />
        }
      />
      <ul className="pb-2">
        {accounts
          .slice()
          .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
          .map((account) => {
            const meta = CLASS_META[account.class];
            const Icon = meta?.icon ?? Wallet;
            const balance = balanceOf(balances, account.id);
            const credit = availableCredit(account, balances);

            return (
              <li key={account.id}>
                <button
                  onClick={() => onSelect(account.id)}
                  className={cn(
                    'flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-surface-2',
                    account.archived && 'opacity-55',
                  )}
                >
                  <Dot color={account.color}>
                    <Icon className="size-[0.95rem]" />
                  </Dot>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-ink">{account.name}</span>
                      {account.archived && <Badge tone="neutral">Archived</Badge>}
                      {account.currency !== 'PKR' && <Badge tone="neutral">{account.currency}</Badge>}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-ink-3">
                      {account.institution || meta?.label}
                      {account.last4 && ` ···· ${account.last4}`}
                    </p>
                  </div>

                  <div className="shrink-0 text-right">
                    <Money
                      value={balance}
                      currency={account.currency}
                      hidden={hidden}
                      size="sm"
                      weight="medium"
                      tone={balance < 0 ? 'negative' : 'default'}
                    />
                    {credit != null && (
                      <p className="mt-0.5 text-[0.6875rem] text-ink-4">
                        {hidden ? '••••' : <>available <Money value={credit} currency={account.currency} size="xs" tone="muted" symbol={false} /></>}
                      </p>
                    )}
                  </div>
                </button>

                {credit != null && account.creditLimit ? (
                  <div className="px-5 pb-2.5">
                    <Progress
                      value={Math.min(1, Math.abs(Math.min(0, balance)) / account.creditLimit)}
                      tone={
                        Math.abs(Math.min(0, balance)) / account.creditLimit > 0.8 ? 'warn' : 'accent'
                      }
                      label={`${account.name} credit used`}
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
      </ul>
    </Card>
  );
}

// ===========================================================================
// Editor
// ===========================================================================

function AccountEditor({ account, onClose }: { account: Account | null; onClose: () => void }) {
  const saveAccount = useStore((s) => s.saveAccount);
  const createTransaction = useStore((s) => s.createTransaction);
  const settings = useStore((s) => s.settings);
  const asOf = useToday();

  const isNew = !account;
  const [cls, setCls] = React.useState<AccountClass>(account?.class ?? 'bank');
  const [name, setName] = React.useState(account?.name ?? '');
  const [currency, setCurrency] = React.useState(account?.currency ?? settings.baseCurrency);
  const [institution, setInstitution] = React.useState(account?.institution ?? '');
  const [last4, setLast4] = React.useState(account?.last4 ?? '');
  const [creditLimit, setCreditLimit] = React.useState<number | null>(account?.creditLimit ?? null);
  const [dueDay, setDueDay] = React.useState<string>(String(account?.dueDay ?? ''));
  const [statementDay, setStatementDay] = React.useState<string>(String(account?.statementDay ?? ''));
  const [notes, setNotes] = React.useState(account?.notes ?? '');
  const [excludeFromNetWorth, setExclude] = React.useState(account?.excludeFromNetWorth ?? false);
  const [opening, setOpening] = React.useState<number | null>(null);
  const [openingDate, setOpeningDate] = React.useState(asOf);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  const isCard = cls === 'credit_card' || cls === 'loan';

  async function save() {
    if (!name.trim()) {
      setError('Give the account a name.');
      return;
    }
    setSaving(true);
    setError(null);

    const row: Account = {
      id: account?.id ?? newId('acc'),
      class: cls,
      name: name.trim(),
      parentId: null,
      currency,
      icon: null,
      color: account?.color ?? null,
      archived: account?.archived ?? false,
      archivedAt: account?.archivedAt ?? null,
      system: false,
      sortOrder: account?.sortOrder ?? 0,
      notes: notes.trim() || null,
      createdAt: account?.createdAt ?? nowIso(),
      updatedAt: nowIso(),
      institution: institution.trim() || null,
      last4: last4.trim() || null,
      creditLimit: isCard ? creditLimit : null,
      dueDay: dueDay ? Number(dueDay) : null,
      statementDay: statementDay ? Number(statementDay) : null,
      excludeFromNetWorth };

    await saveAccount(row, isNew);

    // An opening balance is a real transaction, so the ledger stays the single
    // source of truth rather than an account carrying a magic starting number.
    if (isNew && opening != null && opening !== 0) {
      const result = await createTransaction({
        type: 'opening',
        date: openingDate,
        accountId: row.id,
        amount: isCard ? -Math.abs(opening) : opening,
        openingAccountId: SYSTEM_IDS.opening });
      if (!result.ok) {
        setSaving(false);
        setError(result.issues[0]?.message ?? 'The opening balance could not be recorded.');
        return;
      }
    }

    setSaving(false);
    toast.saved(isNew ? `${row.name} added` : `${row.name} updated`);
    onClose();
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={isNew ? 'Add an account' : `Edit ${account!.name}`}
      size="md"
      footer={
        <div className="flex gap-2.5">
          <Button variant="secondary" full onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" full loading={saving} onClick={() => void save()}>
            {isNew ? 'Add account' : 'Save changes'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4 pb-2">
        {isNew && (
          <Field label="What kind of account?">
            <ChipGroup
              value={cls}
              onChange={(v) => setCls(v)}
              options={CREATABLE.map((c) => ({ value: c, label: CLASS_META[c].label }))}
            />
            <p className="mt-2 text-xs text-ink-4">{CLASS_META[cls].hint}</p>
          </Field>
        )}

        <Field label="Name" htmlFor="acc-name">
          <TextInput
            id="acc-name"
            data-autofocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={cls === 'cash' ? 'Cash' : 'Meezan Bank'}
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Currency">
            <Select value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {Object.values(CURRENCIES).map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} — {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Institution" optional>
            <TextInput
              value={institution}
              onChange={(e) => setInstitution(e.target.value)}
              placeholder="Bank or provider"
            />
          </Field>
        </div>

        {isCard && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Credit limit" optional>
              <AmountInput value={creditLimit} onChange={setCreditLimit} currency={currency} />
            </Field>
            <Field label="Last 4 digits" optional>
              <TextInput
                value={last4}
                maxLength={4}
                inputMode="numeric"
                onChange={(e) => setLast4(e.target.value.replace(/\D/g, ''))}
                placeholder="1234"
              />
            </Field>
            <Field label="Statement closes on" optional hint="Day of the month">
              <TextInput
                value={statementDay}
                inputMode="numeric"
                onChange={(e) => setStatementDay(e.target.value.replace(/\D/g, '').slice(0, 2))}
                placeholder="25"
              />
            </Field>
            <Field label="Payment due on" optional hint="Day of the month">
              <TextInput
                value={dueDay}
                inputMode="numeric"
                onChange={(e) => setDueDay(e.target.value.replace(/\D/g, '').slice(0, 2))}
                placeholder="12"
              />
            </Field>
          </div>
        )}

        {isNew && (
          <div className="rounded-[--radius] border border-line bg-surface-2/50 p-4">
            <Field
              label={isCard ? 'Amount currently owed' : 'Balance today'}
              optional
              hint={
                isCard
                  ? 'Recorded as an opening balance so the card starts from the right place.'
                  : 'Recorded as an opening balance. You can add or correct it later.'
              }
            >
              <AmountInput value={opening} onChange={setOpening} currency={currency} />
            </Field>
            {opening != null && opening !== 0 && (
              <div className="mt-3">
                <Field label="As at">
                  <DateInput value={openingDate} onChange={setOpeningDate} max={asOf} />
                </Field>
              </div>
            )}
          </div>
        )}

        {cls === 'investment' && (
          <Toggle
            checked={excludeFromNetWorth}
            onChange={setExclude}
            label="Exclude from net worth"
            description="Useful for a pension or anything you would rather not count yet."
          />
        )}

        <Field label="Notes" optional>
          <Textarea value={notes} rows={2} onChange={(e) => setNotes(e.target.value)} />
        </Field>

        {error && <Notice tone="negative">{error}</Notice>}
      </div>
    </Sheet>
  );
}

// ===========================================================================
// Detail
// ===========================================================================

function AccountDetail({
  id,
  onClose,
  onEdit }: {
  id: ID;
  onClose: () => void;
  onEdit: (a: Account) => void;
}) {
  const accounts = useStore((s) => s.accounts);
  const accountMap = useAccountMap();
  const transactions = useStore((s) => s.transactions);
  const settings = useStore((s) => s.settings);
  const balances = useBalances();
  const archiveAccount = useStore((s) => s.archiveAccount);
  const asOf = useToday();

  const [reconciling, setReconciling] = React.useState(false);
  const [confirmArchive, setConfirmArchive] = React.useState(false);

  const account = accounts.find((a) => a.id === id);
  // The full history, revealed a window at a time. Slicing to a fixed 40 hid
  // older activity with no indication it existed.
  const allRows = React.useMemo(() => accountLedger(transactions, id), [transactions, id]);
  const list = useIncremental(allRows.length, 40);
  const rows = React.useMemo(() => allRows.slice(0, list.count), [allRows, list.count]);

  if (!account) return null;

  const balance = balanceOf(balances, account.id);
  const credit = availableCredit(account, balances);
  const meta = CLASS_META[account.class];

  return (
    <Sheet
      open
      onClose={onClose}
      title={account.name}
      description={meta?.label}
      size="lg"
    >
      <div className="space-y-5 pb-2">
        <div className="text-center">
          <Money
            value={balance}
            currency={account.currency}
            hidden={settings.hideAmounts}
            size="display"
            weight="semibold"
            tone={balance < 0 ? 'negative' : 'default'}
          />
          {credit != null && account.creditLimit != null && (
            <p className="mt-2 text-[0.8125rem] text-ink-3">
              <Money value={credit} currency={account.currency} size="sm" symbol={false} /> of{' '}
              <Money value={account.creditLimit} currency={account.currency} size="sm" symbol={false} />{' '}
              still available
            </p>
          )}
          {balance < 0 && account.class !== 'credit_card' && account.class !== 'loan' && (
            <p className="mt-2 text-xs text-warn">
              This account is overdrawn. Pocketa records it rather than hiding it.
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" icon={<Pencil className="size-3.5" />} onClick={() => onEdit(account)}>
            Edit
          </Button>
          <Button size="sm" variant="secondary" icon={<Scale className="size-3.5" />} onClick={() => setReconciling(true)}>
            Reconcile
          </Button>
          <Button
            size="sm"
            variant="secondary"
            icon={account.archived ? <ArchiveRestore className="size-3.5" /> : <Archive className="size-3.5" />}
            onClick={() => (account.archived ? void archiveAccount(account.id, false) : setConfirmArchive(true))}
          >
            {account.archived ? 'Unarchive' : 'Archive'}
          </Button>
        </div>

        {account.notes && <p className="text-sm leading-relaxed text-ink-3">{account.notes}</p>}

        <section>
          <h3 className="eyebrow mb-2">History</h3>
          {rows.length === 0 ? (
            <EmptyState compact title="Nothing recorded yet" body="Transactions in this account will appear here." />
          ) : (
            <div className="-mx-5 divide-y divide-line sm:-mx-6">
              {rows.map((row) => (
                <div key={row.txn.id} className="relative">
                  <TransactionRow
                    txn={row.txn}
                    accounts={accountMap}
                    hidden={settings.hideAmounts}
                    showDate
                    dateLabel={formatRelativeDay(row.txn.date, asOf)}
                  />
                  <span className="pointer-events-none absolute bottom-2 right-5 text-[0.625rem] text-ink-4 sm:right-6">
                    bal{' '}
                    <Money
                      value={row.runningBalance}
                      currency={account.currency}
                      hidden={settings.hideAmounts}
                      size="xs"
                      tone="muted"
                      symbol={false}
                    />
                  </span>
                </div>
              ))}

              {list.hasMore && (
                <div ref={list.sentinelRef} className="flex flex-col items-center gap-2 py-3">
                  <Button variant="secondary" size="sm" onClick={list.showMore}>
                    Show older
                  </Button>
                  <p className="tnum text-xs text-ink-4">
                    {rows.length} of {allRows.length} shown
                  </p>
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      {reconciling && (
        <Reconcile account={account} current={balance} onClose={() => setReconciling(false)} />
      )}

      <Confirm
        open={confirmArchive}
        onClose={() => setConfirmArchive(false)}
        title={`Archive ${account.name}?`}
        confirmLabel="Archive"
        body={
          <>
            The account is hidden from pickers and totals, but every transaction in it is kept and
            stays visible in your history. You can unarchive it at any time.
          </>
        }
        onConfirm={async () => {
          await archiveAccount(account.id, true);
          toast.saved(`${account.name} archived`);
          onClose();
        }}
      />
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

function Reconcile({
  account,
  current,
  onClose }: {
  account: Account;
  current: number;
  onClose: () => void;
}) {
  const createTransaction = useStore((s) => s.createTransaction);
  const asOf = useToday();
  const [counted, setCounted] = React.useState<number | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const delta = counted != null ? counted - current : 0;

  async function apply() {
    if (counted == null) return;
    if (delta === 0) {
      toast.show('Already matching', 'The counted balance is the same as the ledger.');
      onClose();
      return;
    }
    setSaving(true);
    const result = await createTransaction({
      type: 'adjust',
      date: asOf,
      accountId: account.id,
      delta,
      adjustmentAccountId: SYSTEM_IDS.adjustment,
      notes: `Reconciled ${account.name}` });
    setSaving(false);
    if (!result.ok) {
      setError(result.issues[0]?.message ?? 'The adjustment could not be recorded.');
      return;
    }
    toast.saved('Balance reconciled');
    onClose();
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={`Reconcile ${account.name}`}
      description="Tell Pocketa what is really there. The difference is recorded as an adjustment rather than quietly changing your history."
      footer={
        <div className="flex gap-2.5">
          <Button variant="secondary" full onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" full loading={saving} onClick={() => void apply()} disabled={counted == null}>
            Record adjustment
          </Button>
        </div>
      }
    >
      <div className="space-y-4 pb-2">
        <Field label="Counted balance">
          <AmountInput value={counted} onChange={setCounted} currency={account.currency} size="hero" autoFocus />
        </Field>

        <Reckoning
          currency={account.currency}
          lines={[
            { key: 'ledger', label: 'Pocketa says', amount: current, emphasis: true },
            { key: 'counted', label: 'You counted', amount: counted ?? 0 },
          ]}
          total={{ label: 'Adjustment', amount: delta }}
        />

        {delta !== 0 && counted != null && (
          <Notice tone={Math.abs(delta) > current * 0.1 ? 'warn' : 'neutral'}>
            An adjustment of <Money value={delta} currency={account.currency} size="sm" sign="always" /> will
            be recorded against your Adjustments account, dated today. It does not count as income or
            spending, and the original transactions are left untouched.
          </Notice>
        )}

        {error && <Notice tone="negative">{error}</Notice>}
      </div>
    </Sheet>
  );
}
