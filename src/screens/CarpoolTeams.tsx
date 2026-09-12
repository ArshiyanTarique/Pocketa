import * as React from 'react';
import {
  Car,
  Check,
  Copy,
  Link2,
  MapPin,
  MessageCircle,
  Plus,
  Search,
  Send,
  Settings2,
  UserPlus,
  X,
} from 'lucide-react';
import { Card, CardHeader, Badge, Button, EmptyState, Notice, Segmented, Dot } from '../ui/primitives';
import { Money } from '../ui/Money';
import { Sheet, Confirm } from '../ui/Sheet';
import { AmountInput, DateInput, Field, Select, TextInput, Textarea, Toggle } from '../ui/fields';
import { PlacePicker, RoutePreview, RouteStops, type SavedPlace } from '../components/PlacePicker';
import { toast } from '../ui/toast';
import { cn } from '../ui/cn';
import { useCarpoolNet } from '../store/useCarpoolNet';
import { useStore } from '../store/useStore';
import { useToday } from '../app/useLedger';
import {
  describeDays,
  describeRoute,
  explainEmptySearch,
  searchRoutes,
  type CarpoolRoute,
  type RideRequest,
  type RouteMatch,
} from '../core/carpoolMatch';
import {
  isValidPhone,
  normalisePhone,
  inviteUrl,
  parseInviteInput,
  whatsappLink,
  type CarpoolTeam,
  type TeamRole,
} from '../core/carpoolNetwork';
import { formatDistance, type Place } from '../core/geo';
import { formatDate } from '../core/dates';
import { newId } from '../core/ids';
import { CARPOOL_PRIVACY_NOTES } from '../data/carpoolSchema';

// ---------------------------------------------------------------------------
// Saved places live on the device: a convenience, not shared data.
// ---------------------------------------------------------------------------

const PLACES_KEY = 'pocketa.savedPlaces';

function useSavedPlaces() {
  const [places, setPlaces] = React.useState<SavedPlace[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(PLACES_KEY) ?? '[]');
    } catch {
      return [];
    }
  });

  const persist = (next: SavedPlace[]) => {
    setPlaces(next);
    try {
      localStorage.setItem(PLACES_KEY, JSON.stringify(next));
    } catch {
      /* private mode; the list simply will not survive a reload */
    }
  };

  return {
    places,
    save: (place: Place) => persist([...places, { ...place, id: newId('per') }]),
    forget: (id: string) => persist(places.filter((p) => p.id !== id)),
  };
}

// ===========================================================================

export function CarpoolTeams() {
  const net = useCarpoolNet();
  const [tab, setTab] = React.useState<'teams' | 'find'>('teams');

  React.useEffect(() => {
    if (net.status === 'idle') void net.refresh();
  }, [net]);

  if (net.status === 'loading' || net.status === 'idle') {
    return <Card className="p-6"><p className="text-sm text-ink-3">Loading your teams…</p></Card>;
  }

  if (!net.world.me) return <ProfileSetup />;

  return (
    <div className="space-y-4">
      <Segmented
        label="Carpool section"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'teams', label: 'My teams' },
          { value: 'find', label: 'Find a ride' },
        ]}
      />
      {tab === 'teams' ? <TeamsPanel /> : <DiscoveryPanel />}
    </div>
  );
}

// ===========================================================================
// Getting set up
// ===========================================================================

function ProfileSetup() {
  const net = useCarpoolNet();
  const [name, setName] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [role, setRole] = React.useState<TeamRole>('driver');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function save() {
    if (!name.trim()) return setError('Your teammates need a name to recognise you by.');
    if (phone.trim() && !isValidPhone(phone)) {
      return setError('That does not look like a phone number. Include the country code, like +92300…');
    }
    setSaving(true);
    setError(null);
    await net.saveProfile({ displayName: name.trim(), defaultRole: role });
    await net.savePhone(phone.trim() ? normalisePhone(phone) : null);
    setSaving(false);
    toast.saved('You are set up');
  }

  return (
    <Card>
      <CardHeader eyebrow="Carpool" title="Set yourself up" />
      <div className="space-y-4 px-5 pb-5">
        <p className="text-[0.8125rem] text-ink-3">Other people will see this. Your money stays private.</p>

        <Field label="Are you driving or riding?">
          <Segmented
            value={role}
            onChange={setRole}
            options={[
              { value: 'driver', label: 'I drive' },
              { value: 'passenger', label: 'I ride' },
            ]}
          />
          <p className="mt-2 text-xs text-ink-4">
            Only a starting point — you can drive one carpool and ride in another.
          </p>
        </Field>

        <Field label="Name" htmlFor="cp-name">
          <TextInput
            id="cp-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="What your carpool calls you"
          />
        </Field>

        <Field
          label="Phone"
          optional
          hint="Shared only with people who are actually on a team with you — never with someone who has merely asked to join, and never in a search result."
        >
          <TextInput
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+92 300 1234567"
            inputMode="tel"
            className="tnum"
          />
        </Field>

        {error && <Notice tone="negative">{error}</Notice>}

        <Button variant="primary" full loading={saving} onClick={() => void save()}>
          Continue
        </Button>

        <PrivacyNote />
      </div>
    </Card>
  );
}

function PrivacyNote() {
  const [open, setOpen] = React.useState(false);
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex min-h-9 items-center text-xs text-accent underline-offset-2 hover:underline"
      >
        {open ? 'Hide' : 'What is shared, exactly?'}
      </button>
      {open && (
        <ul className="mt-2 space-y-1.5 rounded-[--radius] border border-line bg-surface-2 p-3.5">
          {CARPOOL_PRIVACY_NOTES.map((note) => (
            <li key={note} className="text-xs leading-relaxed text-ink-2">
              • {note}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ===========================================================================
// Teams
// ===========================================================================

function TeamsPanel() {
  const net = useCarpoolNet();
  const settings = useStore((s) => s.settings);
  const [creating, setCreating] = React.useState(false);
  const [joining, setJoining] = React.useState(false);

  const driving = net.teamsIDrive();
  const riding = net.teamsIRideIn();

  return (
    <div className="space-y-4">
      {net.kind === 'local' && (
        <Notice tone="neutral" title="This device only">
          Sign in to invite, request, or search routes.
        </Notice>
      )}

      <div className="flex flex-wrap gap-2">
        <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
          Start a carpool
        </Button>
        <Button variant="secondary" icon={<Link2 className="size-4" />} onClick={() => setJoining(true)}>
          I have an invite link
        </Button>
      </div>

      {driving.length === 0 && riding.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Car className="size-5" />}
            title="No carpools yet"
            body="Start one if you drive, or paste an invite link if someone has asked you along."
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {driving.map((team) => (
            <TeamCard key={team.id} team={team} amDriver currency={settings.baseCurrency} />
          ))}
          {riding.map((team) => (
            <TeamCard key={team.id} team={team} amDriver={false} currency={settings.baseCurrency} />
          ))}
        </div>
      )}

      {creating && <CreateTeamSheet onClose={() => setCreating(false)} />}
      {joining && <JoinByLinkSheet onClose={() => setJoining(false)} />}
    </div>
  );
}

function TeamCard({
  team,
  amDriver,
  currency,
}: {
  team: CarpoolTeam;
  amDriver: boolean;
  currency: string;
}) {
  const net = useCarpoolNet();
  const [managing, setManaging] = React.useState(false);
  const [logging, setLogging] = React.useState(false);

  const route = net.routeFor(team.id);
  const members = net.membersOf(team.id);
  const requests = net.requestsFor(team.id);
  const rides = net.ridesFor(team.id);

  return (
    <Card>
      <CardHeader
        eyebrow={amDriver ? 'You drive' : 'You ride'}
        title={team.name}
        action={
          <div className="flex items-center gap-1.5">
            {requests.length > 0 && amDriver && (
              <Badge tone="warn">{requests.length} waiting</Badge>
            )}
            <button
              onClick={() => setManaging(true)}
              aria-label={`Open ${team.name}`}
              className="flex size-9 items-center justify-center rounded-[9px] text-ink-3 hover:bg-surface-2 hover:text-ink"
            >
              <Settings2 className="size-4" />
            </button>
          </div>
        }
      />

      <div className="px-5 pb-5">
        {route ? (
          <div className="mb-3">
            <p className="text-[0.8125rem] font-medium text-ink">{describeRoute(route)}</p>
            <p className="mt-0.5 text-xs text-ink-3">
              {describeDays(route.days)} · leaves {route.departure} ·{' '}
              {net.freeSeats(team.id)} of {route.seatsTotal} seats free
            </p>
          </div>
        ) : (
          amDriver && (
            <Notice tone="neutral" className="mb-3">
              Add your route so passengers can find you.
            </Notice>
          )
        )}

        <div className="flex items-center gap-2 border-t border-line pt-3">
          <div className="flex -space-x-1.5">
            {members.slice(0, 5).map(({ membership, profile }) => (
              <span
                key={membership.id}
                title={profile?.displayName ?? 'Member'}
                className="flex size-7 items-center justify-center rounded-full border-2 border-[--surface] bg-accent-soft text-[0.625rem] font-semibold text-accent"
              >
                {(profile?.displayName ?? '?').slice(0, 1).toUpperCase()}
              </span>
            ))}
          </div>
          <span className="text-xs text-ink-3">
            {members.length} {members.length === 1 ? 'person' : 'people'} ·{' '}
            <Money value={team.ratePerTrip} currency={currency} size="xs" symbol={false} /> a trip
          </span>
          <Button size="sm" variant="secondary" className="ml-auto" onClick={() => setLogging(true)}>
            Log a ride
          </Button>
        </div>

        {rides.length > 0 && (
          <p className="mt-2.5 text-xs text-ink-4">
            Last ride {formatDate(rides[0].date, 'medium')} · {rides.length} logged in total
          </p>
        )}
      </div>

      {managing && <TeamSheet team={team} amDriver={amDriver} onClose={() => setManaging(false)} />}
      {logging && <LogRideSheet team={team} onClose={() => setLogging(false)} />}
    </Card>
  );
}

// ===========================================================================

function CreateTeamSheet({ onClose }: { onClose: () => void }) {
  const net = useCarpoolNet();
  const settings = useStore((s) => s.settings);
  const [name, setName] = React.useState('');
  const [rate, setRate] = React.useState<number | null>(null);
  const [saving, setSaving] = React.useState(false);

  async function create() {
    if (!name.trim() || rate == null) return;
    setSaving(true);
    await net.createTeam({
      name: name.trim(),
      ratePerTrip: rate,
      currency: settings.baseCurrency,
    });
    setSaving(false);
    toast.saved('Carpool started');
    onClose();
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="Start a carpool"
      description="You will be the captain: you set the rate, admit passengers and bill at month end."
      footer={
        <div className="flex gap-2.5">
          <Button variant="secondary" full onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            full
            loading={saving}
            onClick={() => void create()}
            disabled={!name.trim() || rate == null}
          >
            Start it
          </Button>
        </div>
      }
    >
      <div className="space-y-4 pb-2">
        <Field label="Name it" htmlFor="team-name">
          <TextInput
            id="team-name"
            data-autofocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Morning run to uni"
          />
        </Field>
        <Field label="Charge per trip, per person">
          <AmountInput value={rate} onChange={setRate} currency={settings.baseCurrency} size="hero" />
        </Field>
      </div>
    </Sheet>
  );
}

// ===========================================================================

function TeamSheet({
  team,
  amDriver,
  onClose,
}: {
  team: CarpoolTeam;
  amDriver: boolean;
  onClose: () => void;
}) {
  const [tab, setTab] = React.useState<'people' | 'route' | 'rides'>('people');

  return (
    <Sheet open onClose={onClose} title={team.name} size="lg">
      <div className="space-y-4 pb-2">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'people', label: 'People' },
            { value: 'route', label: 'Route' },
            { value: 'rides', label: 'Rides' },
          ]}
        />
        {tab === 'people' && <PeopleTab team={team} amDriver={amDriver} />}
        {tab === 'route' && <RouteTab team={team} amDriver={amDriver} />}
        {tab === 'rides' && <RidesTab team={team} />}
      </div>
    </Sheet>
  );
}

function PeopleTab({ team, amDriver }: { team: CarpoolTeam; amDriver: boolean }) {
  const net = useCarpoolNet();
  const [invite, setInvite] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [confirmLeave, setConfirmLeave] = React.useState(false);

  const members = net.membersOf(team.id);
  const requests = net.requestsFor(team.id);

  async function makeInvite() {
    setBusy(true);
    const token = await net.createInvite(team.id);
    setBusy(false);
    if (token) setInvite(token);
  }

  return (
    <div className="space-y-4">
      {amDriver && requests.length > 0 && (
        <section>
          <h3 className="eyebrow mb-2">Asking to join</h3>
          <ul className="space-y-2">
            {requests.map(({ membership, profile }) => (
              <li key={membership.id} className="rounded-[--radius] border border-warn/30 bg-warn-soft/40 p-3">
                <p className="text-[0.8125rem] font-medium text-ink">
                  {profile?.displayName ?? 'Someone'}
                </p>
                {membership.message && (
                  <p className="mt-1 text-xs leading-relaxed text-ink-2">“{membership.message}”</p>
                )}
                <p className="mt-1.5 text-[0.6875rem] text-ink-4">
                  Their number stays hidden until you add them.
                </p>
                <div className="mt-2.5 flex gap-2">
                  <Button
                    size="sm"
                    variant="primary"
                    icon={<Check className="size-3.5" />}
                    onClick={async () => {
                      await net.decideMembership(membership.id, 'active');
                      toast.saved(`${profile?.displayName ?? 'They'} joined`);
                    }}
                  >
                    Add them
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<X className="size-3.5" />}
                    onClick={() => void net.decideMembership(membership.id, 'declined')}
                  >
                    Decline
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3 className="eyebrow mb-2">On this carpool</h3>
        <ul className="space-y-1.5">
          {members.map(({ membership, profile }) => {
            const phone = net.phoneOf(membership.userId);
            const isMe = membership.userId === net.userId;
            const link = whatsappLink(phone, `Salaam — about the ${team.name} carpool`);

            return (
              <li
                key={membership.id}
                className="flex items-center gap-3 rounded-[11px] border border-line px-3 py-2.5"
              >
                <Dot color={membership.role === 'driver' ? '#145C55' : null}>
                  {(profile?.displayName ?? '?').slice(0, 1).toUpperCase()}
                </Dot>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[0.8125rem] font-medium text-ink">
                    {profile?.displayName ?? 'Member'} {isMe && <span className="text-ink-4">(you)</span>}
                  </p>
                  <p className="tnum text-[0.6875rem] text-ink-3">
                    {membership.role === 'driver' ? 'Captain' : 'Passenger'}
                    {phone ? ` · ${phone}` : ' · number not shared'}
                  </p>
                </div>
                {link && !isMe && (
                  <a
                    href={link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex min-h-9 items-center gap-1.5 rounded-[9px] px-2 text-xs font-medium text-accent hover:bg-accent-soft"
                  >
                    <MessageCircle className="size-3.5" />
                    WhatsApp
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {amDriver && (
        <section>
          <h3 className="eyebrow mb-2">Add someone</h3>
          <Button
            variant="secondary"
            full
            loading={busy}
            icon={<UserPlus className="size-4" />}
            onClick={() => void makeInvite()}
          >
            Create an invite link
          </Button>
          {invite && <InviteLink token={invite} />}
          {net.kind === 'local' && (
            <p className="mt-2 text-xs text-ink-4">
              A link can be made now, but it can only be accepted once you and they are both signed in.
            </p>
          )}
        </section>
      )}

      {!amDriver && (
        <Button variant="secondary" className="text-negative" onClick={() => setConfirmLeave(true)}>
          Leave this carpool
        </Button>
      )}

      <Confirm
        open={confirmLeave}
        onClose={() => setConfirmLeave(false)}
        title={`Leave ${team.name}?`}
        confirmLabel="Leave"
        tone="danger"
        body="You will stop seeing the ride log, and the driver will no longer see your number. Rides already logged are kept."
        onConfirm={async () => {
          await net.leaveTeam(team.id);
          toast.show('You have left the carpool');
        }}
      />
    </div>
  );
}

function InviteLink({ token }: { token: string }) {
  const url = inviteUrl(token, window.location.origin + window.location.pathname);
  const [copied, setCopied] = React.useState(false);

  return (
    <div className="mt-3 rounded-[--radius] border border-accent bg-accent-soft p-3.5">
      <p className="eyebrow mb-1.5">Share this</p>
      <p className="tnum break-all text-xs text-ink">{url}</p>
      <div className="mt-2.5 flex gap-2">
        <Button
          size="sm"
          variant="primary"
          icon={copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(url);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              toast.error('Could not copy', 'Select the link and copy it by hand.');
            }
          }}
        >
          {copied ? 'Copied' : 'Copy link'}
        </Button>
        <a
          href={whatsappLink('+0000000000', `Join my carpool: ${url}`)?.replace('0000000000', '') ?? '#'}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-8 items-center gap-1.5 rounded-[8px] border border-line-strong bg-surface px-3 text-[0.8125rem] font-medium text-ink"
        >
          <Send className="size-3.5" />
          Send on WhatsApp
        </a>
      </div>
      <p className="mt-2 text-[0.6875rem] text-ink-3">
        Anyone with this link can ask to join. You still decide who gets added.
      </p>
    </div>
  );
}

// ===========================================================================

function RouteTab({ team, amDriver }: { team: CarpoolTeam; amDriver: boolean }) {
  const net = useCarpoolNet();
  const { places, save } = useSavedPlaces();
  const existing = net.routeFor(team.id);

  const [path, setPath] = React.useState<Place[]>(existing?.path ?? []);
  const [days, setDays] = React.useState<number[]>(existing?.days ?? [1, 2, 3, 4, 5]);
  const [departure, setDeparture] = React.useState(existing?.departure ?? '07:30');
  const [seats, setSeats] = React.useState(existing?.seatsTotal ?? 3);
  const [radius, setRadius] = React.useState(existing?.pickupRadiusMetres ?? 1500);
  const [discoverable, setDiscoverable] = React.useState(existing?.discoverable ?? false);
  const [saving, setSaving] = React.useState(false);

  if (!amDriver) {
    return existing ? (
      <div className="space-y-3">
        <RoutePreview path={existing.path} />
        <p className="text-[0.8125rem] text-ink-2">
          {describeDays(existing.days)} · leaves {existing.departure}
        </p>
      </div>
    ) : (
      <EmptyState compact title="No route set" body="The driver has not marked their route yet." />
    );
  }

  async function saveRoute() {
    if (path.length < 2) return;
    setSaving(true);
    const route: CarpoolRoute = {
      id: existing?.id ?? newId('acc'),
      teamId: team.id,
      name: `${path[0].name} → ${path[path.length - 1].name}`,
      path,
      days,
      departure,
      pickupRadiusMetres: radius,
      seatsTotal: seats,
      seatsTaken: 0,
      discoverable,
      active: true,
    };
    await net.saveRoute(route);
    if (discoverable !== team.discoverable) {
      await net.updateTeam({ ...team, discoverable });
    }
    setSaving(false);
    toast.saved('Route saved');
  }

  return (
    <div className="space-y-4">
      <RoutePreview path={path} />

      <Field label="Stops, in order">
        <RouteStops path={path} onChange={setPath} saved={places} onSave={save} />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Leaves at">
          <TextInput
            type="time"
            value={departure}
            onChange={(e) => setDeparture(e.target.value)}
            className="tnum"
          />
        </Field>
        <Field label="Seats for passengers">
          <Select value={String(seats)} onChange={(e) => setSeats(Number(e.target.value))}>
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </Select>
        </Field>
      </div>

      <Field label="Days it runs">
        <div className="flex flex-wrap gap-1.5">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((label, i) => (
            <button
              key={label}
              type="button"
              onClick={() => setDays((d) => (d.includes(i) ? d.filter((x) => x !== i) : [...d, i]))}
              className={cn(
                'min-h-9 rounded-[9px] border px-3 text-xs font-medium transition-colors',
                days.includes(i)
                  ? 'border-accent bg-accent-soft text-accent'
                  : 'border-line text-ink-3 hover:text-ink',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </Field>

      <Field
        label="How far you will divert to collect someone"
        hint="Passengers further off your route than this will not be shown your carpool."
      >
        <Select value={String(radius)} onChange={(e) => setRadius(Number(e.target.value))}>
          {[500, 1000, 1500, 2500, 5000].map((m) => (
            <option key={m} value={m}>{formatDistance(m)}</option>
          ))}
        </Select>
      </Field>

      <Toggle
        checked={discoverable}
        onChange={setDiscoverable}
        label="Let people find this route"
        description="Your route, departure time and name become searchable. Your phone number does not — that is shared only with passengers you have accepted."
      />

      <Button variant="primary" full loading={saving} onClick={() => void saveRoute()} disabled={path.length < 2}>
        Save route
      </Button>
    </div>
  );
}

// ===========================================================================

function RidesTab({ team }: { team: CarpoolTeam }) {
  const net = useCarpoolNet();
  const settings = useStore((s) => s.settings);
  const rides = net.ridesFor(team.id);

  if (rides.length === 0) {
    return <EmptyState compact title="No rides logged yet" body="Anyone on the carpool can log one — not just the driver." />;
  }

  return (
    <ul className="space-y-1.5">
      {rides.slice(0, 60).map((ride) => (
        <li key={ride.id} className="rounded-[11px] border border-line px-3 py-2.5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="tnum text-[0.8125rem] font-medium text-ink">
              {formatDate(ride.date, 'medium')}
            </span>
            <Money
              value={ride.rateSnapshot * ride.riderUserIds.length}
              currency={settings.baseCurrency}
              size="sm"
              symbol={false}
            />
          </div>
          <p className="mt-0.5 text-xs text-ink-3">
            {ride.riderUserIds.map((id) => net.nameOf(id)).join(', ') || 'Nobody recorded'}
            {' · logged by '}
            {net.nameOf(ride.loggedBy)}
          </p>
          {ride.note && <p className="mt-1 text-xs text-ink-4">{ride.note}</p>}
        </li>
      ))}
    </ul>
  );
}

// ===========================================================================

function LogRideSheet({ team, onClose }: { team: CarpoolTeam; onClose: () => void }) {
  const net = useCarpoolNet();
  const asOf = useToday();
  const [date, setDate] = React.useState(asOf);
  const [riders, setRiders] = React.useState<string[]>(() => (net.userId ? [net.userId] : []));
  const [note, setNote] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  const members = net.membersOf(team.id).filter((m) => m.membership.role !== 'driver');
  const canLog = net.canLog(team.id);

  async function save() {
    setSaving(true);
    await net.logRide({ teamId: team.id, date, riderUserIds: riders, note: note.trim() || null });
    setSaving(false);
    toast.saved('Ride logged', undefined);
    onClose();
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="Log a ride"
      description="Everyone on the carpool sees this, so nobody has to remember alone."
      footer={
        <div className="flex gap-2.5">
          <Button variant="secondary" full onClick={onClose}>Cancel</Button>
          <Button variant="primary" full loading={saving} onClick={() => void save()} disabled={!canLog || riders.length === 0}>
            Log it
          </Button>
        </div>
      }
    >
      <div className="space-y-4 pb-2">
        <Field label="Date">
          <DateInput value={date} onChange={setDate} max={asOf} />
        </Field>

        <Field label="Who rode?">
          {members.length === 0 ? (
            <p className="text-[0.8125rem] text-ink-3">
              Nobody has joined yet. Add passengers from the People tab first.
            </p>
          ) : (
            <div className="space-y-1.5">
              {members.map(({ membership, profile }) => {
                const on = riders.includes(membership.userId);
                return (
                  <button
                    key={membership.id}
                    type="button"
                    onClick={() =>
                      setRiders((r) =>
                        on ? r.filter((x) => x !== membership.userId) : [...r, membership.userId],
                      )
                    }
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-[11px] border px-3 py-2.5 text-left transition-colors',
                      on ? 'border-accent bg-accent-soft' : 'border-line hover:border-line-strong',
                    )}
                  >
                    <span
                      className={cn(
                        'flex size-5 items-center justify-center rounded-[6px] border',
                        on ? 'border-accent-fill bg-accent-fill text-[--accent-ink]' : 'border-line-strong',
                      )}
                    >
                      {on && <Check className="size-3" strokeWidth={3} />}
                    </span>
                    <span className={cn('text-[0.8125rem]', on ? 'font-medium text-accent' : 'text-ink-2')}>
                      {profile?.displayName ?? 'Passenger'}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </Field>

        <Field label="Note" optional>
          <Textarea value={note} rows={2} onChange={(e) => setNote(e.target.value)} placeholder="Went the long way, traffic on Shahrah-e-Faisal" />
        </Field>

        {!canLog && <Notice tone="warn">Only people on this carpool can log a ride.</Notice>}
      </div>
    </Sheet>
  );
}

// ===========================================================================
// Finding a ride
// ===========================================================================

function DiscoveryPanel() {
  const net = useCarpoolNet();
  const { places, save, forget } = useSavedPlaces();
  const asOf = useToday();

  const [origin, setOrigin] = React.useState<Place | null>(null);
  const [destination, setDestination] = React.useState<Place | null>(null);
  const [time, setTime] = React.useState('07:30');
  const [maxWalk, setMaxWalk] = React.useState(1200);
  const [searched, setSearched] = React.useState(false);
  const [asking, setAsking] = React.useState<RouteMatch | null>(null);

  React.useEffect(() => {
    void net.loadDiscovery();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const result = React.useMemo(() => {
    if (!origin || !destination) return null;
    const request: RideRequest = {
      origin,
      destination,
      time,
      maxWalkMetres: maxWalk,
      day: new Date(`${asOf}T00:00:00`).getDay(),
    };
    return searchRoutes(net.discovered.routes, request);
  }, [origin, destination, time, maxWalk, net.discovered.routes, asOf]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader eyebrow="Find a ride" title="Where are you going?" />
        <div className="space-y-4 px-5 pb-5">
          <PlacePicker
            label="From"
            value={origin}
            onChange={(p) => { setOrigin(p); setSearched(false); }}
            saved={places}
            onSave={save}
            onForget={forget}
            placeholder="Where you set off"
          />
          <PlacePicker
            label="To"
            value={destination}
            onChange={(p) => { setDestination(p); setSearched(false); }}
            saved={places}
            onSave={save}
            onForget={forget}
            placeholder="Where you are heading"
          />

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Around what time">
              <TextInput type="time" value={time} onChange={(e) => setTime(e.target.value)} className="tnum" />
            </Field>
            <Field label="Willing to walk">
              <Select value={String(maxWalk)} onChange={(e) => setMaxWalk(Number(e.target.value))}>
                {[400, 800, 1200, 2000, 3000].map((m) => (
                  <option key={m} value={m}>{formatDistance(m)}</option>
                ))}
              </Select>
            </Field>
          </div>

          <Button
            variant="primary"
            full
            icon={<Search className="size-4" />}
            disabled={!origin || !destination}
            onClick={() => setSearched(true)}
          >
            Find carpools going my way
          </Button>
        </div>
      </Card>

      {searched && result && (
        result.matches.length === 0 ? (
          <Card>
            <EmptyState
              icon={<MapPin className="size-5" />}
              title="Nothing on your route yet"
              body={explainEmptySearch(result)}
            />
          </Card>
        ) : (
          <div className="space-y-3">
            {result.matches.map((match) => (
              <MatchCard key={match.route.id} match={match} onAsk={() => setAsking(match)} />
            ))}
          </div>
        )
      )}

      {net.kind === 'local' && searched && (
        <Notice tone="neutral" title="Searching needs an account">
          Route search finds carpools run by other people, so it only returns results once you are
          signed in and others have published routes.
        </Notice>
      )}

      {asking && <RequestJoinSheet match={asking} onClose={() => setAsking(null)} />}
    </div>
  );
}

function MatchCard({ match, onAsk }: { match: RouteMatch; onAsk: () => void }) {
  const net = useCarpoolNet();
  const settings = useStore((s) => s.settings);
  const team = net.discovered.teams.find((t) => t.id === match.route.teamId);
  const driver = net.discovered.drivers.find((d) => d.userId === team?.driverUserId);
  const status = net.world.memberships.find(
    (m) => m.teamId === match.route.teamId && m.userId === net.userId,
  )?.status;

  return (
    <Card>
      <CardHeader
        eyebrow={describeDays(match.route.days)}
        title={describeRoute(match.route)}
        action={<Badge tone={match.seatsFree > 0 ? 'positive' : 'neutral'}>{match.seatsFree} seats</Badge>}
      />
      <div className="px-5 pb-5">
        <RoutePreview
          path={match.route.path}
          height={120}
          highlight={[
            { point: match.pickup.place, label: 'Pickup', tone: 'pickup' },
            { point: match.dropoff.place, label: 'Drop-off', tone: 'dropoff' },
          ]}
        />

        <dl className="mt-3 space-y-1.5 text-[0.8125rem]">
          <div className="flex justify-between gap-3">
            <dt className="text-ink-3">Walk to pickup</dt>
            <dd className="text-ink">
              {formatDistance(match.pickup.walkMetres)} · about {match.pickup.walkMinutes} min
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-ink-3">Walk from drop-off</dt>
            <dd className="text-ink">{formatDistance(match.dropoff.walkMetres)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-ink-3">Leaves</dt>
            <dd className="tnum text-ink">{match.route.departure}</dd>
          </div>
          {team && (
            <div className="flex justify-between gap-3">
              <dt className="text-ink-3">Per trip</dt>
              <dd className="text-ink">
                <Money value={team.ratePerTrip} currency={settings.baseCurrency} size="sm" symbol={false} />
              </dd>
            </div>
          )}
          <div className="flex justify-between gap-3">
            <dt className="text-ink-3">Driver</dt>
            <dd className="text-ink">{driver?.displayName ?? 'A driver'}</dd>
          </div>
        </dl>

        {status === 'requested' ? (
          <Notice tone="neutral" className="mt-3">You have asked to join. The driver decides next.</Notice>
        ) : status === 'active' ? (
          <Notice tone="positive" className="mt-3">You are already on this carpool.</Notice>
        ) : (
          <Button variant="primary" full className="mt-3" icon={<UserPlus className="size-4" />} onClick={onAsk}>
            Ask to join
          </Button>
        )}

        <p className="mt-2 text-[0.6875rem] text-ink-4">
          Contact details are exchanged only if the driver adds you.
        </p>
      </div>
    </Card>
  );
}

function RequestJoinSheet({ match, onClose }: { match: RouteMatch; onClose: () => void }) {
  const net = useCarpoolNet();
  const [message, setMessage] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function send() {
    setSaving(true);
    const result = await net.requestJoin(match.route.teamId, message.trim() || null);
    setSaving(false);
    if (!result.ok) return setError(result.error ?? 'That could not be sent.');
    toast.saved('Request sent');
    onClose();
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="Ask to join"
      description={describeRoute(match.route)}
      footer={
        <div className="flex gap-2.5">
          <Button variant="secondary" full onClick={onClose}>Cancel</Button>
          <Button variant="primary" full loading={saving} onClick={() => void send()}>Send request</Button>
        </div>
      }
    >
      <div className="space-y-4 pb-2">
        <Field
          label="Say something"
          optional
          hint="A word about where you live and which days you need helps the driver decide."
        >
          <Textarea
            data-autofocus
            rows={3}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Salaam — I live near Nazimabad and need a ride weekday mornings."
          />
        </Field>

        <Notice tone="neutral" title="What the driver sees">
          Your name and this message. Your phone number stays hidden unless they add you to the
          carpool.
        </Notice>

        {error && <Notice tone="negative">{error}</Notice>}
      </div>
    </Sheet>
  );
}

// ===========================================================================

function JoinByLinkSheet({ onClose }: { onClose: () => void }) {
  const net = useCarpoolNet();
  const [input, setInput] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function join() {
    const token = parseInviteInput(input);
    if (!token) return setError('That does not look like an invite link or code.');

    setSaving(true);
    const result = await net.redeemInvite(token);
    setSaving(false);
    if (!result.ok) return setError(result.error ?? 'That link could not be used.');
    toast.saved('You have joined');
    onClose();
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="Join with an invite"
      description="Paste the link a driver sent you, or type the code."
      footer={
        <div className="flex gap-2.5">
          <Button variant="secondary" full onClick={onClose}>Cancel</Button>
          <Button variant="primary" full loading={saving} onClick={() => void join()} disabled={!input.trim()}>
            Join
          </Button>
        </div>
      }
    >
      <div className="space-y-4 pb-2">
        <Field label="Invite link or code">
          <TextInput
            data-autofocus
            value={input}
            onChange={(e) => { setInput(e.target.value); setError(null); }}
            placeholder="ABCDEFGH…"
            className="tnum"
          />
        </Field>
        {error && <Notice tone="negative">{error}</Notice>}
      </div>
    </Sheet>
  );
}
