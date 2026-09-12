/**
 * Where the account lives.
 *
 * It used to live only in Settings, three screens deep, under Import and
 * Export. Which meant a person could install the app, use it for a month, and
 * never learn that an account existed or that their ledger was on one device
 * and nowhere else. "No account required" is a promise about not being blocked;
 * it was never meant to be a promise about hiding that accounts exist.
 *
 * So the state is always on screen, and always says which of the two situations
 * you are in. Being signed out is not a warning — it is a legitimate way to use
 * the app, and it is described rather than nagged about.
 */

import * as React from 'react';
import { Check, CloudOff, LogIn, RefreshCw, TriangleAlert, User } from 'lucide-react';
import { Sheet } from '../ui/Sheet';
import { Button, Notice } from '../ui/primitives';
import { cn } from '../ui/cn';
import { navigate } from './router';
import { describeSync, type SyncState } from './useSync';

export function AccountBadge({ sync }: { sync: SyncState & { syncNow: () => void } }) {
  const [open, setOpen] = React.useState(false);

  // A build with no Supabase is local by construction; there is no account to
  // show and pretending otherwise would be a lie.
  if (sync.phase === 'unavailable') return null;

  const signedIn = sync.email != null;
  const trouble = sync.phase === 'failed';

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label={signedIn ? `Account: ${sync.email}` : 'Not signed in — your data is on this device only'}
        title={describeSync(sync)}
        className={cn(
          'flex size-9 items-center justify-center rounded-full border transition-colors',
          signedIn
            ? 'border-line bg-surface-2 hover:border-line-strong'
            : 'border-accent bg-accent-soft hover:bg-accent-soft/70',
        )}
      >
        {signedIn ? (
          <span
            className={cn(
              'flex size-6 items-center justify-center rounded-full text-[0.6875rem] font-semibold uppercase',
              trouble ? 'bg-warn-soft text-warn' : 'bg-accent-fill text-[--accent-ink]',
            )}
          >
            {sync.email!.slice(0, 1)}
          </span>
        ) : (
          <LogIn className="size-4 text-accent" />
        )}
      </button>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={signedIn ? 'Your account' : 'This device only'}
        description={describeSync(sync)}
      >
        <div className="space-y-4 px-5 pb-5">
          {signedIn ? (
            <SignedIn sync={sync} />
          ) : (
            <SignedOut
              onGo={() => {
                setOpen(false);
                navigate('/settings/account');
              }}
            />
          )}
        </div>
      </Sheet>
    </>
  );
}



function SignedIn({ sync }: { sync: SyncState & { syncNow: () => void } }) {
  const Icon = sync.phase === 'failed' ? TriangleAlert : !sync.online ? CloudOff : Check;
  const tone =
    sync.phase === 'failed' ? 'text-warn' : !sync.online ? 'text-ink-3' : 'text-positive';

  return (
    <>
      <div className="flex items-center gap-3 rounded-[--radius] border border-line bg-surface-2 px-3.5 py-3">
        <Icon className={cn('size-5 shrink-0', tone)} />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-ink">{sync.email}</p>
          <p className="text-xs text-ink-3">{describeSync(sync)}</p>
        </div>
      </div>

      {sync.adopted > 0 && (
        <Notice tone="positive" title="Your ledger came with you">
          {sync.adopted} record{sync.adopted === 1 ? '' : 's'} from this device are now on your
          account, history included.
        </Notice>
      )}

      {sync.phase === 'failed' && sync.online && (
        <Notice tone="warn" title="Not reaching your account">
          <p>{sync.error}</p>
          <p className="mt-1.5">
            Nothing is lost. Everything is saved here and will go up as soon as it can.
          </p>
        </Notice>
      )}

      <div>
        <h3 className="eyebrow mb-2">How this works</h3>
        <ul className="space-y-1.5 text-[0.8125rem] leading-relaxed text-ink-2">
          <li>• Changes go up on their own — after an edit, on reconnecting, on reopening.</li>
          <li>• Sign in with the same account on another device and this ledger appears there.</li>
          <li>• Everything works offline. What cannot be sent yet waits here until it can.</li>
        </ul>
      </div>

      <Button
        variant="secondary"
        full
        icon={<RefreshCw className={cn('size-4', sync.phase === 'syncing' && 'animate-spin')} />}
        disabled={sync.phase === 'syncing' || !sync.online}
        onClick={sync.syncNow}
      >
        {sync.phase === 'syncing' ? 'Syncing' : 'Sync now'}
      </Button>
      <Button variant="ghost" full onClick={() => navigate('/settings/account')}>
        Account settings
      </Button>
    </>
  );
}

function SignedOut({ onGo }: { onGo: () => void }) {
  return (
    <>
      <div className="flex items-start gap-3 rounded-[--radius] border border-line bg-surface-2 px-3.5 py-3">
        <User className="mt-0.5 size-5 shrink-0 text-ink-3" />
        <div>
          <p className="text-sm font-medium text-ink">Everything is saved on this device</p>
          <p className="mt-0.5 text-xs leading-relaxed text-ink-3">
            Which is a perfectly good way to use Pocketa — it needs no account and works with no
            signal. But it does mean this phone holds the only copy.
          </p>
        </div>
      </div>

      <div>
        <h3 className="eyebrow mb-2">What signing in adds</h3>
        <ul className="space-y-1.5 text-[0.8125rem] leading-relaxed text-ink-2">
          <li>• The same ledger on your phone and your laptop, kept in step on its own.</li>
          <li>• A copy that survives losing the device.</li>
          <li>• Everything you have already entered here comes with you — nothing restarts.</li>
        </ul>
      </div>

      <Button variant="primary" full icon={<LogIn className="size-4" />} onClick={onGo}>
        Sign in
      </Button>
      <p className="text-center text-xs text-ink-4">
        Or carry on without one. You can sign in whenever you like.
      </p>
    </>
  );
}
