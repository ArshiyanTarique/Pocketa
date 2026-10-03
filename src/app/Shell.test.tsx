// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

// The shell talks to the sync engine; the test is about what a newcomer can
// read, not about the network, so the engine is a quiet stub here.
vi.mock('./useSync', () => ({
  useSyncEngine: () => undefined,
  useSync: () => ({ phase: 'signed_out', email: null, displayName: null, avatarUrl: null, syncNow: () => undefined }),
  describeSync: () => 'Not signed in',
}));

// jsdom has no matchMedia; the shell only asks it whether the viewport is wide.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: () => ({ matches: true, addEventListener: () => undefined, removeEventListener: () => undefined }),
});

import { Shell, NAV, PLAN_TAB, MORE_TAB } from './Shell';
import { RouterProvider } from './router';

afterEach(cleanup);

/**
 * Every control a newcomer can press must say what it does in words. Icons
 * alone are allowed only as decoration next to a label, never as the label.
 */
describe('the shell is readable without hovering', () => {
  it('gives every button and link visible text', () => {
    const { container } = render(
      <RouterProvider>
        <Shell onQuickAdd={() => undefined}>
          <p>screen</p>
        </Shell>
      </RouterProvider>,
    );
    const controls = container.querySelectorAll<HTMLElement>('button, a');
    expect(controls.length).toBeGreaterThan(5);
    for (const el of controls) {
      expect(el.textContent?.trim(), `${el.tagName} ${el.outerHTML.slice(0, 80)}`).not.toBe('');
    }
  });

  it('shows every destination by name on desktop', () => {
    const { container } = render(
      <RouterProvider>
        <Shell onQuickAdd={() => undefined}>
          <p>screen</p>
        </Shell>
      </RouterProvider>,
    );
    const text = container.textContent ?? '';
    for (const item of NAV) expect(text).toContain(item.label);
    for (const tab of [PLAN_TAB, MORE_TAB]) expect(text).toContain(tab.label);
  });

  it('gives every destination a plain-language purpose', () => {
    for (const item of [...NAV, PLAN_TAB, MORE_TAB]) {
      expect(item.purpose.length, item.label).toBeGreaterThan(10);
    }
  });
});
