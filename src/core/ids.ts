/** Stable, collision-free ids. Prefixed so a raw id is self-describing in logs. */

function uuid(): string {
  const g = globalThis as { crypto?: Crypto };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  // Deterministic-enough fallback for environments without WebCrypto.
  let s = '';
  for (let i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16);
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-4${s.slice(13, 16)}-a${s.slice(17, 20)}-${s.slice(20, 32)}`;
}

export type IdPrefix =
  | 'acc' | 'txn' | 'pst' | 'per' | 'bud' | 'rec' | 'ovr'
  | 'gol' | 'dbt' | 'att' | 'op' | 'imp' | 'dev';

export function newId(prefix: IdPrefix): string {
  return `${prefix}_${uuid().replace(/-/g, '').slice(0, 20)}`;
}

/** Creates an id factory with a deterministic sequence, for tests. */
export function sequentialIds(seed = 0): (prefix: IdPrefix) => string {
  let n = seed;
  return (prefix: IdPrefix) => `${prefix}_${String(++n).padStart(6, '0')}`;
}
