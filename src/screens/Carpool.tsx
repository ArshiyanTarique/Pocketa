import * as React from 'react';
import {
  CarFront,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Plus,
  Receipt,
  Settings2,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';
import { Card, CardHeader, Badge, Button, EmptyState, Notice, Dot, IconButton, SectionLabel } from '../ui/primitives';
import { Money, Num } from '../ui/Money';
import { Reckoning } from '../ui/Reckoning';
import { Sheet, Confirm } from '../ui/Sheet';
import { AmountInput, DateInput, Field, Select, TextInput, Textarea, Toggle } from '../ui/fields';
import { toast } from '../ui/toast';
import { cn } from '../ui/cn';
import { navigate } from '../app/router';
import { useFlatCategories, useToday } from '../app/useLedger';
import { useStore } from '../store/useStore';
import {
  findLoggingGaps,
  lastRiders,
  lifetimeValue,
  rateForRider,
  rateOnTrip,
  settlementLines,
  summarisePeriod,
  tripsInRange,
  type RiderTally,
} from '../core/carpool';
import { addMonths, formatDate, formatRelativeDay, monthRange, nowIso } from '../core/dates';
import { newId } from '../core/ids';
import { CarpoolTeams } from './CarpoolTeams';
import type { Carpool as CarpoolType, CarpoolRider, CarpoolTrip, ID, Person } from '../core/types';

/**
 * One carpool, one screen.
 *
 * It used to be two tabs — "My tally" and "Team & routes" — which was the
 * data model showing through: a local count and a shared network are two
 * things to the code and one thing to the driver. Now the board is the screen,
 * and the team (route, invite link, requests) is a section of it that opens
 * when you need it.
 */
export function Carpool() {
  const carpools = useStore((s) => s.carpools);
  const carpool = carpools.find((c) => !c.archived) ?? null;
  const [teamOpen, setTeamOpen] = React.useState(false);

  if (!carpool) return <CarpoolSetup />;

  return (
    <div className="space-y-6">
      <CarpoolBoard carpool={carpool} />

      <section>
        <SectionLabel onClick={() => setTeamOpen((v) => !v)} count={teamOpen ? 'Hide' : 'Route, invites, riders'}>
          Team
        </SectionLabel>
        <div className="disclose" data-open={teamOpen || undefined}>
          <div>
            <div className="pt-2">
              <CarpoolTeams />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

// ===========================================================================
// First run
// ===========================================================================

function CarpoolSetup() {
  const saveCarpool = useStore((s) => s.saveCarpool);
  const settings = useStore((s) => s.settings);
  const categories = useFlatCategories('expense_category');
  const [name, setName] = React.useState('University run');
  const [rate, setRate] = React.useState<number | null>(null);
  const [categoryId, setCategoryId] = React.useState<ID>('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!categoryId && categories.length) {
      const fuel = categories.find((c) => /fuel|transport|petrol/i.test(c.path));
      setCategoryId(fuel?.id ?? categories[0].id);
    }
  }, [categories, categoryId]);

  async function create() {
    if (!name.trim()) return setError('Give the carpool a name.');
    if (rate == null || rate <= 0) return setError('Set what each person pays per trip.');
    setBusy(true);
    await saveCarpool(
      {
        id: newId('acc'),
        name: name.trim(),
        ratePerTrip: rate,
        currency: settings.baseCurrency,
        settleAs: 'recovery',
        settleCategoryId: categoryId || null,
        notes: null,
        archived: false,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      },
      true,
    );
    setBusy(false);
    toast.saved('Carpool set up', { label: 'Add riders', run: () => undefined });
  }

  return (
    <div className="mx-auto max-w-xl py-4">
      <div className="mb-6 text-center">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-[16px] bg-accent-soft text-accent">
          <CarFront className="size-5" />
        </div>
        <h1 className="text-2xl font-semibold tracking-[-0.03em] text-ink">Stop counting from memory</h1>
        <p className="mx-auto mt-2 max-w-[46ch] text-sm leading-relaxed text-ink-3">
          Log who rode with you as it happens. At the end of the month Pocketa totals each person
          up, and only then does anyone owe you anything.
        </p>
      </div>

      <Card className="p-5">
        <div className="space-y-4">
          <Field label="What is this run called?" htmlFor="cp-name">
            <TextInput id="cp-name" data-autofocus value={name} onChange={(e) => setName(e.target.value)} />
          </Field>

          <Field label="Rate per person, per trip" hint="You can give an individual rider a different rate later.">
            <AmountInput value={rate} onChange={setRate} currency={settings.baseCurrency} size="hero" />
          </Field>

          <Field
            label="Money collected goes against"
            hint="Reimbursement reduces this category, so your real transport cost is what you see."
          >
            <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value as ID)}>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.path}</option>
              ))}
            </Select>
          </Field>

          {error && <Notice tone="negative">{error}</Notice>}

          <Button variant="primary" full loading={busy} onClick={() => void create()}>
            Set up the carpool
          </Button>
        </div>
      </Card>
    </div>
  );
}

// ===========================================================================
// The board
// ===========================================================================

function CarpoolBoard({ carpool }: { carpool: CarpoolType }) {
  // Select the whole array and narrow in a memo. A selector that calls .filter()
  // returns a fresh array every read, which zustand sees as a changed snapshot
  // and re-renders forever.
  const allRiders = useStore((s) => s.carpoolRiders);
  const allTrips = useStore((s) => s.carpoolTrips);
  const riders = React.useMemo(
    () => allRiders.filter((r) => r.carpoolId === carpool.id),
    [allRiders, carpool.id],
  );
  const trips = React.useMemo(
    () => allTrips.filter((t) => t.carpoolId === carpool.id),
    [allTrips, carpool.id],
  );
  const people = useStore((s) => s.people);
  const settings = useStore((s) => s.settings);
  const asOf = useToday();
  const hidden = settings.hideAmounts;

  const [offset, setOffset] = React.useState(0);
  const [logging, setLogging] = React.useState<{ date: string; trip?: CarpoolTrip } | null>(null);
  const [editingRider, setEditingRider] = React.useState<CarpoolRider | 'new' | null>(null);
  const [settling, setSettling] = React.useState(false);
  const [configuring, setConfiguring] = React.useState(false);

  // Memoised because three downstream memos depend on it by identity.
  const range = React.useMemo(() => monthRange(addMonths(asOf, -offset)), [asOf, offset]);
  const summary = React.useMemo(
    () => summarisePeriod({ carpool, riders, trips, people, range }),
    [carpool, riders, trips, people, range],
  );
  const gaps = React.useMemo(() => findLoggingGaps(trips, asOf), [trips, asOf]);
  const monthTrips = React.useMemo(() => tripsInRange(trips, range), [trips, range]);
  const lifetime = React.useMemo(() => lifetimeValue(trips, riders, carpool), [trips, riders, carpool]);

  const activeRiders = riders.filter((r) => r.active);
  const canSettle = summary.outstanding > 0;

  return (
    <div className="space-y-4">
      {/* --- the nudge, because forgetting is the actual problem ---------- */}
      {(gaps.missingToday || gaps.unloggedWeekdays.length > 0) && activeRiders.length > 0 && (
        <Notice
          tone="info"
          icon={<CarFront className="size-4" />}
          title={gaps.missingToday ? 'No trip logged today' : 'Some days are still unlogged'}
          action={
            <div className="flex flex-wrap gap-2">
              {gaps.missingToday && (
                <Button size="sm" variant="primary" onClick={() => setLogging({ date: asOf })}>
                  Log today
                </Button>
              )}
              {gaps.unloggedWeekdays.slice(0, 3).map((day) => (
                <Button key={day} size="sm" variant="secondary" onClick={() => setLogging({ date: day })}>
                  {formatRelativeDay(day, asOf)}
                </Button>
              ))}
            </div>
          }
        >
          {gaps.unloggedWeekdays.length > 0 &&
            `${gaps.unloggedWeekdays.length} weekday${gaps.unloggedWeekdays.length === 1 ? '' : 's'} with nothing recorded`}
        </Notice>
      )}

      {/* --- log today, in one tap ---------------------------------------- */}
      {activeRiders.length > 0 && offset === 0 && (
        <QuickLog
          carpool={carpool}
          riders={activeRiders}
          people={people}
          trips={trips}
          asOf={asOf}
          onMore={() => setLogging({ date: asOf })}
        />
      )}

      {/* --- header ------------------------------------------------------- */}
      <section>
        <div className="flex items-center justify-between gap-3">
          <p className="label">Owed · {formatDate(range.from, 'month')}</p>
          <div className="flex items-center">
            <IconButton label="Previous month" onClick={() => setOffset((o) => o + 1)}>
              <ChevronLeft className="size-4" />
            </IconButton>
            <IconButton label="Next month" onClick={() => setOffset((o) => Math.max(0, o - 1))} disabled={offset === 0}>
              <ChevronRight className="size-4" />
            </IconButton>
            <IconButton label="Carpool settings" onClick={() => setConfiguring(true)}>
              <Settings2 className="size-4" />
            </IconButton>
          </div>
        </div>

        <div className="count-in mt-1 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <Money
            value={summary.outstanding}
            currency={settings.baseCurrency}
            hidden={hidden}
            size="display"
            weight="semibold"
          />
          <div className="flex gap-5 pb-1.5">
            <span className="flex flex-col">
              <span className="label">Trips</span>
              <Num size="sm" className="font-semibold">{summary.tripCount}</Num>
            </span>
            <span className="flex flex-col">
              <span className="label">Riders</span>
              <Num size="sm" className="font-semibold">{activeRiders.length}</Num>
            </span>
            <span className="flex flex-col">
              <span className="label">Each</span>
              <Money value={carpool.ratePerTrip} currency={carpool.currency} hidden={hidden} size="sm" weight="semibold" symbol={false} />
            </span>
          </div>
        </div>
        <div className="reckoning-rule reckoning-rule--total mt-4" aria-hidden="true" />

        {summary.billed > 0 && (
          <p className="mt-2 text-xs text-ink-3">
            <Money value={summary.billed} currency={settings.baseCurrency} hidden={hidden} size="xs" /> already billed → Debts
          </p>
        )}

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Button
            variant="primary"
            icon={<Plus className="size-4" />}
            onClick={() => setLogging({ date: asOf })}
            disabled={activeRiders.length === 0}
          >
            Log a trip
          </Button>
          <Button
            variant="secondary"
            icon={<Receipt className="size-4" />}
            onClick={() => setSettling(true)}
            disabled={!canSettle}
          >
            Bill everyone
          </Button>
          <Button
            variant="secondary"
            icon={<UserPlus className="size-4" />}
            onClick={() => setEditingRider('new')}
            className="col-span-2 sm:col-span-1"
          >
            Add a rider
          </Button>
        </div>
      </section>

      {/* --- riders ------------------------------------------------------- */}
      <Card>
        <CardHeader
          title="Who owes what"
          eyebrow={formatDate(range.from, 'month')}
          action={
            canSettle ? (
              <Button size="sm" variant="quiet" onClick={() => setSettling(true)}>
                Bill
              </Button>
            ) : undefined
          }
        />

        {activeRiders.length === 0 ? (
          <EmptyState
            compact
            icon={<Users className="size-5" />}
            title="No riders yet"
            body="Add the people who ride with you and their trips will start counting."
            action={
              <Button size="sm" variant="primary" icon={<UserPlus className="size-4" />} onClick={() => setEditingRider('new')}>
                Add a rider
              </Button>
            }
          />
        ) : summary.riders.length === 0 ? (
          <EmptyState compact title="No trips this month" body="Log a trip and the totals appear here." />
        ) : (
          <ul className="pb-2">
            {summary.riders.map((tally) => (
              <RiderRow
                key={tally.rider.id}
                tally={tally}
                hidden={hidden}
                currency={settings.baseCurrency}
                onEdit={() => setEditingRider(tally.rider)}
              />
            ))}
          </ul>
        )}
      </Card>

      {/* --- trip log ----------------------------------------------------- */}
      <Card>
        <CardHeader
          title="Trip log"
          eyebrow={`${monthTrips.length} logged`}
          action={
            <span className="text-xs text-ink-4">
              lifetime <Money value={lifetime} currency={settings.baseCurrency} hidden={hidden} size="xs" tone="muted" />
            </span>
          }
        />
        {monthTrips.length === 0 ? (
          <EmptyState compact title="Nothing logged this month" />
        ) : (
          <ul className="pb-2">
            {monthTrips.map((trip) => (
              <TripRow
                key={trip.id}
                trip={trip}
                riders={riders}
                people={people}
                carpool={carpool}
                asOf={asOf}
                hidden={hidden}
                onEdit={() => setLogging({ date: trip.date, trip })}
              />
            ))}
          </ul>
        )}
      </Card>

      {logging && (
        <LogTripSheet
          carpool={carpool}
          riders={activeRiders}
          people={people}
          trips={trips}
          date={logging.date}
          existing={logging.trip}
          onClose={() => setLogging(null)}
        />
      )}
      {editingRider && (
        <RiderSheet
          carpool={carpool}
          rider={editingRider === 'new' ? null : editingRider}
          onClose={() => setEditingRider(null)}
        />
      )}
      {settling && (
        <SettleSheet carpool={carpool} summary={summary} range={range} onClose={() => setSettling(false)} />
      )}
      {configuring && <CarpoolSettingsSheet carpool={carpool} onClose={() => setConfiguring(false)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------

function RiderRow({
  tally,
  hidden,
  currency,
  onEdit,
}: {
  tally: RiderTally;
  hidden: boolean;
  currency: string;
  onEdit: () => void;
}) {
  return (
    <li>
      <button
        onClick={onEdit}
        className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-surface-2"
      >
        <Dot color={tally.person?.color ?? '#4C9AFF'}>{tally.name.slice(0, 1).toUpperCase()}</Dot>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-ink">{tally.name}</span>
            {!tally.rider.active && <Badge tone="neutral">Left</Badge>}
            {tally.rider.ratePerTrip != null && (
              <Badge tone="info" title="This rider has their own rate">
                <Money value={tally.rate} currency={currency} hidden={hidden} size="xs" symbol={false} className="text-info" />
              </Badge>
            )}
          </div>
          <p className="mt-0.5 text-xs text-ink-3">
            <Num size="xs">{tally.unbilledTrips}</Num> unbilled trip{tally.unbilledTrips === 1 ? '' : 's'}
            {tally.billedAmount > 0 && (
              <> · <Num size="xs">{tally.trips - tally.unbilledTrips}</Num> already billed</>
            )}
            {tally.lastRode && <> · last {formatRelativeDay(tally.lastRode)}</>}
          </p>
        </div>

        <Money
          value={tally.amount}
          currency={currency}
          hidden={hidden}
          size="base"
          weight="medium"
          tone={tally.amount > 0 ? 'default' : 'muted'}
        />
      </button>
    </li>
  );
}

function TripRow({
  trip,
  riders,
  people,
  carpool,
  asOf,
  hidden,
  onEdit,
}: {
  trip: CarpoolTrip;
  riders: CarpoolRider[];
  people: Person[];
  carpool: CarpoolType;
  asOf: string;
  hidden: boolean;
  onEdit: () => void;
}) {
  const names = trip.riderIds
    .map((id) => {
      const rider = riders.find((r) => r.id === id);
      return people.find((p) => p.id === rider?.personId)?.name;
    })
    .filter(Boolean) as string[];

  const value = trip.riderIds.reduce((sum, id) => {
    const rider = riders.find((r) => r.id === id);
    return sum + rateOnTrip(trip, id, rider ? rateForRider(rider, carpool) : carpool.ratePerTrip);
  }, 0);

  return (
    <li>
      <button
        onClick={onEdit}
        disabled={trip.settlementId != null}
        className={cn(
          'flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors',
          trip.settlementId ? 'cursor-default opacity-70' : 'hover:bg-surface-2',
        )}
      >
        <div className="flex size-9 shrink-0 flex-col items-center justify-center rounded-[11px] bg-surface-2 text-ink-2">
          <span className="tnum text-[0.6875rem] font-semibold leading-none">{trip.date.slice(8, 10)}</span>
          <span className="text-[0.5625rem] uppercase leading-none opacity-70">
            {formatDate(trip.date, 'short').split(' ')[1]}
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm text-ink">
              {names.length > 0 ? names.join(', ') : <span className="text-ink-4">Nobody rode</span>}
            </span>
            {trip.settlementId && <Badge tone="positive">Billed</Badge>}
          </div>
          <p className="mt-0.5 text-xs text-ink-3">{formatRelativeDay(trip.date, asOf)}</p>
        </div>

        <Money value={value} currency={carpool.currency} hidden={hidden} size="sm" symbol={false} tone="muted" />
      </button>
    </li>
  );
}

// ===========================================================================
// Today, in one tap
//
// The problem the whole feature exists to solve is forgetting. So the top of
// the board is the log for today: the riders as a row of faces, pre-selected
// to whoever rode last time, and one button. No sheet, no date field, no
// note — those are a tap away for the unusual trip.
// ===========================================================================

function QuickLog({
  carpool,
  riders,
  people,
  trips,
  asOf,
  onMore,
}: {
  carpool: CarpoolType;
  riders: CarpoolRider[];
  people: Person[];
  trips: CarpoolTrip[];
  asOf: string;
  onMore: () => void;
}) {
  const logTrip = useStore((s) => s.logTrip);
  const today = trips.find((t) => t.date === asOf);
  const [selected, setSelected] = React.useState<ID[]>(() =>
    lastRiders(trips).filter((id) => riders.some((r) => r.id === id)),
  );
  const [busy, setBusy] = React.useState(false);
  const [justLogged, setJustLogged] = React.useState(false);

  const value = selected.reduce((sum, id) => {
    const rider = riders.find((r) => r.id === id);
    return sum + (rider ? rateForRider(rider, carpool) : carpool.ratePerTrip);
  }, 0);

  async function log() {
    if (selected.length === 0) return;
    setBusy(true);
    await logTrip(
      {
        id: newId('txn'),
        carpoolId: carpool.id,
        date: asOf,
        riderIds: selected,
        rates: Object.fromEntries(
          selected.map((id) => {
            const rider = riders.find((r) => r.id === id);
            return [id, rider ? rateForRider(rider, carpool) : carpool.ratePerTrip];
          }),
        ),
        note: null,
        settlementId: null,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      },
      true,
    );
    setBusy(false);
    setJustLogged(true);
    toast.saved(`Logged ${selected.length} rider${selected.length === 1 ? '' : 's'} for today`);
  }

  if (today) {
    const names = today.riderIds
      .map((id) => people.find((p) => p.id === riders.find((r) => r.id === id)?.personId)?.name)
      .filter(Boolean) as string[];
    return (
      <section className={cn('flex items-center gap-3 rounded-[--radius] border border-line bg-surface px-4 py-3', justLogged && 'fade-in')}>
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-positive-soft text-positive">
          <svg viewBox="0 0 24 24" className="size-4" fill="none" aria-hidden="true">
            <path d="m5 13 4 4L19 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span className="min-w-0 flex-1">
          <span className="label">Today</span>
          <span className="block truncate text-sm font-semibold text-ink">{names.length ? names.join(', ') : 'Nobody rode'}</span>
        </span>
        <Button size="sm" variant="ghost" onClick={onMore}>
          Change
        </Button>
      </section>
    );
  }

  return (
    <section className="rounded-[--radius] border border-line bg-surface px-4 py-3">
      <div className="flex items-center justify-between">
        <span className="label">Today · who is in the car?</span>
        <button onClick={onMore} className="text-xs font-semibold text-ink-3 hover:text-ink">
          Another day
        </button>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {riders.map((rider) => {
          const person = people.find((p) => p.id === rider.personId);
          const on = selected.includes(rider.id);
          const name = person?.name ?? 'Rider';
          return (
            <button
              key={rider.id}
              type="button"
              aria-pressed={on}
              onClick={() => setSelected((s) => (on ? s.filter((x) => x !== rider.id) : [...s, rider.id]))}
              className={cn(
                'flex h-10 items-center gap-2 rounded-full border ps-1 pe-3 text-sm font-semibold transition-all duration-150',
                on ? 'border-ink bg-ink text-paper' : 'border-line bg-surface text-ink-2 hover:border-line-strong',
              )}
            >
              <span
                className={cn(
                  'flex size-8 items-center justify-center rounded-full text-[0.8125rem] font-semibold',
                  on ? 'bg-paper/15 text-paper' : 'bg-surface-2 text-ink-2',
                )}
                style={!on && person?.color ? { background: `color-mix(in srgb, ${person.color} 20%, transparent)` } : undefined}
              >
                {name.slice(0, 1).toUpperCase()}
              </span>
              {name.split(' ')[0]}
            </button>
          );
        })}
        <div className="ms-auto flex items-center gap-3">
          <Money value={value} currency={carpool.currency} size="sm" weight="semibold" symbol={false} tone={selected.length ? 'default' : 'muted'} />
          <Button variant="primary" size="sm" loading={busy} disabled={selected.length === 0} onClick={() => void log()}>
            Log
          </Button>
        </div>
      </div>
    </section>
  );
}

// ===========================================================================
// Logging a trip — the fast path
// ===========================================================================

function LogTripSheet({
  carpool,
  riders,
  people,
  trips,
  date,
  existing,
  onClose,
}: {
  carpool: CarpoolType;
  riders: CarpoolRider[];
  people: Person[];
  trips: CarpoolTrip[];
  date: string;
  existing?: CarpoolTrip;
  onClose: () => void;
}) {
  const logTrip = useStore((s) => s.logTrip);
  const deleteTrip = useStore((s) => s.deleteTrip);
  const asOf = useToday();

  // Default to whoever was on the last trip — the usual case is "the same people".
  const [selected, setSelected] = React.useState<ID[]>(
    () => existing?.riderIds ?? lastRiders(trips).filter((id) => riders.some((r) => r.id === id)),
  );
  const [tripDate, setTripDate] = React.useState(date);
  const [note, setNote] = React.useState(existing?.note ?? '');
  const [busy, setBusy] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  const value = selected.reduce((sum, id) => {
    const rider = riders.find((r) => r.id === id);
    return sum + (rider ? rateForRider(rider, carpool) : carpool.ratePerTrip);
  }, 0);

  function toggle(id: ID) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function save() {
    setBusy(true);
    await logTrip(
      {
        id: existing?.id ?? newId('txn'),
        carpoolId: carpool.id,
        date: tripDate,
        riderIds: selected,
        // Freeze the rate now, so raising it later never re-prices this trip.
        rates: Object.fromEntries(
          selected.map((id) => {
            const rider = riders.find((r) => r.id === id);
            return [id, rider ? rateForRider(rider, carpool) : carpool.ratePerTrip];
          }),
        ),
        note: note.trim() || null,
        settlementId: existing?.settlementId ?? null,
        createdAt: existing?.createdAt ?? nowIso(),
        updatedAt: nowIso(),
      },
      !existing,
    );
    setBusy(false);
    toast.saved(existing ? 'Trip updated' : `Trip logged for ${formatRelativeDay(tripDate, asOf)}`);
    onClose();
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={existing ? 'Edit trip' : 'Log a trip'}
      description={formatDate(tripDate, 'long')}
      footer={
        <div className="flex gap-2.5">
          {existing && (
            <Button variant="secondary" icon={<Trash2 className="size-4" />} onClick={() => setConfirmDelete(true)}>
              Delete
            </Button>
          )}
          <Button variant="primary" full loading={busy} onClick={() => void save()} disabled={selected.length === 0}>
            {existing ? 'Save trip' : `Log ${selected.length} rider${selected.length === 1 ? '' : 's'}`}
          </Button>
        </div>
      }
    >
      <div className="space-y-4 pb-2">
        <Field label="Who was in the car?" hint="Tap to toggle. Starts with whoever rode last time.">
          <div className="space-y-1.5">
            {riders.map((rider) => {
              const person = people.find((p) => p.id === rider.personId);
              const active = selected.includes(rider.id);
              return (
                <button
                  key={rider.id}
                  type="button"
                  onClick={() => toggle(rider.id)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-[12px] border px-3 py-2.5 text-left transition-all',
                    active
                      ? 'border-accent bg-accent-soft'
                      : 'border-line bg-surface hover:border-line-strong',
                  )}
                >
                  <span
                    className={cn(
                      'flex size-5 shrink-0 items-center justify-center rounded-[7px] border',
                      active ? 'border-accent-fill bg-accent-fill text-[--accent-ink]' : 'border-line-strong',
                    )}
                    aria-hidden="true"
                  >
                    {active && (
                      <svg viewBox="0 0 24 24" className="size-3.5" fill="none">
                        <path d="m5 13 4 4L19 7" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </span>
                  <span className={cn('flex-1 truncate text-sm', active ? 'font-medium text-accent' : 'text-ink-2')}>
                    {person?.name ?? 'Rider'}
                  </span>
                  <Money
                    value={rateForRider(rider, carpool)}
                    currency={carpool.currency}
                    size="sm"
                    symbol={false}
                    tone={active ? 'default' : 'muted'}
                  />
                </button>
              );
            })}
          </div>
        </Field>

        <div className="rounded-[--radius] border border-line bg-surface-2/50 px-4 py-3">
          <div className="reckoning">
            <span className="text-[0.8125rem] text-ink-2">
              {selected.length} rider{selected.length === 1 ? '' : 's'} on this trip
            </span>
            <span className="text-right">
              <Money value={value} currency={carpool.currency} size="sm" weight="medium" symbol={false} />
            </span>
          </div>
          <p className="mt-2 text-xs text-ink-4">
            Nothing is charged yet. This is added to their running total until you bill the month.
          </p>
        </div>

        <Field label="Date">
          <DateInput value={tripDate} onChange={setTripDate} max={asOf} />
        </Field>

        <Field label="Note" optional>
          <Textarea value={note} rows={2} onChange={(e) => setNote(e.target.value)} placeholder="Detour, one way only, anything worth remembering" />
        </Field>
      </div>

      <Confirm
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this trip?"
        tone="danger"
        confirmLabel="Delete"
        body="It will no longer count towards anyone's total."
        onConfirm={async () => {
          await deleteTrip(existing!.id);
          toast.saved('Trip deleted');
          onClose();
        }}
      />
    </Sheet>
  );
}

// ===========================================================================
// Riders
// ===========================================================================

function RiderSheet({
  carpool,
  rider,
  onClose,
}: {
  carpool: CarpoolType;
  rider: CarpoolRider | null;
  onClose: () => void;
}) {
  const people = useStore((s) => s.people);
  const allRiders = useStore((s) => s.carpoolRiders);
  const existingRiders = React.useMemo(
    () => allRiders.filter((r) => r.carpoolId === carpool.id),
    [allRiders, carpool.id],
  );
  const savePerson = useStore((s) => s.savePerson);
  const saveCarpoolRider = useStore((s) => s.saveCarpoolRider);

  const isNew = !rider;
  const [mode, setMode] = React.useState<'existing' | 'new'>(
    people.some((p) => !existingRiders.some((r) => r.personId === p.id)) ? 'existing' : 'new',
  );
  const [personId, setPersonId] = React.useState<ID>(rider?.personId ?? '');
  const [newName, setNewName] = React.useState('');
  const [customRate, setCustomRate] = React.useState<number | null>(rider?.ratePerTrip ?? null);
  const [useCustom, setUseCustom] = React.useState(rider?.ratePerTrip != null);
  const [active, setActive] = React.useState(rider?.active ?? true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const available = people.filter(
    (p) => !p.archived && (p.id === rider?.personId || !existingRiders.some((r) => r.personId === p.id)),
  );

  React.useEffect(() => {
    if (!personId && available.length && mode === 'existing') setPersonId(available[0].id);
  }, [available, personId, mode]);

  async function save() {
    setBusy(true);
    setError(null);
    let targetPerson = personId;

    if (isNew && mode === 'new') {
      if (!newName.trim()) {
        setBusy(false);
        return setError('Enter a name.');
      }
      const person: Person = {
        id: newId('per'),
        name: newName.trim(),
        contact: null,
        notes: null,
        color: null,
        archived: false,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      await savePerson(person, true);
      targetPerson = person.id;
    }

    if (!targetPerson) {
      setBusy(false);
      return setError('Choose who is riding.');
    }

    await saveCarpoolRider(
      {
        id: rider?.id ?? newId('per'),
        carpoolId: carpool.id,
        personId: targetPerson,
        ratePerTrip: useCustom ? customRate : null,
        active,
        createdAt: rider?.createdAt ?? nowIso(),
        updatedAt: nowIso(),
      },
      isNew,
    );

    setBusy(false);
    toast.saved(isNew ? 'Rider added' : 'Rider updated');
    onClose();
  }

  const name = people.find((p) => p.id === rider?.personId)?.name;

  return (
    <Sheet
      open
      onClose={onClose}
      title={isNew ? 'Add a rider' : `Edit ${name ?? 'rider'}`}
      footer={
        <div className="flex gap-2.5">
          <Button variant="secondary" full onClick={onClose}>Cancel</Button>
          <Button variant="primary" full loading={busy} onClick={() => void save()}>
            {isNew ? 'Add rider' : 'Save changes'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4 pb-2">
        {isNew && available.length > 0 && (
          <div className="flex gap-1.5">
            <button
              onClick={() => setMode('existing')}
              className={cn(
                'flex-1 rounded-[10px] border px-3 py-2 text-[0.8125rem] font-medium transition-all',
                mode === 'existing' ? 'border-accent bg-accent-soft text-accent' : 'border-line text-ink-3',
              )}
            >
              Someone I know
            </button>
            <button
              onClick={() => setMode('new')}
              className={cn(
                'flex-1 rounded-[10px] border px-3 py-2 text-[0.8125rem] font-medium transition-all',
                mode === 'new' ? 'border-accent bg-accent-soft text-accent' : 'border-line text-ink-3',
              )}
            >
              New person
            </button>
          </div>
        )}

        {isNew && mode === 'new' ? (
          <Field label="Name" htmlFor="rd-name">
            <TextInput id="rd-name" data-autofocus value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Sara" />
          </Field>
        ) : isNew ? (
          <Field label="Who is riding?">
            <Select value={personId} onChange={(e) => setPersonId(e.target.value as ID)}>
              {available.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
          </Field>
        ) : null}

        <Toggle
          checked={useCustom}
          onChange={setUseCustom}
          label="Charge this rider a different rate"
          description={`Everyone else pays ${carpool.ratePerTrip / 100} per trip.`}
        />

        {useCustom && (
          <Field label="Their rate per trip">
            <AmountInput value={customRate} onChange={setCustomRate} currency={carpool.currency} />
          </Field>
        )}

        {!isNew && (
          <Toggle
            checked={active}
            onChange={setActive}
            label="Still riding"
            description="Turn this off when someone stops carpooling. Their past trips stay counted."
          />
        )}

        {error && <Notice tone="negative">{error}</Notice>}
      </div>
    </Sheet>
  );
}

// ===========================================================================
// Billing
// ===========================================================================

function SettleSheet({
  carpool,
  summary,
  range,
  onClose,
}: {
  carpool: CarpoolType;
  summary: ReturnType<typeof summarisePeriod>;
  range: { from: string; to: string };
  onClose: () => void;
}) {
  const settleCarpool = useStore((s) => s.settleCarpool);
  const accounts = useStore((s) => s.accounts);
  const settings = useStore((s) => s.settings);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // Captured at settle time: once the store updates, the lines are empty by
  // definition, so reading them afterwards would report nothing was billed.
  const [done, setDone] = React.useState<{ riders: number; total: number } | null>(null);

  const lines = React.useMemo(() => settlementLines(summary.riders), [summary.riders]);
  const category = accounts.find((a) => a.id === carpool.settleCategoryId);

  async function bill() {
    setBusy(true);
    setError(null);
    const result = await settleCarpool(carpool.id, range, lines);
    setBusy(false);
    if (!result.ok) return setError(result.error ?? 'Nothing could be billed.');
    setDone({ riders: lines.length, total: result.settlement?.total ?? 0 });
    toast.saved(`Billed ${lines.length} rider${lines.length === 1 ? '' : 's'}`, {
      label: 'See debts',
      run: () => navigate('/debts'),
    });
  }

  if (done != null) {
    return (
      <Sheet open onClose={onClose} title="Billed" footer={<Button variant="primary" full onClick={onClose}>Done</Button>}>
        <div className="py-2">
          <EmptyState
            icon={<Check className="size-5 text-positive" />}
            title={`${done.riders} rider${done.riders === 1 ? '' : 's'} billed`}
            body="Each person now owes you this amount. Record their payment on the Debts screen when it arrives."
            action={
              <Button variant="secondary" onClick={() => { onClose(); navigate('/debts'); }}>
                Open Debts
              </Button>
            }
          />
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={`Bill ${formatDate(range.from, 'month')}`}
      description="Check the totals before anyone is charged. Nothing is recorded until you confirm."
      footer={
        <div className="flex gap-2.5">
          <Button variant="secondary" full onClick={onClose}>Cancel</Button>
          <Button variant="primary" full loading={busy} onClick={() => void bill()} disabled={lines.length === 0}>
            Bill <Money value={summary.outstanding} currency={settings.baseCurrency} size="sm" symbol={false} className="text-[--accent-ink]" />
          </Button>
        </div>
      }
    >
      <div className="space-y-4 pb-2">
        {lines.length === 0 ? (
          <Notice tone="neutral" icon={<CircleAlert className="size-4" />}>
            Every trip this month has already been billed.
          </Notice>
        ) : (
          <>
            <Reckoning
              currency={settings.baseCurrency}
              showSigns={false}
              lines={lines.map((l) => ({
                key: l.riderId,
                label: l.personName,
                detail: `${l.trips} trip${l.trips === 1 ? '' : 's'}`,
                amount: l.amount,
              }))}
              total={{ label: 'Total to collect', amount: summary.outstanding }}
            />

            <Notice tone="neutral">
              Each person's total becomes money they owe you, tracked under Debts. The collected
              money is recorded against{' '}
              <span className="font-medium text-ink">{category?.name ?? 'your chosen category'}</span>
              {carpool.settleAs === 'recovery'
                ? ', reducing what that category has really cost you.'
                : ' as income.'}
            </Notice>

            <p className="text-xs leading-relaxed text-ink-4">
              {summary.unbilledTripCount === 1
                ? 'The trip covered here is marked as billed, so it can never be charged a second time.'
                : `The ${summary.unbilledTripCount} trips covered here are marked as billed, so they can never be charged a second time.`}
            </p>
          </>
        )}

        {error && <Notice tone="negative">{error}</Notice>}
      </div>
    </Sheet>
  );
}

// ===========================================================================
// Settings
// ===========================================================================

function CarpoolSettingsSheet({ carpool, onClose }: { carpool: CarpoolType; onClose: () => void }) {
  const saveCarpool = useStore((s) => s.saveCarpool);
  const expenseCategories = useFlatCategories('expense_category');
  const incomeCategories = useFlatCategories('income_category');

  const [name, setName] = React.useState(carpool.name);
  const [rate, setRate] = React.useState<number | null>(carpool.ratePerTrip);
  const [settleAs, setSettleAs] = React.useState(carpool.settleAs);
  const [categoryId, setCategoryId] = React.useState<ID>(carpool.settleCategoryId ?? '');
  const [notes, setNotes] = React.useState(carpool.notes ?? '');
  const [error, setError] = React.useState<string | null>(null);

  const categories = settleAs === 'income' ? incomeCategories : expenseCategories;

  React.useEffect(() => {
    if (!categories.some((c) => c.id === categoryId)) setCategoryId(categories[0]?.id ?? '');
  }, [settleAs, categories, categoryId]);

  async function save() {
    if (!name.trim()) return setError('Give the carpool a name.');
    if (rate == null || rate <= 0) return setError('Set a rate greater than zero.');
    await saveCarpool({
      ...carpool,
      name: name.trim(),
      ratePerTrip: rate,
      settleAs,
      settleCategoryId: categoryId || null,
      notes: notes.trim() || null,
      updatedAt: nowIso(),
    });
    toast.saved('Carpool updated');
    onClose();
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="Carpool settings"
      footer={
        <div className="flex gap-2.5">
          <Button variant="secondary" full onClick={onClose}>Cancel</Button>
          <Button variant="primary" full onClick={() => void save()}>Save changes</Button>
        </div>
      }
    >
      <div className="space-y-4 pb-2">
        <Field label="Name" htmlFor="cps-name">
          <TextInput id="cps-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>

        <Field
          label="Rate per person, per trip"
          hint="Changing this affects future trips only. Trips already logged keep the rate they were logged at."
        >
          <AmountInput value={rate} onChange={setRate} currency={carpool.currency} />
        </Field>

        <Field label="Money collected counts as">
          <div className="flex gap-1.5">
            <button
              onClick={() => setSettleAs('recovery')}
              className={cn(
                'flex-1 rounded-[10px] border px-3 py-2.5 text-left text-[0.8125rem] transition-all',
                settleAs === 'recovery' ? 'border-accent bg-accent-soft text-accent' : 'border-line text-ink-3',
              )}
            >
              <span className="block font-medium">Getting fuel money back</span>
              <span className="mt-0.5 block text-xs opacity-80">Reduces a spending category</span>
            </button>
            <button
              onClick={() => setSettleAs('income')}
              className={cn(
                'flex-1 rounded-[10px] border px-3 py-2.5 text-left text-[0.8125rem] transition-all',
                settleAs === 'income' ? 'border-accent bg-accent-soft text-accent' : 'border-line text-ink-3',
              )}
            >
              <span className="block font-medium">Income</span>
              <span className="mt-0.5 block text-xs opacity-80">Counts as money earned</span>
            </button>
          </div>
        </Field>

        <Field label={settleAs === 'income' ? 'Income category' : 'Spending category to offset'}>
          <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value as ID)}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.path}</option>
            ))}
          </Select>
        </Field>

        <Field label="Notes" optional>
          <Textarea value={notes} rows={2} onChange={(e) => setNotes(e.target.value)} />
        </Field>

        {error && <Notice tone="negative">{error}</Notice>}
      </div>
    </Sheet>
  );
}
