// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import * as React from 'react';
import { ErrorBoundary } from './ErrorBoundary';

afterEach(cleanup);

function Boom({ throws }: { throws: boolean }): React.ReactElement {
  if (throws) throw new Error('ledger exploded');
  return <p>All fine</p>;
}

describe('the crash barrier', () => {
  it('renders children when nothing is wrong', () => {
    render(
      <ErrorBoundary>
        <Boom throws={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByText('All fine')).toBeTruthy();
  });

  it('catches a thrown render and reassures the user their data is intact', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Boom throws />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Something broke on this screen')).toBeTruthy();
    // The single most important thing to say when a finance app white-screens.
    expect(screen.getByText(/Your data is safe/)).toBeTruthy();
    // And the actual fault, so it is reportable rather than mysterious.
    expect(screen.getByText(/ledger exploded/)).toBeTruthy();
    spy.mockRestore();
  });

  it('offers recovery that destroys nothing', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Boom throws />
      </ErrorBoundary>,
    );

    const labels = screen.getAllByRole('button').map((b) => b.textContent);
    expect(labels).toContain('Try this screen again');
    expect(labels).toContain('Reload Pocketa');
    expect(labels).toContain('Copy error details');
    // Nothing here may wipe data; that lives behind a typed confirmation in Settings.
    expect(labels.join(' ')).not.toMatch(/erase|delete|reset/i);
    spy.mockRestore();
  });

  it('recovers when the fault has passed', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // A fault that is fixed between attempts — a stale record, say, that the
    // user corrected on another screen.
    let broken = true;
    function Flaky() {
      if (broken) throw new Error('transient');
      return <p>Recovered</p>;
    }

    render(
      <ErrorBoundary>
        <Flaky />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Something broke on this screen')).toBeTruthy();

    broken = false;
    fireEvent.click(screen.getByText('Try this screen again'));

    expect(screen.getByText('Recovered')).toBeTruthy();
    spy.mockRestore();
  });

  it('logs the fault for anyone with dev tools open', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Boom throws />
      </ErrorBoundary>,
    );
    expect(spy.mock.calls.some((c) => String(c[0]).includes('Pocketa crashed'))).toBe(true);
    spy.mockRestore();
  });
});
