import * as React from 'react';
import { HandCoins, MessageCircle, Plus, UserPlus, Users } from 'lucide-react';
import { Badge, Button, EmptyState, Notice, Segmented } from '../ui/primitives';
import { Money } from '../ui/Money';
import { cn } from '../ui/cn';
import { Reckoning } from '../ui/Reckoning';
import { Sheet } from '../ui/Sheet';
import { AmountInput, DateInput, Field, Select, TextInput, Textarea } from '../ui/fields';
import { TransactionRow } from '../components/TransactionRow';
import { useIncremental } from '../ui/useIncremental';
import { toast } from '../ui/toast';
import { useAccountMap, useBalances, useSpendableAccounts, useToday } from '../app/useLedger';
import { useStore } from '../store/useStore';
import { accountLedger, balanceOf } from '../core/projections';
import { formatDate as fmtDate, formatRelativeDay, nowIso } from '../core/dates';
import { newId } from '../core/ids';
import type { Account, ID, Person } from '../core/types';

type Direction = 'owed_to_me' | 'i_owe';

export function Debts() {
  const accounts = useStore((s) => s.accounts);
  const people = useStore((s) => s.people);
  const settings = useStore((s) => s.settings);
  const balances = useBalances();
  const hidden = settings.hideAmounts;

  const [addingPerson, setAddingPerson] = React.useState(false);
  const [editingPerson, setEditingPerson] = React.useState<Person | null>(null);
  const [recording, setRecording] = React.useState<{
    direction: Direction;
    personAccountId?: ID;
    mode?: 'new' | 'settle';
  } | null>(null);
  const [detailId, setDetailId] = React.useState<ID | null>(null);
  const [openId, setOpenId] = React.useState<ID | null>(null);

  const receivables = accounts.filter((a) => a.class === 'receivable' && !a.archived);
  const payables = accounts.filter((a) => a.class === 'payable' && !a.archived);

  const owedToMe = receivables.reduce((s, a) => s + balanceOf(balances, a.id), 0);
  const iOwe = payables.reduce((s, a) => s + Math.abs(balanceOf(balances, a.id)), 0);
  const net = owedToMe - iOwe;

  /**
   * One row per person, not one per direction. Someone who owes you 500 and
   * is owed 200 back is one relationship with a net of 300, and that is the
   * figure you settle in your head anyway.
   */
  const rows = React.useMemo(() => {
    const out: PersonRow[] = [];
    for (const person of people) {
      const recv = receivables.find((a) => a.personId === person.id) ?? null;
      const pay = payables.find((a) => a.personId === person.id) ?? null;
      if (!recv && !pay) continue;
      const theyOwe = recv ? balanceOf(balances, recv.id) : 0;
      const youOwe = pay ? Math.abs(balanceOf(balances, pay.id)) : 0;
      out.push({ person, recv, pay, theyOwe, youOwe, net: theyOwe - youOwe });
    }
    // Ignore accounts without a person record — legacy data; still counted in the totals above.
    return out.sort((a, b) => Math.abs(b.net) - Math.abs(a.net) || a.person.name.localeCompare(b.person.name));
  }, [people, receivables, payables, balances]);

  const hasPeople = rows.length > 0;
  const outstanding = rows.filter((r) => r.net !== 0);
  const settled = rows.filter((r) => r.net === 0);
  const [showSettled, setShowSettled] = React.useState(false);

  return (
    <div className="space-y-5">
      <section>
        <p className="label">{net >= 0 ? 'Net in your favour' : 'Net you owe'}</p>
        <div className="count-in mt-2 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <Money
            value={Math.abs(net)}
            currency={settings.baseCurrency}
            hidden={hidden}
            size="display"
            weight="semibold"
            tone={net < 0 ? 'negative' : 'default'}
          />
          <div className="flex gap-5 pb-1.5">
            <span className="flex flex-col">
              <span className="label">Owed to you</span>
              <Money value={owedToMe} currency={settings.baseCurrency} hidden={hidden} size="sm" weight="semibold" symbol={false} tone="positive" />
            </span>
            <span className="flex flex-col">
              <span className="label">You owe</span>
              <Money value={iOwe} currency={settings.baseCurrency} hidden={hidden} size="sm" weight="semibold" symbol={false} tone={iOwe > 0 ? 'negative' : 'muted'} />
            </span>
          </div>
        </div>
        <div className="reckoning-rule reckoning-rule--total mt-4" aria-hidden="true" />
      </section>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="display text-[1.0625rem]">People</h2>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" icon={<UserPlus className="size-3.5" />} onClick={() => setAddingPerson(true)}>
            Add person
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setRecording({ direction: 'i_owe' })} disabled={!hasPeople}>
            Borrow
          </Button>
          <Button
            size="sm"
            variant="primary"
            icon={<Plus className="size-3.5" />}
            onClick={() => setRecording({ direction: 'owed_to_me' })}
            disabled={!hasPeople}
          >
            Lend
          </Button>
        </div>
      </div>

      {!hasPeople ? (
        <EmptyState
          icon={<Users className="size-5" />}
          title="No people yet"
          body="People you lend to, borrow from, or split with."
          action={
            <Button variant="primary" icon={<UserPlus className="size-4" />} onClick={() => setAddingPerson(true)}>
              Add someone
            </Button>
          }
        />
      ) : outstanding.length === 0 && !showSettled ? (
        <EmptyState
          icon={<HandCoins className="size-5" />}
          title="All square"
          body={`Nothing outstanding with ${settled.length === 1 ? 'the one person' : `any of the ${settled.length} people`} you track.`}
          action={
            <Button variant="secondary" onClick={() => setShowSettled(true)}>
              Show everyone
            </Button>
          }
        />
      ) : (
        <ul className="divide-y divide-line rounded-[--radius] border border-line bg-surface">
          {(showSettled ? rows : outstanding).map((row) => (
            <li key={row.person.id}>
              <PersonDebtRow
                row={row}
                hidden={hidden}
                currency={settings.baseCurrency}
                open={openId === row.person.id}
                onToggle={() => setOpenId((id) => (id === row.person.id ? null : row.person.id))}
                onRecord={(direction, personAccountId, mode) => setRecording({ direction, personAccountId, mode })}
                onHistory={(id) => setDetailId(id)}
              />
            </li>
          ))}
        </ul>
      )}

      {hasPeople && settled.length > 0 && outstanding.length > 0 && (
        <button
          type="button"
          onClick={() => setShowSettled((v) => !v)}
          className="text-xs text-ink-3 underline-offset-2 hover:text-ink hover:underline"
        >
          {showSettled ? 'Hide' : 'Show'} {settled.length} settled {settled.length === 1 ? 'person' : 'people'}
        </button>
      )}

      {addingPerson && <PersonEditor onClose={() => setAddingPerson(false)} />}
      {editingPerson && (
        <PersonEditor
          onClose={() => setEditingPerson(null)}
        />
      )}
      {recording && (
        <RecordDebt
          direction={recording.direction}
          personAccountId={recording.personAccountId}
          initialMode={recording.mode}
          onClose={() => setRecording(null)}
        />
      )}
      {detailId && (
        <DebtDetail
          accountId={detailId}
          onClose={() => setDetailId(null)}
          onSettle={(dir, id) => {
            setDetailId(null);
            setRecording({ direction: dir, personAccountId: id });
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

interface PersonRow {
  person: Person;
  recv: Account | null;
  pay: Account | null;
  /** What they owe you, in minor units. */
  theyOwe: number;
  /** What you owe them. */
  youOwe: number;
  net: number;
}

function PersonDebtRow({
  row,
  hidden,
  currency,
  open,
  onToggle,
  onRecord,
  onHistory,
}: {
  row: PersonRow;
  hidden: boolean;
  currency: string;
  open: boolean;
  onToggle: () => void;
  onRecord: (direction: Direction, personAccountId: ID, mode: 'new' | 'settle') => void;
  onHistory: (accountId: ID) => void;
}) {
  const transactions = useStore((s) => s.transactions);
  const debts = useStore((s) => s.debts);
  const accountMap = useAccountMap();
  const asOf = useToday();
  const { person, recv, pay, theyOwe, youOwe, net } = row;

  const recent = React.useMemo(() => {
    if (!open) return [];
    const ids = [recv?.id, pay?.id].filter(Boolean) as ID[];
    return ids
      .flatMap((id) => accountLedger(transactions, id))
      .sort((a, b) => (a.txn.date < b.txn.date ? 1 : a.txn.date > b.txn.date ? -1 : 0))
      .filter((r, i, arr) => arr.findIndex((x) => x.txn.id === r.txn.id) === i)
      .slice(0, 4);
  }, [open, transactions, recv?.id, pay?.id]);

  const due = debts.find((d) => d.personId === person.id && !d.settled && d.dueDate)?.dueDate ?? null;
  const overdue = due != null && due < asOf && net !== 0;
  const both = theyOwe > 0 && youOwe > 0;

  const tone = net > 0 ? 'text-positive' : net < 0 ? 'text-negative' : 'text-ink-4';
  const word = net > 0 ? 'owes you' : net < 0 ? 'you owe' : 'settled';

  // Build WhatsApp breakdown message
  function openWhatsApp() {
    const phone = person.contact?.replace(/[^0-9+]/g, '') ?? '';
    const lines: string[] = [`*Money summary with ${person.name}*`];
    if (theyOwe > 0) lines.push(`They owe you: Rs. ${(theyOwe / 100).toLocaleString()}`);
    if (youOwe > 0) lines.push(`You owe them: Rs. ${(youOwe / 100).toLocaleString()}`);
    lines.push(`Net: Rs. ${(Math.abs(net) / 100).toLocaleString()} ${net >= 0 ? '(in your favour)' : '(you owe)'}`);
    if (recent.length > 0) {
      lines.push('');
      lines.push('*Recent transactions:*');
      recent.slice(0, 3).forEach((r) => {
        const sign = r.delta > 0 ? '+' : '-';
        lines.push(`${sign}Rs. ${(Math.abs(r.delta) / 100).toLocaleString()} · ${r.txn.date}`);
      });
    }
    const text = encodeURIComponent(lines.join('\n'));
    const url = phone ? `https://wa.me/${phone}?text=${text}` : `https://wa.me/?text=${text}`;
    window.open(url, '_blank', 'noopener');
  }

  return (
    <div className={cn('border-l-[3px]', overdue ? 'border-l-warn-fill' : net > 0 ? 'border-l-positive-fill' : net < 0 ? 'border-l-negative-fill' : 'border-l-transparent')}>
      {/* Summary row — always visible */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={cn(
          'flex w-full items-center gap-4 px-4 py-3.5 text-left transition-colors',
          open ? 'bg-surface-2/50' : 'hover:bg-surface-2/50',
        )}
      >
        {/* Large avatar */}
        <span
          className="flex size-11 shrink-0 items-center justify-center rounded-full text-base font-semibold text-white"
          style={{ background: person.color ?? (net >= 0 ? '#2E7D5B' : '#B04A3F') }}
        >
          {person.name.slice(0, 1).toUpperCase()}
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-[0.9375rem] font-semibold text-ink">{person.name}</p>
          <p className="mt-0.5 truncate text-xs text-ink-3">
            {overdue ? `Overdue since ${fmtDate(due!)}` : due && net !== 0 ? `Due ${fmtDate(due)}` : person.contact ?? word}
          </p>
        </div>

        <div className="shrink-0 text-right">
          <p className={cn('tnum text-[0.9375rem] font-semibold', tone)}>
            {hidden ? '•••' : `Rs. ${(Math.abs(net) / 100).toLocaleString()}`}
          </p>
          <p className="mt-0.5 text-[0.6875rem] text-ink-4">{word}</p>
        </div>
      </button>

      {/* Expanded detail */}
      <div className="disclose" data-open={open || undefined}>
        <div>
          <div className="space-y-4 px-4 pb-4 pt-1">
            {both && (
              <Reckoning
                size="sm"
                currency={currency}
                hidden={hidden}
                showSigns={false}
                lines={[
                  { key: 'they', label: 'They owe you', amount: theyOwe },
                  { key: 'you', label: 'You owe them', amount: youOwe },
                ]}
                total={{ label: net >= 0 ? 'Net, in your favour' : 'Net, you owe', amount: Math.abs(net) }}
              />
            )}

            {recent.length > 0 && (
              <div className={cn('-mx-4 divide-y divide-line', both && 'mt-3')}>
                {recent.map((r) => (
                  <TransactionRow
                    key={r.txn.id}
                    txn={r.txn}
                    accounts={accountMap}
                    hidden={hidden}
                    showDate
                    dateLabel={formatRelativeDay(r.txn.date, asOf)}
                    className="px-4"
                  />
                ))}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {net > 0 && recv && (
                <Button size="sm" variant="primary" onClick={() => onRecord('owed_to_me', recv.id, 'settle')}>
                  They paid back
                </Button>
              )}
              {net < 0 && pay && (
                <Button size="sm" variant="primary" onClick={() => onRecord('i_owe', pay.id, 'settle')}>
                  Pay back
                </Button>
              )}
              {recv && (
                <Button size="sm" variant="secondary" onClick={() => onRecord('owed_to_me', recv.id, 'new')}>
                  Lend {net > 0 ? 'more' : ''}
                </Button>
              )}
              {pay && (
                <Button size="sm" variant="secondary" onClick={() => onRecord('i_owe', pay.id, 'new')}>
                  Borrow {net < 0 ? 'more' : ''}
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => onHistory((net < 0 ? pay : recv)?.id ?? (recv ?? pay)!.id)}>
                History
              </Button>
              {net !== 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<MessageCircle className="size-3.5 text-[#25D366]" />}
                  onClick={openWhatsApp}
                >
                  WhatsApp
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function PersonEditor({ onClose }: { onClose: () => void }) {
  const addPerson = useStore((s) => s.addPerson);
  const [name, setName] = React.useState('');
  const [contact, setContact] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  async function save() {
    if (!name.trim()) return setError('Enter a name.');
    // The person and both of their accounts, in one write — the same path the
    // sentence parser uses when it meets somebody new.
    await addPerson(name, contact);
    toast.saved(`${name.trim()} added`);
    onClose();
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="Add a person"
      description="Someone you lend to, borrow from, or split bills with."
      footer={
        <div className="flex gap-2.5">
          <Button variant="secondary" full onClick={onClose}>Cancel</Button>
          <Button variant="primary" full onClick={() => void save()}>Add person</Button>
        </div>
      }
    >
      <div className="space-y-4 pb-2">
        <Field label="Name" htmlFor="p-name">
          <TextInput id="p-name" data-autofocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Sara" />
        </Field>
        <Field label="Phone or email" optional>
          <TextInput value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Just for your reference" />
        </Field>
        {error && <Notice tone="negative">{error}</Notice>}
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------

function RecordDebt({
  direction,
  personAccountId,
  initialMode,
  onClose }: {
  direction: Direction;
  personAccountId?: ID;
  initialMode?: 'new' | 'settle';
  onClose: () => void;
}) {
  const accounts = useStore((s) => s.accounts);
  const people = useStore((s) => s.people);
  const createTransaction = useStore((s) => s.createTransaction);
  const saveDebt = useStore((s) => s.saveDebt);
  const spendable = useSpendableAccounts();
  const balances = useBalances();
  const asOf = useToday();

  const wantedClass = direction === 'owed_to_me' ? 'receivable' : 'payable';
  const personAccounts = accounts.filter((a) => a.class === wantedClass && !a.archived);

  const [mode, setMode] = React.useState<'new' | 'settle'>(initialMode ?? (personAccountId ? 'settle' : 'new'));
  const [personAcc, setPersonAcc] = React.useState<ID | ''>(personAccountId ?? personAccounts[0]?.id ?? '');
  const [myAccount, setMyAccount] = React.useState<ID | ''>(spendable[0]?.id ?? '');
  const [amount, setAmount] = React.useState<number | null>(null);
  const [date, setDate] = React.useState(asOf);
  const [dueDate, setDueDate] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const outstanding = personAcc ? Math.abs(balanceOf(balances, personAcc)) : 0;

  async function submit() {
    if (!personAcc || !myAccount) return setError('Choose both accounts.');
    if (amount == null || amount <= 0) return setError('Enter an amount greater than zero.');
    if (mode === 'settle' && amount > outstanding) {
      return setError('That is more than the outstanding balance.');
    }

    setSaving(true);
    const kind =
      direction === 'owed_to_me'
        ? mode === 'new' ? 'lend' : 'repay_in'
        : mode === 'new' ? 'borrow' : 'repay_out';

    // lend:      my account → their receivable
    // repay_in:  their receivable → my account
    // borrow:    their payable → my account
    // repay_out: my account → their payable
    const from = kind === 'lend' || kind === 'repay_out' ? myAccount : personAcc;
    const to = kind === 'lend' || kind === 'repay_out' ? personAcc : myAccount;

    const person = people.find((p) => p.id === accounts.find((a) => a.id === personAcc)?.personId);

    const result = await createTransaction({
      type: 'move',
      kind,
      date,
      fromAccountId: from,
      toAccountId: to,
      amount,
      merchant: person?.name ?? null,
      notes: notes.trim() || null });

    if (!result.ok) {
      setSaving(false);
      setError(result.issues[0]?.message ?? 'This could not be recorded.');
      return;
    }

    if (mode === 'new' && person) {
      await saveDebt(
        {
          id: newId('dbt'),
          direction,
          personId: person.id,
          accountId: personAcc,
          name: `${direction === 'owed_to_me' ? 'Lent to' : 'Borrowed from'} ${person.name}`,
          principal: amount,
          currency: accounts.find((a) => a.id === personAcc)?.currency ?? 'PKR',
          dueDate: dueDate || null,
          notes: notes.trim() || null,
          settled: false,
          settledAt: null,
          createdAt: nowIso(),
          updatedAt: nowIso() },
        true,
      );
    }

    setSaving(false);
    toast.saved('Recorded');
    onClose();
  }

  const verb =
    direction === 'owed_to_me'
      ? mode === 'new' ? 'Lend money' : 'Record a repayment'
      : mode === 'new' ? 'Borrow money' : 'Repay what you owe';

  return (
    <Sheet
      open
      onClose={onClose}
      title={verb}
      footer={
        <div className="flex gap-2.5">
          <Button variant="secondary" full onClick={onClose}>Cancel</Button>
          <Button variant="primary" full loading={saving} onClick={() => void submit()}>Record</Button>
        </div>
      }
    >
      <div className="space-y-4 pb-2">
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: 'new', label: direction === 'owed_to_me' ? 'I lent money' : 'I borrowed money' },
            { value: 'settle', label: direction === 'owed_to_me' ? 'They paid me back' : 'I paid them back' },
          ]}
        />

        <Field label="Person">
          <Select value={personAcc} onChange={(e) => setPersonAcc(e.target.value as ID)}>
            <option value="">Choose a person</option>
            {personAccounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </Select>
        </Field>

        {mode === 'settle' && personAcc && (
          <Notice tone="neutral">
            Outstanding: <Money value={outstanding} size="sm" />
          </Notice>
        )}

        <Field label="Amount">
          <AmountInput value={amount} onChange={setAmount} size="hero" autoFocus />
        </Field>

        <Field label={direction === 'owed_to_me' ? (mode === 'new' ? 'Paid from' : 'Received into') : (mode === 'new' ? 'Received into' : 'Paid from')}>
          <Select value={myAccount} onChange={(e) => setMyAccount(e.target.value as ID)}>
            <option value="">Choose an account</option>
            {spendable.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </Select>
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Date">
            <DateInput value={date} onChange={setDate} />
          </Field>
          {mode === 'new' && (
            <Field label="Due back by" optional>
              <DateInput value={dueDate} onChange={setDueDate} min={date} />
            </Field>
          )}
        </div>

        <Field label="Notes" optional>
          <Textarea value={notes} rows={2} onChange={(e) => setNotes(e.target.value)} />
        </Field>

        {error && <Notice tone="negative">{error}</Notice>}
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------

function DebtDetail({
  accountId,
  onClose,
  onSettle }: {
  accountId: ID;
  onClose: () => void;
  onSettle: (direction: Direction, personAccountId: ID) => void;
}) {
  const accounts = useStore((s) => s.accounts);
  const accountMap = useAccountMap();
  const people = useStore((s) => s.people);
  const debts = useStore((s) => s.debts);
  const transactions = useStore((s) => s.transactions);
  const settings = useStore((s) => s.settings);
  const balances = useBalances();
  const asOf = useToday();

  const account = accounts.find((a) => a.id === accountId);
  const allRows = React.useMemo(() => accountLedger(transactions, accountId), [transactions, accountId]);
  const list = useIncremental(allRows.length, 40);
  const rows = React.useMemo(() => allRows.slice(0, list.count), [allRows, list.count]);
  if (!account) return null;

  const person = people.find((p) => p.id === account.personId);
  const balance = Math.abs(balanceOf(balances, accountId));
  const direction: Direction = account.class === 'receivable' ? 'owed_to_me' : 'i_owe';
  const record = debts.find((d) => d.accountId === accountId && !d.settled);

  const lent = rows
    .filter((r) => (direction === 'owed_to_me' ? r.delta > 0 : r.delta < 0))
    .reduce((s, r) => s + Math.abs(r.delta), 0);
  const repaid = rows
    .filter((r) => (direction === 'owed_to_me' ? r.delta < 0 : r.delta > 0))
    .reduce((s, r) => s + Math.abs(r.delta), 0);

  return (
    <Sheet
      open
      onClose={onClose}
      title={person?.name ?? account.name}
      description={direction === 'owed_to_me' ? 'Owes you' : 'You owe'}
      size="lg"
      footer={
        <Button variant="primary" full onClick={() => onSettle(direction, accountId)} disabled={balance === 0}>
          {direction === 'owed_to_me' ? 'Record a repayment' : 'Record a payment'}
        </Button>
      }
    >
      <div className="space-y-5 pb-2">
        <div className="text-center">
          <Money
            value={balance}
            currency={account.currency}
            hidden={settings.hideAmounts}
            size="display"
            weight="semibold"
            tone={balance === 0 ? 'muted' : direction === 'owed_to_me' ? 'positive' : 'negative'}
          />
          {balance === 0 && <Badge tone="positive" className="mt-2">Settled</Badge>}
        </div>

        <Reckoning
          currency={account.currency}
          hidden={settings.hideAmounts}
          showSigns={false}
          lines={[
            { key: 'orig', label: direction === 'owed_to_me' ? 'Total lent' : 'Total borrowed', amount: lent, emphasis: true },
            { key: 'paid', label: 'Repaid so far', amount: repaid },
          ]}
          total={{ label: 'Outstanding', amount: balance }}
        />

        {record?.dueDate && (
          <Notice tone={record.dueDate < asOf && balance > 0 ? 'warn' : 'neutral'}>
            {record.dueDate < asOf && balance > 0
              ? `This was due back on ${fmtDate(record.dueDate)}.`
              : `Due back by ${fmtDate(record.dueDate)}.`}
          </Notice>
        )}

        {record?.notes && <p className="text-sm leading-relaxed text-ink-3">{record.notes}</p>}

        <section>
          <h3 className="eyebrow mb-2">History</h3>
          {rows.length === 0 ? (
            <EmptyState compact title="Nothing recorded yet" />
          ) : (
            <div className="-mx-5 divide-y divide-line sm:-mx-6">
              {rows.map((row) => (
                <TransactionRow
                  key={row.txn.id}
                  txn={row.txn}
                  accounts={accountMap}
                  hidden={settings.hideAmounts}
                  showDate
                  dateLabel={formatRelativeDay(row.txn.date, asOf)}
                />
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
    </Sheet>
  );
}
