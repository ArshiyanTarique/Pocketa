import * as React from 'react';
import {
  ArrowLeftRight,
  ArrowDownLeft,
  ArrowUpRight,
  ChevronDown,
  HandCoins,
  Plus,
  Split,
  Trash2,
  Undo2,
  Users,
  Wand2,
} from 'lucide-react';
import { Sheet } from '../ui/Sheet';
import { Button, Badge, Notice, Segmented } from '../ui/primitives';
import { AmountInput, ChipGroup, DateInput, Field, Select, TagInput, TextInput, Textarea } from '../ui/fields';
import { ReckoningInline } from '../ui/Reckoning';
import { AttachmentPicker } from './Attachments';
import { Money } from '../ui/Money';
import { cn } from '../ui/cn';
import { toast } from '../ui/toast';
import { useStore } from '../store/useStore';
import {
  useFlatCategories,
  useLastUsed,
  useMerchantMemory,
  useMerchants,
  useSpendableAccounts,
  useTags,
  useToday,
} from '../app/useLedger';
import { allocateEvenly, sumMinor, CURRENCIES } from '../core/money';
import { formatDate } from '../core/dates';
import { parseNaturalLanguage, describeParse } from '../core/nlp';
import type { Allocation, Issue, Share } from '../core/ledger';
import type { TxnDraft } from '../core/draft';
import { TXN_KIND_LABELS, type ID } from '../core/types';

type Mode = 'expense' | 'income' | 'transfer' | 'debt' | 'refund';

const MODES: Array<{ value: Mode; label: string; icon: React.ReactNode }> = [
  { value: 'expense', label: 'Expense', icon: <ArrowUpRight className="size-3.5" /> },
  { value: 'income', label: 'Income', icon: <ArrowDownLeft className="size-3.5" /> },
  { value: 'transfer', label: 'Transfer', icon: <ArrowLeftRight className="size-3.5" /> },
  { value: 'debt', label: 'Debt', icon: <HandCoins className="size-3.5" /> },
  { value: 'refund', label: 'Refund', icon: <Undo2 className="size-3.5" /> },
];

type Parsed = ReturnType<typeof parseNaturalLanguage>;

export function QuickAdd({
  open,
  onClose,
  editingId,
}: {
  open: boolean;
  onClose: () => void;
  editingId?: ID | null;
}) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={editingId ? 'Edit transaction' : 'Add transaction'}
      size="lg"
    >
      {/* The sheet unmounts its content when closed, so the tab and any
          accepted sentence reset by construction rather than by an effect. */}
      <AddBody key={editingId ?? 'new'} onClose={onClose} editingId={editingId ?? null} />
    </Sheet>
  );
}

function AddBody({ onClose, editingId }: { onClose: () => void; editingId: ID | null }) {
  const [tab, setTab] = React.useState<'form' | 'sentence'>('form');
  // A sentence the person accepted, handed to the form to pre-fill it.
  const [seed, setSeed] = React.useState<Parsed | null>(null);

  return (
    <>
      {!editingId && (
        <div className="mb-4">
          <Segmented
            label="Entry mode"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'form', label: 'Quick' },
              {
                value: 'sentence',
                label: (
                  <span className="flex items-center gap-1.5">
                    <Wand2 className="size-3.5" /> Type a sentence
                  </span>
                ),
              },
            ]}
          />
        </div>
      )}

      {tab === 'sentence' && !editingId ? (
        <SentenceEntry
          onClose={onClose}
          onAccept={(parsed) => {
            setSeed(parsed);
            setTab('form');
          }}
        />
      ) : (
        <TransactionForm onClose={onClose} editingId={editingId} seed={seed} />
      )}
    </>
  );
}

// ===========================================================================
// Natural language entry — proposes, never saves
// ===========================================================================

/**
 * The sentence reads itself as you type.
 *
 * The proposal sits under the text and updates as the sentence changes, so a
 * wrong guess is visible while the person is still typing and can be fixed
 * with one more word. It is still only a proposal (R11): accepting it opens
 * the form, pre-filled, and saving is a separate, deliberate step there.
 */
function SentenceEntry({ onClose, onAccept }: { onClose: () => void; onAccept: (parsed: Parsed) => void }) {
  const accounts = useStore((s) => s.accounts);
  const addPerson = useStore((s) => s.addPerson);
  const asOf = useToday();
  const [text, setText] = React.useState('');
  const [adding, setAdding] = React.useState(false);

  const categories = useFlatCategories('expense_category');
  const incomeCategories = useFlatCategories('income_category');
  const merchants = useMerchants();
  const merchantMemory = useMerchantMemory();

  // Parse on a short delay, so the chips settle rather than flicker per key.
  const [proposal, setProposal] = React.useState<Parsed | null>(null);
  React.useEffect(() => {
    if (!text.trim()) {
      setProposal(null);
      return;
    }
    const timer = setTimeout(() => {
      setProposal(parseNaturalLanguage(text, { accounts, asOf, merchants, merchantMemory }));
    }, 180);
    return () => clearTimeout(timer);
  }, [text, accounts, asOf, merchants, merchantMemory]);

  // Examples in the person's own vocabulary once they have one.
  const examples = React.useMemo(() => {
    const own = merchants.slice(0, 2).map((m) => `${m.toLowerCase()} 450`);
    const base = ['careem 350 to uni', '2 chai 120', 'rent 25000 on the 1st', 'lent ali 500'];
    return [...own, ...base].slice(0, 4);
  }, [merchants]);

  const catList = proposal?.kind === 'income' || proposal?.kind === 'repay_in' ? incomeCategories : categories;
  const category = proposal ? catList.find((c) => c.id === proposal.categoryId) : undefined;
  const byId = (id: ID | null) => (id ? accounts.find((a) => a.id === id) : undefined);
  const from = proposal ? byId(proposal.accountId) : undefined;
  const to = proposal ? byId(proposal.toAccountId) : undefined;
  const notes = proposal ? describeParse(proposal) : [];
  const ready = !!proposal && proposal.amount != null;
  const isDebt =
    proposal?.kind === 'lend' || proposal?.kind === 'borrow' || proposal?.kind === 'repay_in' || proposal?.kind === 'repay_out';

  /**
   * Hand the proposal to the form. If it names somebody the ledger has not
   * met, they are created first — person and both accounts, in one write — so
   * the form opens with the debt already pointed at them.
   */
  async function accept() {
    if (!proposal) return;
    let handoff = proposal;

    if (proposal.personName && isDebt && !from && !to) {
      setAdding(true);
      try {
        const ids = await addPerson(proposal.personName);
        // Lending and being repaid touch what they owe me; borrowing and
        // paying back touch what I owe them.
        const theirs =
          proposal.kind === 'lend' || proposal.kind === 'repay_in' ? ids.receivableId : ids.payableId;
        handoff =
          proposal.kind === 'lend' || proposal.kind === 'repay_out'
            ? { ...proposal, toAccountId: theirs }
            : { ...proposal, accountId: theirs };
      } finally {
        setAdding(false);
      }
    }

    onAccept(handoff);
  }

  return (
    <div className="space-y-4 pb-2">
      <Field label="Say what happened">
        <Textarea
          data-autofocus
          rows={2}
          value={text}
          placeholder="optp 850 yesterday"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (ready) void accept();
            }
          }}
        />
      </Field>

      {!proposal && (
        <div className="flex flex-wrap gap-1.5">
          {examples.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => setText(ex)}
              className="rounded-full border border-line px-3 py-1.5 text-xs font-medium text-ink-2 transition-colors hover:border-accent hover:text-accent"
            >
              {ex}
            </button>
          ))}
        </div>
      )}

      {proposal && (
        <div className="fade-in space-y-3">
          {/* R11: a parsed transaction is only ever a proposal until confirmed. */}
          <div className="rounded-[--radius] border border-line bg-surface-2 p-4">
            <dl className="space-y-2.5 text-sm">
              <ParsedRow label="Amount" confident={proposal.found.has('amount')}>
                {proposal.amount != null ? <Money value={proposal.amount} weight="medium" /> : <Missing />}
              </ParsedRow>
              <ParsedRow label="Type" confident={proposal.found.has('kind')}>
                {TXN_KIND_LABELS[proposal.kind]}
              </ParsedRow>
              {proposal.kind !== 'transfer' && (
                <ParsedRow label="Category" confident={proposal.found.has('category')}>
                  {category ? category.path : <Missing />}
                </ParsedRow>
              )}
              <ParsedRow
                label={proposal.kind === 'borrow' || proposal.kind === 'repay_in' ? 'From' : 'Account'}
                confident={proposal.found.has('account')}
              >
                {from ? from.name : <Missing />}
              </ParsedRow>
              {to && (
                <ParsedRow label={proposal.kind === 'transfer' ? 'To' : proposal.kind === 'lend' || proposal.kind === 'repay_out' ? 'To' : 'Into'} confident>
                  {to.name}
                </ParsedRow>
              )}
              {proposal.personName && !from && !to && (
                <ParsedRow label="Person" confident>
                  <span className="flex items-center gap-2">
                    {proposal.personName}
                    <Badge tone="accent">new</Badge>
                  </span>
                </ParsedRow>
              )}
              <ParsedRow label="Date" confident={proposal.found.has('date')}>
                {formatDate(proposal.date, 'long')}
              </ParsedRow>
              {proposal.merchant && (
                <ParsedRow label="Merchant" confident={proposal.found.has('merchant')}>
                  {proposal.merchant}
                </ParsedRow>
              )}
              {proposal.tags.length > 0 && (
                <ParsedRow label="Tags" confident>
                  {proposal.tags.map((t) => `#${t}`).join(' ')}
                </ParsedRow>
              )}
              {proposal.notes && (
                <ParsedRow label="Note" confident>
                  <span className="text-ink-2">{proposal.notes}</span>
                </ParsedRow>
              )}
            </dl>
          </div>

          {notes.length > 0 && (
            <ul className="space-y-1 text-xs text-ink-3">
              {notes.map((n) => (
                <li key={n}>• {n}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="flex gap-2.5">
        <Button variant="secondary" full onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" full onClick={() => void accept()} disabled={!ready} loading={adding}>
          {proposal?.personName && isDebt && !from && !to ? `Add ${proposal.personName} and review` : 'Review and save'}
        </Button>
      </div>
      <p className="text-center text-[0.6875rem] text-ink-4">Nothing is saved until you confirm the form.</p>
    </div>
  );
}

function ParsedRow({
  label,
  children,
  confident,
}: {
  label: string;
  children: React.ReactNode;
  confident?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-ink-3">{label}</dt>
      <dd className="flex items-center gap-2 text-right font-medium text-ink">
        {children}
        {!confident && <Badge tone="warn">guessed</Badge>}
      </dd>
    </div>
  );
}

function Missing() {
  return <span className="text-ink-4">Not found</span>;
}

// ===========================================================================
// The form
// ===========================================================================

function TransactionForm({
  onClose,
  editingId,
  seed,
}: {
  onClose: () => void;
  editingId: ID | null;
  /** An accepted sentence to pre-fill from. */
  seed?: Parsed | null;
}) {
  const asOf = useToday();
  const settings = useStore((s) => s.settings);
  const transactions = useStore((s) => s.transactions);
  const createTransaction = useStore((s) => s.createTransaction);
  const updateTransaction = useStore((s) => s.updateTransaction);
  const voidTransaction = useStore((s) => s.voidTransaction);
  const linkAttachments = useStore((s) => s.linkAttachments);
  const accountsAll = useStore((s) => s.accounts);

  const spendable = useSpendableAccounts();
  const expenseCategories = useFlatCategories('expense_category');
  const incomeCategories = useFlatCategories('income_category');
  const merchants = useMerchants();
  const merchantMemory = useMerchantMemory();
  const knownTags = useTags();
  const lastUsed = useLastUsed();

  const editing = editingId ? transactions.find((t) => t.id === editingId) ?? null : null;

  // --- form state --------------------------------------------------------
  const [mode, setMode] = React.useState<Mode>('expense');
  const [amount, setAmount] = React.useState<number | null>(null);
  const [categoryId, setCategoryId] = React.useState<ID | null>(null);
  const [accountId, setAccountId] = React.useState<ID | null>(null);
  const [toAccountId, setToAccountId] = React.useState<ID | null>(null);
  const [toAmount, setToAmount] = React.useState<number | null>(null);
  const [date, setDate] = React.useState(asOf);
  const [merchant, setMerchant] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [tags, setTags] = React.useState<string[]>([]);
  const [attachmentIds, setAttachmentIds] = React.useState<ID[]>([]);
  // Null means "whatever the account is in"; set only on a deliberate override.
  const [currencyOverride, setCurrencyOverride] = React.useState<string | null>(null);
  const [showDetails, setShowDetails] = React.useState(false);
  const [splits, setSplits] = React.useState<Allocation[] | null>(null);
  const [shares, setShares] = React.useState<Share[] | null>(null);
  const [refundOf, setRefundOf] = React.useState<ID | null>(null);
  const [issues, setIssues] = React.useState<Issue[]>([]);
  const [saving, setSaving] = React.useState(false);

  // --- seed from an edit, a parse, or smart defaults ----------------------
  React.useEffect(() => {
    if (editing) {
      const d = describeForEdit(editing.id);
      if (d) applyDraft(d);
      return;
    }
    if (seed) {
      const p = seed;
      const debt = p.kind === 'lend' || p.kind === 'borrow' || p.kind === 'repay_in' || p.kind === 'repay_out';
      setMode(
        p.kind === 'income' ? 'income'
          : p.kind === 'transfer' ? 'transfer'
            : p.kind === 'refund' ? 'refund'
              : debt ? 'debt'
                : 'expense',
      );
      setAmount(p.amount);
      setCategoryId(p.categoryId);
      // For a borrowing the money arrives in one of my accounts; the parser
      // put the person on the "from" side, so the usual default goes on "to".
      const usual = lastUsed.accountId ?? spendable[0]?.id ?? null;
      setAccountId(p.accountId ?? usual);
      setToAccountId(p.toAccountId ?? ((debt && (p.kind === 'borrow' || p.kind === 'repay_in')) ? usual : null));
      setDate(p.date);
      setMerchant(p.merchant ?? '');
      setTags(p.tags);
      if (p.notes) setNotes(p.notes);
      setShowDetails(true);
      return;
    }
    // Smart defaults: the account and category used most recently.
    setAccountId(lastUsed.accountId ?? spendable[0]?.id ?? null);
    setCategoryId(lastUsed.categoryId ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId]);

  function describeForEdit(id: ID) {
    const txn = transactions.find((t) => t.id === id);
    if (!txn) return null;
    return txn;
  }

  function applyDraft(txn: NonNullable<ReturnType<typeof describeForEdit>>) {
    const accMap = new Map(accountsAll.map((a) => [a.id, a]));
    const isCat = (id: ID) => {
      const c = accMap.get(id)?.class;
      return c === 'expense_category' || c === 'income_category';
    };
    setDate(txn.date);
    setMerchant(txn.merchant ?? '');
    setNotes(txn.notes ?? '');
    setTags(txn.tags);
    setAttachmentIds(txn.attachmentIds);
    setShowDetails(true);

    if (txn.kind === 'income') {
      setMode('income');
      const dest = txn.postings.find((p) => p.amount > 0 && !isCat(p.accountId));
      const cat = txn.postings.filter((p) => accMap.get(p.accountId)?.class === 'income_category');
      setAccountId(dest?.accountId ?? null);
      setCategoryId(cat[0]?.accountId ?? null);
      setAmount(cat.reduce((s, p) => s + -p.amount, 0));
    } else if (txn.kind === 'expense') {
      setMode('expense');
      const src = txn.postings.find((p) => p.amount < 0 && !isCat(p.accountId));
      const cats = txn.postings.filter((p) => accMap.get(p.accountId)?.class === 'expense_category');
      const shareLegs = txn.postings.filter((p) => accMap.get(p.accountId)?.class === 'receivable');
      setAccountId(src?.accountId ?? null);
      setCategoryId(cats[0]?.accountId ?? null);
      if (src && src.currency !== accMap.get(src.accountId)?.currency) setCurrencyOverride(src.currency);
      setAmount(src ? -src.amount : null);
      if (cats.length > 1) {
        setSplits(cats.map((p) => ({ categoryId: p.accountId, amount: p.amount })));
      }
      if (shareLegs.length > 0) {
        setShares(shareLegs.map((p) => ({ personAccountId: p.accountId, amount: p.amount })));
      }
    } else if (txn.kind === 'refund') {
      setMode('refund');
      const dest = txn.postings.find((p) => p.amount > 0 && !isCat(p.accountId));
      const cats = txn.postings.filter((p) => accMap.get(p.accountId)?.class === 'expense_category');
      setAccountId(dest?.accountId ?? null);
      setCategoryId(cats[0]?.accountId ?? null);
      setAmount(cats.reduce((s, p) => s + -p.amount, 0));
      setRefundOf(txn.linkedTxnId);
    } else {
      setMode(txn.kind === 'lend' || txn.kind === 'borrow' || txn.kind === 'repay_in' || txn.kind === 'repay_out' ? 'debt' : 'transfer');
      const from = txn.postings.find((p) => p.amount < 0);
      const to = txn.postings.find((p) => p.amount > 0);
      setAccountId(from?.accountId ?? null);
      setToAccountId(to?.accountId ?? null);
      setAmount(from ? -from.amount : null);
      if (from && to && from.currency !== to.currency) setToAmount(to.amount);
    }
  }

  // Learn the category from the merchant, the way a person would remember.
  React.useEffect(() => {
    if (editing || mode !== 'expense' || !merchant.trim() || splits) return;
    const remembered = merchantMemory.get(merchant.trim().toLowerCase());
    if (remembered) setCategoryId(remembered);
  }, [merchant, mode, merchantMemory, editing, splits]);

  const peopleAccounts = React.useMemo(
    () => accountsAll.filter((a) => (a.class === 'receivable' || a.class === 'payable') && !a.archived),
    [accountsAll],
  );

  const refundable = React.useMemo(
    () =>
      transactions
        .filter((t) => !t.voided && t.kind === 'expense')
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 60),
    [transactions],
  );

  const splitTotal = splits ? sumMinor(splits.map((s) => s.amount)) : 0;
  const shareTotal = shares ? sumMinor(shares.map((s) => s.amount)) : 0;

  // --- build the draft ---------------------------------------------------
  function buildDraft(): TxnDraft | null {
    const base = {
      date,
      merchant: merchant.trim() || null,
      notes: notes.trim() || null,
      tags,
      attachmentIds,
    };

    if (mode === 'expense') {
      if (!accountId || amount == null) return null;
      const allocations: Allocation[] = splits
        ? splits.filter((s) => s.amount !== 0)
        : categoryId
          ? [{ categoryId, amount: amount - shareTotal }]
          : [];
      if (allocations.length === 0) return null;
      return { ...base, type: 'spend', accountId, allocations, shares: shares ?? undefined, currency: txnCurrency };
    }

    if (mode === 'income') {
      if (!accountId || !categoryId || amount == null) return null;
      return { ...base, type: 'earn', accountId, allocations: [{ categoryId, amount }], currency: txnCurrency };
    }

    if (mode === 'refund') {
      if (!accountId || !categoryId || amount == null || !refundOf) return null;
      return {
        ...base,
        type: 'refund',
        originalTxnId: refundOf,
        toAccountId: accountId,
        allocations: [{ categoryId, amount }],
        currency: txnCurrency,
      };
    }

    // transfer + debt share one shape
    if (!accountId || !toAccountId || amount == null) return null;
    const from = spendable.concat(peopleAccounts).find((a) => a.id === accountId);
    const to = spendable.concat(peopleAccounts).find((a) => a.id === toAccountId);
    const kind =
      mode === 'debt'
        ? to?.class === 'receivable'
          ? 'lend'
          : from?.class === 'payable'
            ? 'borrow'
            : from?.class === 'receivable'
              ? 'repay_in'
              : 'repay_out'
        : to?.class === 'credit_card'
          ? 'cc_payment'
          : to?.class === 'goal'
            ? 'goal_contribution'
            : from?.class === 'goal'
              ? 'goal_withdrawal'
              : 'transfer';

    return {
      ...base,
      type: 'move',
      kind,
      fromAccountId: accountId,
      toAccountId,
      amount,
      toAmount: toAmount ?? undefined,
    };
  }

  async function save(addAnother: boolean) {
    const draft = buildDraft();
    if (!draft) {
      setIssues([{ code: 'incomplete', message: 'Fill in the amount, account and category first.' }]);
      return;
    }
    setSaving(true);
    setIssues([]);

    const result = editingId
      ? await updateTransaction(editingId, draft)
      : await createTransaction(draft);
    setSaving(false);

    if (!result.ok) {
      setIssues(result.issues);
      return;
    }

    const savedId = result.value.id;
    if (attachmentIds.length > 0) await linkAttachments(savedId, attachmentIds);
    toast.saved(
      editingId ? 'Transaction updated' : 'Transaction saved',
      editingId ? undefined : { label: 'Undo', run: () => void voidTransaction(savedId) },
    );

    if (addAnother && !editingId) {
      setAmount(null);
      setMerchant('');
      setNotes('');
      setSplits(null);
      setShares(null);
      setAttachmentIds([]);
      setCurrencyOverride(null);
      setIssues([]);
    } else {
      onClose();
    }
  }

  const categories = mode === 'income' ? incomeCategories : expenseCategories;
  const needsCategory = mode === 'expense' || mode === 'income' || mode === 'refund';
  const isMovement = mode === 'transfer' || mode === 'debt';
  const fromAccount = spendable.concat(peopleAccounts).find((a) => a.id === accountId);
  const toAccount = spendable.concat(peopleAccounts).find((a) => a.id === toAccountId);
  const crossCurrency = !!fromAccount && !!toAccount && fromAccount.currency !== toAccount.currency;
  const accountCurrency = fromAccount?.currency ?? settings.baseCurrency;
  const txnCurrency = currencyOverride ?? accountCurrency;
  const needsRate =
    txnCurrency !== settings.baseCurrency && !settings.fxRates[txnCurrency];

  return (
    <div className="space-y-4 pb-2">
      {!editingId && (
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
          {MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => {
                setMode(m.value);
                setIssues([]);
                setSplits(null);
                setShares(null);
              }}
              className={cn(
                'flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[0.8125rem] font-medium transition-all',
                mode === m.value
                  ? 'border-accent bg-accent-soft text-accent'
                  : 'border-line text-ink-3 hover:border-line-strong hover:text-ink',
              )}
            >
              {m.icon}
              {m.label}
            </button>
          ))}
        </div>
      )}

      {/* Amount comes first: it is what the user came here to type. */}
      <div>
        <div className="mb-1.5 flex items-baseline justify-between gap-2">
          <label htmlFor="quickadd-amount" className="text-[0.8125rem] font-medium text-ink-2">
            Amount
          </label>
          <CurrencyChip
            value={txnCurrency}
            accountCurrency={accountCurrency}
            baseCurrency={settings.baseCurrency}
            rates={settings.fxRates}
            onChange={(c) => setCurrencyOverride(c === accountCurrency ? null : c)}
          />
        </div>
        <AmountInput
          id="quickadd-amount"
          value={amount}
          onChange={setAmount}
          currency={txnCurrency}
          size="hero"
          autoFocus
          onEnter={() => void save(false)}
        />
        {needsRate && (
          <Notice tone="warn" className="mt-2.5">
            No exchange rate is set for {txnCurrency}. Add one in Settings before saving, so the
            amount can be reported in {settings.baseCurrency}.
          </Notice>
        )}
      </div>

      {mode === 'refund' && (
        <Field
          label="Refund of"
          hint="Linking the refund keeps the original expense correct instead of creating income."
        >
          <Select value={refundOf ?? ''} onChange={(e) => setRefundOf(e.target.value || null)}>
            <option value="">Choose the original expense</option>
            {refundable.map((t) => (
              <option key={t.id} value={t.id}>
                {formatDate(t.date, 'short')} — {t.merchant ?? 'Expense'}
              </option>
            ))}
          </Select>
        </Field>
      )}

      {needsCategory && !splits && (
        <Field label="Category">
          <CategoryPicker
            id="qa-category"
            categories={categories}
            value={categoryId}
            onChange={setCategoryId}
          />
        </Field>
      )}

      {isMovement ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="From" htmlFor="qa-account">
            <Select id="qa-account" value={accountId ?? ''} onChange={(e) => setAccountId(e.target.value || null)}>
              <option value="">Choose an account</option>
              <AccountOptions accounts={spendable} label="Accounts" />
              {mode === 'debt' && <AccountOptions accounts={peopleAccounts} label="People" />}
            </Select>
          </Field>
          <Field label="To">
            <Select value={toAccountId ?? ''} onChange={(e) => setToAccountId(e.target.value || null)}>
              <option value="">Choose an account</option>
              <AccountOptions accounts={spendable} label="Accounts" />
              {mode === 'debt' && <AccountOptions accounts={peopleAccounts} label="People" />}
            </Select>
          </Field>
        </div>
      ) : (
        <Field label={mode === 'income' || mode === 'refund' ? 'Into' : 'Paid from'}>
          <div id="qa-account" tabIndex={-1} className="outline-none">
            <ChipGroup
              value={accountId}
              onChange={setAccountId}
              options={spendable.slice(0, 8).map((a) => ({
                value: a.id,
                label: a.name,
                color: a.color,
              }))}
            />
          </div>
        </Field>
      )}

      {crossCurrency && (
        <Field
          label={`Amount received in ${toAccount!.currency}`}
          hint="Currencies differ, so Pocketa needs the exact amount that arrived rather than guessing a rate."
        >
          <AmountInput value={toAmount} onChange={setToAmount} currency={toAccount!.currency} />
        </Field>
      )}

      {splits && (
        <SplitEditor
          splits={splits}
          setSplits={setSplits}
          categories={categories}
          total={amount ?? 0}
          currency={fromAccount?.currency ?? settings.baseCurrency}
        />
      )}

      {shares && (
        <ShareEditor
          shares={shares}
          setShares={setShares}
          people={peopleAccounts.filter((a) => a.class === 'receivable')}
          total={amount ?? 0}
          currency={fromAccount?.currency ?? settings.baseCurrency}
          onAddPerson={() => toast.show('Add people from the Debts screen')}
        />
      )}

      {mode === 'expense' && (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={splits ? 'quiet' : 'secondary'}
            icon={<Split className="size-3.5" />}
            onClick={() =>
              setSplits(
                splits
                  ? null
                  : categoryId && amount
                    ? [{ categoryId, amount }]
                    : [{ categoryId: categories[0]?.id ?? '', amount: amount ?? 0 }],
              )
            }
          >
            {splits ? 'Remove split' : 'Split across categories'}
          </Button>
          {peopleAccounts.some((p) => p.class === 'receivable') && (
            <Button
              size="sm"
              variant={shares ? 'quiet' : 'secondary'}
              icon={<Users className="size-3.5" />}
              onClick={() => setShares(shares ? null : [])}
            >
              {shares ? 'Remove shares' : 'Share with someone'}
            </Button>
          )}
        </div>
      )}

      <button
        onClick={() => setShowDetails((v) => !v)}
        className="flex w-full items-center justify-between rounded-[10px] px-1 py-2 text-[0.8125rem] font-medium text-ink-2 transition-colors hover:text-ink"
      >
        <span>Date, merchant, notes and tags</span>
        <ChevronDown className={cn('size-4 transition-transform', showDetails && 'rotate-180')} />
      </button>

      {showDetails && (
        <div className="space-y-3.5 rounded-[--radius] border border-line bg-surface-2/50 p-4 fade-in">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Date" htmlFor="qa-date">
              <DateInput id="qa-date" value={date} onChange={setDate} />
            </Field>
            <Field label="Merchant" htmlFor="qa-merchant" optional>
              <TextInput
                id="qa-merchant"
                list="qa-merchants"
                value={merchant}
                onChange={(e) => setMerchant(e.target.value)}
                placeholder="Where was this?"
                autoComplete="off"
              />
              <datalist id="qa-merchants">
                {merchants.slice(0, 40).map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </Field>
          </div>

          <Field label="Tags" optional>
            <TagInput value={tags} onChange={setTags} suggestions={knownTags.slice(0, 10)} />
          </Field>

          <Field label="Notes" optional>
            <Textarea
              value={notes}
              rows={2}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything worth remembering"
            />
          </Field>

          <Field label="Receipt" optional>
            <AttachmentPicker
              attachmentIds={attachmentIds}
              onChange={setAttachmentIds}
              txnId={editingId}
            />
          </Field>
        </div>
      )}

      {issues.length > 0 && (
        <Notice tone="negative" title="This cannot be saved yet">
          <ul className="space-y-1">
            {issues.map((issue, i) => (
              <li key={i}>{issue.message}</li>
            ))}
          </ul>
        </Notice>
      )}

      <div className="sticky bottom-0 -mx-5 flex gap-2.5 border-t border-line bg-surface px-5 py-3 sm:-mx-6 sm:px-6">
        {!editingId && (
          <Button variant="secondary" onClick={() => void save(true)} disabled={saving}>
            Save & add
          </Button>
        )}
        <Button variant="primary" full loading={saving} onClick={() => void save(false)}>
          {editingId ? 'Save changes' : 'Save'}
        </Button>
      </div>

      {splits && amount != null && splitTotal !== amount && (
        <p className="text-xs text-warn">
          Split legs must total the transaction amount before it can be saved.
        </p>
      )}
    </div>
  );
}

function AccountOptions({
  accounts,
  label,
}: {
  accounts: Array<{ id: string; name: string; currency: string }>;
  label: string;
}) {
  if (accounts.length === 0) return null;
  return (
    <optgroup label={label}>
      {accounts.map((a) => (
        <option key={a.id} value={a.id}>
          {a.name}
        </option>
      ))}
    </optgroup>
  );
}

// ---------------------------------------------------------------------------

function CategoryPicker({
  id,
  categories,
  value,
  onChange,
}: {
  id?: string;
  categories: Array<{ id: ID; name: string; path: string; color: string | null; parentId: ID | null }>;
  value: ID | null;
  onChange: (id: ID) => void;
}) {
  const [query, setQuery] = React.useState('');
  const filtered = query.trim()
    ? categories.filter((c) => c.path.toLowerCase().includes(query.trim().toLowerCase()))
    : categories;
  const selected = categories.find((c) => c.id === value);

  return (
    <div className="space-y-2">
      <TextInput
        id={id}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={selected ? selected.path : 'Search categories'}
        aria-label="Search categories"
      />
      <div className="max-h-44 overflow-y-auto rounded-[11px] border border-line">
        {filtered.length === 0 ? (
          <p className="px-3 py-4 text-center text-[0.8125rem] text-ink-4">
            No category matches “{query}”.
          </p>
        ) : (
          <ul>
            {filtered.map((c) => (
              <li key={c.id}>
                <button
                  onClick={() => onChange(c.id)}
                  className={cn(
                    'flex w-full items-center gap-2.5 px-3 py-2 text-left text-[0.8125rem] transition-colors',
                    c.id === value ? 'bg-accent-soft font-medium text-accent' : 'text-ink-2 hover:bg-surface-2',
                  )}
                >
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ background: c.color ?? 'var(--ink-4)' }}
                    aria-hidden="true"
                  />
                  <span className="truncate">{c.path}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function SplitEditor({
  splits,
  setSplits,
  categories,
  total,
  currency,
}: {
  splits: Allocation[];
  setSplits: (s: Allocation[]) => void;
  categories: Array<{ id: ID; path: string; color: string | null }>;
  total: number;
  currency: string;
}) {
  const assigned = sumMinor(splits.map((s) => s.amount));

  return (
    <div className="space-y-2.5 rounded-[--radius] border border-line p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[0.8125rem] font-semibold text-ink">Split across categories</h3>
        <Button
          size="sm"
          variant="quiet"
          onClick={() => setSplits(allocateEvenly(total, splits.length).map((amount, i) => ({ ...splits[i], amount })))}
          disabled={total === 0}
        >
          Split evenly
        </Button>
      </div>

      {splits.map((split, i) => (
        <div key={i} className="flex gap-2">
          <Select
            className="flex-1"
            value={split.categoryId}
            onChange={(e) => {
              const next = splits.slice();
              next[i] = { ...next[i], categoryId: e.target.value };
              setSplits(next);
            }}
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.path}
              </option>
            ))}
          </Select>
          <div className="w-32">
            <AmountInput
              aria-label={`Amount for split ${i + 1}`}
              value={split.amount}
              currency={currency}
              onChange={(v) => {
                const next = splits.slice();
                next[i] = { ...next[i], amount: v ?? 0 };
                setSplits(next);
              }}
            />
          </div>
          <button
            onClick={() => setSplits(splits.filter((_, j) => j !== i))}
            className="shrink-0 rounded-[10px] px-2 text-ink-4 transition-colors hover:text-negative"
            aria-label="Remove split"
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      ))}

      <Button
        size="sm"
        variant="secondary"
        icon={<Plus className="size-3.5" />}
        onClick={() =>
          setSplits([...splits, { categoryId: categories[0]?.id ?? '', amount: Math.max(0, total - assigned) }])
        }
      >
        Add a category
      </Button>

      <ReckoningInline
        currency={currency}
        target={total}
        total={assigned}
        lines={splits.map((s, i) => ({
          key: String(i),
          label: categories.find((c) => c.id === s.categoryId)?.path ?? 'Category',
          amount: s.amount,
        }))}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

function ShareEditor({
  shares,
  setShares,
  people,
  total,
  currency,
  onAddPerson,
}: {
  shares: Share[];
  setShares: (s: Share[]) => void;
  people: Array<{ id: ID; name: string }>;
  total: number;
  currency: string;
  onAddPerson: () => void;
}) {
  const owed = sumMinor(shares.map((s) => s.amount));
  const mine = total - owed;

  return (
    <div className="space-y-2.5 rounded-[--radius] border border-line p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[0.8125rem] font-semibold text-ink">Shared with</h3>
        <Button
          size="sm"
          variant="quiet"
          disabled={people.length === 0 || total === 0}
          onClick={() => {
            const heads = shares.length + 1;
            const parts = allocateEvenly(total, heads);
            setShares(shares.map((s, i) => ({ ...s, amount: parts[i + 1] })));
          }}
        >
          Split evenly
        </Button>
      </div>

      {people.length === 0 ? (
        <p className="text-[0.8125rem] text-ink-3">
          Add someone on the Debts screen first, then you can split a bill with them.
        </p>
      ) : (
        <>
          {shares.map((share, i) => (
            <div key={i} className="flex gap-2">
              <Select
                className="flex-1"
                value={share.personAccountId}
                onChange={(e) => {
                  const next = shares.slice();
                  next[i] = { ...next[i], personAccountId: e.target.value };
                  setShares(next);
                }}
              >
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
              <div className="w-32">
                <AmountInput
                  value={share.amount}
                  currency={currency}
                  onChange={(v) => {
                    const next = shares.slice();
                    next[i] = { ...next[i], amount: v ?? 0 };
                    setShares(next);
                  }}
                />
              </div>
              <button
                onClick={() => setShares(shares.filter((_, j) => j !== i))}
                className="shrink-0 rounded-[10px] px-2 text-ink-4 transition-colors hover:text-negative"
                aria-label="Remove share"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}

          <Button
            size="sm"
            variant="secondary"
            icon={<Plus className="size-3.5" />}
            onClick={() => setShares([...shares, { personAccountId: people[0].id, amount: 0 }])}
          >
            Add a person
          </Button>

          <div className="rounded-[--radius] bg-surface-2 px-3.5 py-3">
            <div className="reckoning">
              <span className="text-[0.8125rem] font-medium text-ink">Your share</span>
              <span className="text-right">
                <Money value={mine} currency={currency} size="sm" weight="medium" symbol={false} />
              </span>
              <span className="text-[0.8125rem] text-ink-2">Owed to you</span>
              <span className="text-right">
                <Money value={owed} currency={currency} size="sm" symbol={false} />
              </span>
            </div>
            <p className="mt-2 text-xs text-ink-4">
              Only your share counts as spending. The rest is recorded as money owed to you.
            </p>
          </div>
        </>
      )}
      <button onClick={onAddPerson} className="text-xs text-accent hover:underline">
        Manage people
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * The currency a transaction is recorded in.
 *
 * Hidden behind a small chip because the overwhelming majority of entries are in
 * the account's own currency, and a full selector beside every amount would be
 * noise. Currencies with a configured rate are offered first, since those are
 * the ones that can actually be reported in the base currency.
 */
function CurrencyChip({
  value,
  accountCurrency,
  baseCurrency,
  rates,
  onChange,
}: {
  value: string;
  accountCurrency: string;
  baseCurrency: string;
  rates: Record<string, number>;
  onChange: (currency: string) => void;
}) {
  const [open, setOpen] = React.useState(false);

  const ready = React.useMemo(() => {
    const set = new Set<string>([accountCurrency, baseCurrency, ...Object.keys(rates)]);
    return [...set].sort();
  }, [accountCurrency, baseCurrency, rates]);

  const rest = React.useMemo(
    () => Object.keys(CURRENCIES).filter((c) => !ready.includes(c)).sort(),
    [ready],
  );

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'rounded-full border px-2 py-0.5 text-[0.6875rem] font-medium transition-colors',
          value === accountCurrency
            ? 'border-line text-ink-3 hover:border-accent hover:text-accent'
            : 'border-accent bg-accent-soft text-accent',
        )}
      >
        {value}
      </button>
    );
  }

  return (
    <select
      autoFocus
      value={value}
      onChange={(e) => {
        onChange(e.target.value);
        setOpen(false);
      }}
      onBlur={() => setOpen(false)}
      aria-label="Transaction currency"
      className="rounded-[8px] border border-accent bg-surface px-1.5 py-0.5 text-[0.6875rem] font-medium text-ink focus:outline-none"
    >
      <optgroup label="Ready to use">
        {ready.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </optgroup>
      <optgroup label="Needs a rate first">
        {rest.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </optgroup>
    </select>
  );
}
