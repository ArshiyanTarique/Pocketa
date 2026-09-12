import * as React from 'react';
import { Car, Check, Link2 } from 'lucide-react';
import { Card, CardHeader, Button, EmptyState, Notice } from '../ui/primitives';
import { toast } from '../ui/toast';
import { navigate } from '../app/router';
import { useCarpoolNet } from '../store/useCarpoolNet';
import { parseInviteInput } from '../core/carpoolNetwork';
import { CARPOOL_PRIVACY_NOTES } from '../data/carpoolSchema';

/**
 * Landing on an invite link.
 *
 * Someone has been handed a URL by a friend, quite possibly on a phone, quite
 * possibly without ever having opened Pocketa before. So this says plainly what
 * accepting means before anything happens, and never joins anyone silently just
 * because they followed a link.
 */
export function JoinInvite({ token }: { token: string | null }) {
  const net = useCarpoolNet();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [joined, setJoined] = React.useState(false);

  React.useEffect(() => {
    if (net.status === 'idle') void net.refresh();
  }, [net]);

  const clean = token ? parseInviteInput(token) : null;

  if (!clean) {
    return (
      <Card>
        <EmptyState
          icon={<Link2 className="size-5" />}
          title="That invite link is not valid"
          body="Ask the driver to send it again — links can expire or be cancelled."
          action={<Button variant="secondary" onClick={() => navigate('/carpool')}>Go to carpool</Button>}
        />
      </Card>
    );
  }

  if (joined) {
    return (
      <Card>
        <EmptyState
          icon={<Check className="size-5 text-positive" />}
          title="You are on the carpool"
          body="You can log your own rides now, and everyone on the team will see them."
          action={<Button variant="primary" onClick={() => navigate('/carpool')}>Open the carpool</Button>}
        />
      </Card>
    );
  }

  async function accept() {
    setBusy(true);
    setError(null);
    const result = await net.redeemInvite(clean!);
    setBusy(false);
    if (!result.ok) return setError(result.error ?? 'That link could not be used.');
    setJoined(true);
    toast.saved('You have joined the carpool');
  }

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <Card>
        <CardHeader eyebrow="Carpool invite" title="You have been invited to join a carpool" />
        <div className="space-y-4 px-5 pb-5">
          <div className="flex items-center gap-3 rounded-[--radius] border border-accent bg-accent-soft px-3.5 py-3">
            <Car className="size-5 shrink-0 text-accent" />
            <p className="tnum text-sm font-medium text-accent">{clean}</p>
          </div>

          <div>
            <h3 className="eyebrow mb-2">What joining means</h3>
            <ul className="space-y-1.5">
              {[
                'You can log rides yourself, so the driver is not the only one remembering.',
                'Everyone on the carpool sees the ride log, and what each person owes.',
                'Your phone number becomes visible to this team — and theirs to you.',
                'You can leave at any time, and your number stops being shared.',
              ].map((line) => (
                <li key={line} className="text-[0.8125rem] leading-relaxed text-ink-2">
                  • {line}
                </li>
              ))}
            </ul>
          </div>

          {error && <Notice tone="negative">{error}</Notice>}

          <Button variant="primary" full loading={busy} onClick={() => void accept()}>
            Join this carpool
          </Button>
          <Button variant="ghost" full onClick={() => navigate('/carpool')}>
            Not now
          </Button>
        </div>
      </Card>

      <Card>
        <CardHeader eyebrow="Privacy" title="What is shared" />
        <ul className="space-y-1.5 px-5 pb-5">
          {CARPOOL_PRIVACY_NOTES.map((note) => (
            <li key={note} className="text-xs leading-relaxed text-ink-3">
              • {note}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
