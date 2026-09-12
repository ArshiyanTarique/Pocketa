import * as React from 'react';

/**
 * A small hash router.
 *
 * A dependency would buy very little here: the app is a fixed set of tabs with
 * one optional detail segment. Hash routing also means the built PWA works from
 * any static host and any subdirectory without server rewrite rules.
 */

export interface Route {
  path: string;
  segment: string | null;
  query: URLSearchParams;
}

function parse(hash: string): Route {
  const raw = hash.replace(/^#/, '') || '/';
  const [pathPart, queryPart] = raw.split('?');
  const parts = pathPart.split('/').filter(Boolean);
  return {
    path: parts[0] ? `/${parts[0]}` : '/',
    segment: parts[1] ? decodeURIComponent(parts[1]) : null,
    query: new URLSearchParams(queryPart ?? ''),
  };
}

const RouteContext = React.createContext<Route>({
  path: '/',
  segment: null,
  query: new URLSearchParams(),
});

export function RouterProvider({ children }: { children: React.ReactNode }) {
  const [route, setRoute] = React.useState<Route>(() => parse(window.location.hash));

  React.useEffect(() => {
    const onChange = () => {
      setRoute(parse(window.location.hash));
      // A route change should start at the top, as a page load would.
      window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  return <RouteContext.Provider value={route}>{children}</RouteContext.Provider>;
}

export function useRoute(): Route {
  return React.useContext(RouteContext);
}

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  const target = to.startsWith('#') ? to : `#${to}`;
  if (opts.replace) {
    window.history.replaceState(null, '', target);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    window.location.hash = target;
  }
}

export function back() {
  if (window.history.length > 1) window.history.back();
  else navigate('/');
}

export function Link({
  to,
  children,
  className,
  onClick,
  ...rest
}: React.AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) {
  return (
    <a
      href={to.startsWith('#') ? to : `#${to}`}
      className={className}
      onClick={onClick}
      {...rest}
    >
      {children}
    </a>
  );
}
