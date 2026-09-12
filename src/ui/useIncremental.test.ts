// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useIncremental } from './useIncremental';

/**
 * jsdom has no IntersectionObserver, and the embedded browser used for manual
 * checks would not scroll — so the auto-loading behaviour is proven here, by
 * driving a stub observer directly.
 */
let observers: Array<{
  callback: IntersectionObserverCallback;
  observed: Element[];
  disconnected: boolean;
}> = [];

class StubObserver {
  observed: Element[] = [];
  disconnected = false;
  callback: IntersectionObserverCallback;
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    observers.push(this as unknown as (typeof observers)[number]);
  }
  observe(el: Element) {
    this.observed.push(el);
  }
  disconnect() {
    this.disconnected = true;
  }
  unobserve() {}
  takeRecords() {
    return [];
  }
}

function trigger(isIntersecting = true) {
  const live = observers.filter((o) => !o.disconnected);
  const latest = live[live.length - 1];
  if (!latest) throw new Error('no active observer');
  act(() => {
    latest.callback(
      [{ isIntersecting } as IntersectionObserverEntry],
      latest as unknown as IntersectionObserver,
    );
  });
}

beforeEach(() => {
  observers = [];
  vi.stubGlobal('IntersectionObserver', StubObserver);
});
afterEach(() => vi.unstubAllGlobals());

/** Mount a sentinel node, the way the rendered list does. */
function attach(result: { current: ReturnType<typeof useIncremental> }) {
  act(() => {
    result.current.sentinelRef(document.createElement('div'));
  });
}

describe('windowing a long list', () => {
  it('starts with one window, not the whole list', () => {
    const { result } = renderHook(() => useIncremental(20000, 60));
    expect(result.current.count).toBe(60);
    expect(result.current.hasMore).toBe(true);
    expect(result.current.remaining).toBe(19940);
  });

  it('never claims more than exists', () => {
    const { result } = renderHook(() => useIncremental(12, 60));
    expect(result.current.count).toBe(12);
    expect(result.current.hasMore).toBe(false);
    expect(result.current.remaining).toBe(0);
  });

  it('handles an empty list', () => {
    const { result } = renderHook(() => useIncremental(0, 60));
    expect(result.current.count).toBe(0);
    expect(result.current.hasMore).toBe(false);
  });

  it('grows by one window on request', () => {
    const { result } = renderHook(() => useIncremental(500, 60));
    act(() => result.current.showMore());
    expect(result.current.count).toBe(120);
    act(() => result.current.showMore());
    expect(result.current.count).toBe(180);
  });

  it('stops growing at the end rather than overshooting', () => {
    const { result } = renderHook(() => useIncremental(70, 60));
    act(() => result.current.showMore());
    expect(result.current.count).toBe(70);
    expect(result.current.hasMore).toBe(false);
    act(() => result.current.showMore());
    expect(result.current.count).toBe(70);
  });

  it('reveals everything at once when asked', () => {
    const { result } = renderHook(() => useIncremental(5000, 60));
    act(() => result.current.showAll());
    expect(result.current.count).toBe(5000);
    expect(result.current.hasMore).toBe(false);
  });

  it('restarts when the list changes, so a new filter does not inherit the old window', () => {
    const { result, rerender } = renderHook(({ total }) => useIncremental(total, 60), {
      initialProps: { total: 5000 },
    });
    act(() => result.current.showMore());
    expect(result.current.count).toBe(120);

    rerender({ total: 300 }); // the user typed a search
    expect(result.current.count).toBe(60);
  });
});

describe('loading as the sentinel comes into view', () => {
  it('grows when the sentinel is intersected', () => {
    const { result } = renderHook(() => useIncremental(1000, 60));
    attach(result);
    expect(result.current.count).toBe(60);

    trigger(true);
    expect(result.current.count).toBe(120);

    trigger(true);
    expect(result.current.count).toBe(180);
  });

  it('ignores a non-intersecting report', () => {
    const { result } = renderHook(() => useIncremental(1000, 60));
    attach(result);
    trigger(false);
    expect(result.current.count).toBe(60);
  });

  it('stops observing once the list is exhausted', () => {
    const { result } = renderHook(() => useIncremental(100, 60));
    attach(result);
    trigger(true);
    expect(result.current.count).toBe(100);
    expect(result.current.hasMore).toBe(false);
    // Nothing left to watch for.
    expect(observers.every((o) => o.disconnected)).toBe(true);
  });

  it('tears the observer down on unmount', () => {
    const { result, unmount } = renderHook(() => useIncremental(1000, 60));
    attach(result);
    trigger(true);
    unmount();
    expect(observers.every((o) => o.disconnected)).toBe(true);
  });

  it('works when the browser has no IntersectionObserver at all', () => {
    vi.unstubAllGlobals();
    vi.stubGlobal('IntersectionObserver', undefined);
    const { result } = renderHook(() => useIncremental(1000, 60));
    // The manual control must still function as the fallback.
    act(() => result.current.showMore());
    expect(result.current.count).toBe(120);
  });
});
