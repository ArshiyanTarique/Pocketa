import * as React from 'react';

/**
 * Render a long list a window at a time.
 *
 * A ledger kept for a few years holds tens of thousands of rows, and putting
 * them all in the DOM at once locks the tab — measured at 20,000 transactions,
 * the transactions screen produced ~760,000 characters of markup and stopped
 * responding.
 *
 * This grows the window as the user scrolls, via an IntersectionObserver on a
 * sentinel below the list. It is deliberately not virtualisation: rows stay in
 * the DOM once shown, so find-in-page, text selection and screen-reader
 * navigation keep working, which matters more here than constant memory.
 *
 * A button sits alongside the sentinel too, so the list stays fully reachable
 * if the observer never fires — an unusual scroll container, a browser without
 * IntersectionObserver, or a user who would rather click than scroll.
 */
export interface Incremental {
  /** How many items to render right now. */
  count: number;
  /**
   * Attach to the element that marks the end of the list.
   *
   * A callback ref rather than an object ref: the observer must attach whenever
   * that node appears, not only if it happened to be mounted on the render that
   * set up the effect.
   */
  sentinelRef: (node: HTMLElement | null) => void;
  /** True while more remain. */
  hasMore: boolean;
  /** Reveal the next window immediately. */
  showMore: () => void;
  /** Reveal everything, for print or export views. */
  showAll: () => void;
  remaining: number;
}

export function useIncremental(total: number, step = 60): Incremental {
  const [count, setCount] = React.useState(() => Math.min(step, total));
  const [sentinel, setSentinel] = React.useState<HTMLElement | null>(null);

  // A changed filter or a different account is a different list; start over
  // rather than leaving the window where the last one happened to end.
  React.useEffect(() => {
    setCount(Math.min(step, total));
  }, [total, step]);

  const hasMore = count < total;

  const showMore = React.useCallback(() => {
    setCount((c) => Math.min(total, c + step));
  }, [total, step]);

  const showAll = React.useCallback(() => setCount(total), [total]);

  React.useEffect(() => {
    if (!hasMore || !sentinel) return;
    if (typeof IntersectionObserver !== 'function') return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) showMore();
      },
      // Load the next window before the user reaches the bottom, so scrolling
      // stays continuous rather than stuttering at each boundary.
      { rootMargin: '600px 0px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, showMore, sentinel, count]);

  return {
    count,
    sentinelRef: setSentinel,
    hasMore,
    showMore,
    showAll,
    remaining: Math.max(0, total - count),
  };
}
