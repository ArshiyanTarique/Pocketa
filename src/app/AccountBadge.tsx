import * as React from 'react';
import { Check, CloudOff, LogIn, RefreshCw, TriangleAlert, User, Camera } from 'lucide-react';
import { Sheet } from '../ui/Sheet';
import { Button, Notice } from '../ui/primitives';
import { cn } from '../ui/cn';
import { navigate } from './router';
import { describeSync, type SyncState } from './useSync';
import { useStore } from '../store/useStore';

// ---------------------------------------------------------------------------
// Avatar — Google photo › custom upload › letter initial
// ---------------------------------------------------------------------------

export function Avatar({
  sync,
  size = 'sm',
  customUrl,
}: {
  sync: SyncState;
  size?: 'sm' | 'md' | 'lg';
  customUrl?: string | null;
}) {
  const [imgError, setImgError] = React.useState(false);
  const src = customUrl ?? sync.avatarUrl;
  const dim = size === 'lg' ? 'size-16' : size === 'md' ? 'size-11' : 'size-7';
  const text = size === 'lg' ? 'text-xl' : size === 'md' ? 'text-base' : 'text-[0.6875rem]';

  if (src && !imgError) {
    return (
      <img
        src={src}
        alt={sync.displayName ?? sync.email ?? 'Profile'}
        onError={() => setImgError(true)}
        className={cn('rounded-full object-cover', dim)}
      />
    );
  }

  // Letter fallback
  const letter = (sync.displayName ?? sync.email ?? '?').slice(0, 1).toUpperCase();
  return (
    <span
      className={cn(
        'flex items-center justify-center rounded-full bg-accent-fill font-semibold text-[--accent-ink]',
        dim, text,
      )}
    >
      {letter}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Badge in the top bar
// ---------------------------------------------------------------------------

export function AccountBadge({ sync }: { sync: SyncState & { syncNow: () => void } }) {
  const [open, setOpen] = React.useState(false);
  const settings = useStore((s) => s.settings);

  if (sync.phase === 'unavailable') return null;

  const signedIn = sync.email != null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label={signedIn ? `Account: ${sync.email}` : 'Not signed in'}
        title={describeSync(sync)}
        className={cn(
          'flex items-center justify-center rounded-full border transition-colors overflow-hidden',
          'size-9',
          signedIn
            ? 'border-line hover:border-line-strong'
            : 'border-accent bg-accent-soft hover:bg-accent-soft/70',
        )}
      >
        {signedIn ? (
          <Avatar sync={sync} size="sm" customUrl={settings.avatarUrl} />
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
            <SignedOut onGo={() => { setOpen(false); navigate('/settings/account'); }} />
          )}
        </div>
      </Sheet>
    </>
  );
}

// ---------------------------------------------------------------------------
// Signed-in panel
// ---------------------------------------------------------------------------

function SignedIn({ sync }: { sync: SyncState & { syncNow: () => void } }) {
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = React.useState(false);

  const Icon = sync.phase === 'failed' ? TriangleAlert : !sync.online ? CloudOff : Check;
  const tone = sync.phase === 'failed' ? 'text-warn' : !sync.online ? 'text-ink-3' : 'text-positive';

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const reader = new FileReader();
    reader.onload = () => {
      void updateSettings({ avatarUrl: reader.result as string });
      setUploading(false);
    };
    reader.readAsDataURL(file);
  }

  return (
    <>
      {/* Avatar + name */}
      <div className="flex flex-col items-center gap-3 pt-1">
        <div className="relative">
          <Avatar sync={sync} size="lg" customUrl={settings.avatarUrl} />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="absolute -bottom-1 -right-1 flex size-7 items-center justify-center rounded-full border-2 border-surface bg-surface-2 text-ink-3 transition-colors hover:bg-accent-soft hover:text-accent"
            aria-label="Change profile picture"
          >
            <Camera className="size-3.5" />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={handleFile}
          />
        </div>
        {sync.displayName && (
          <p className="text-[0.9375rem] font-semibold text-ink">{sync.displayName}</p>
        )}
        <p className="text-xs text-ink-3">{sync.email}</p>
        {settings.avatarUrl && (
          <button
            type="button"
            onClick={() => void updateSettings({ avatarUrl: null })}
            className="text-xs text-ink-4 hover:text-negative"
          >
            Remove custom photo
          </button>
        )}
      </div>

      <div className="flex items-center gap-3 rounded-[--radius] border border-line bg-surface-2 px-3.5 py-3">
        <Icon className={cn('size-5 shrink-0', tone)} />
        <p className="text-xs text-ink-3">{describeSync(sync)}</p>
      </div>

      {sync.adopted > 0 && (
        <Notice tone="positive" title="Your ledger came with you">
          {sync.adopted} record{sync.adopted === 1 ? '' : 's'} from this device are now on your account.
        </Notice>
      )}

      {sync.phase === 'failed' && sync.online && (
        <Notice tone="warn" title="Not reaching your account">
          <p>{sync.error}</p>
        </Notice>
      )}

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

// ---------------------------------------------------------------------------
// Signed-out panel
// ---------------------------------------------------------------------------

function SignedOut({ onGo }: { onGo: () => void }) {
  return (
    <>
      <div className="flex items-start gap-3 rounded-[--radius] border border-line bg-surface-2 px-3.5 py-3">
        <User className="mt-0.5 size-5 shrink-0 text-ink-3" />
        <div>
          <p className="text-sm font-medium text-ink">Everything is saved on this device</p>
          <p className="mt-0.5 text-xs leading-relaxed text-ink-3">
            Sign in to back up your data and access it on other devices.
          </p>
        </div>
      </div>
      <Button variant="primary" full icon={<LogIn className="size-4" />} onClick={onGo}>
        Sign in
      </Button>
    </>
  );
}
