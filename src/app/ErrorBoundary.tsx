import * as React from 'react';

/**
 * The crash barrier.
 *
 * Without this, one thrown render turns the whole app into a white screen with
 * the user's data apparently gone. It is not gone — it is in IndexedDB — so the
 * job here is to say so, offer a way out that does not destroy anything, and
 * make the fault reportable.
 *
 * Recovery is deliberately ordered from least to most drastic, and the only
 * destructive option is a link to Settings rather than a button that wipes.
 */

interface Props {
  children: React.ReactNode;
  /** Shown in the report so a user can say which screen broke. */
  where?: string;
}

interface State {
  error: Error | null;
  info: React.ErrorInfo | null;
  /** Bumped to force a remount of the subtree on retry. */
  attempt: number;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, info: null, attempt: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    this.setState({ info });
    // Keep the detail in the console for anyone who opens dev tools; there is
    // no telemetry, and nothing about a crash leaves the device.
    console.error('Pocketa crashed:', error, info.componentStack);
  }

  private retry = () => {
    this.setState((s) => ({ error: null, info: null, attempt: s.attempt + 1 }));
  };

  private reload = () => {
    window.location.reload();
  };

  private copyReport = async () => {
    const { error, info } = this.state;
    const report = [
      `Pocketa error report`,
      `When: ${new Date().toISOString()}`,
      `Where: ${this.props.where ?? (window.location.hash || '/')}`,
      `Browser: ${navigator.userAgent}`,
      ``,
      `${error?.name}: ${error?.message}`,
      error?.stack ?? '',
      ``,
      info?.componentStack ?? '',
    ].join('\n');

    try {
      await navigator.clipboard.writeText(report);
    } catch {
      // Clipboard can be blocked; fall back to a selectable window.
      window.prompt('Copy this report:', report.slice(0, 2000));
    }
  };

  render() {
    const { error } = this.state;
    if (!error) {
      return <React.Fragment key={this.state.attempt}>{this.props.children}</React.Fragment>;
    }

    return (
      <div className="flex min-h-dvh items-center justify-center bg-paper p-6">
        <div className="w-full max-w-md rounded-[--radius-lg] border border-line bg-surface p-6 shadow-[var(--shadow-md)]">
          <div className="mb-4 flex size-11 items-center justify-center rounded-[14px] bg-negative-soft text-negative">
            <svg viewBox="0 0 24 24" className="size-5" fill="none" aria-hidden="true">
              <path
                d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>

          <h1 className="text-lg font-semibold tracking-[-0.02em] text-ink">
            Something broke on this screen
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-ink-2">
            Your data is safe — it is stored on this device and nothing was lost. Only the screen
            failed to draw.
          </p>

          <div className="mt-4 rounded-[--radius] border border-line bg-surface-2 px-3.5 py-3">
            <p className="tnum text-xs leading-relaxed text-ink-3 break-words">
              {error.name}: {error.message}
            </p>
          </div>

          <div className="mt-5 space-y-2">
            <button
              onClick={this.retry}
              className="w-full rounded-[11px] bg-accent-fill px-4 py-2.5 text-sm font-semibold text-[--accent-ink] transition-colors hover:bg-accent-hover"
            >
              Try this screen again
            </button>
            <button
              onClick={this.reload}
              className="w-full rounded-[11px] border border-line-strong bg-surface px-4 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-surface-2"
            >
              Reload Pocketa
            </button>
            <button
              onClick={this.copyReport}
              className="w-full rounded-[11px] px-4 py-2.5 text-sm font-medium text-ink-3 transition-colors hover:text-ink"
            >
              Copy error details
            </button>
          </div>

          <p className="mt-4 text-xs leading-relaxed text-ink-4">
            If it keeps happening, open Settings and save a backup before doing anything else.
          </p>
        </div>
      </div>
    );
  }
}
