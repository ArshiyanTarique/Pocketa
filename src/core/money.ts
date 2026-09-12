/**
 * Money primitives.
 *
 * INVARIANT: every monetary value in Pocketa is an integer number of MINOR UNITS
 * (paisa for PKR, cents for USD). Floating-point currency values never enter the
 * money path. `1234` means Rs. 12.34, never Rs. 1234.
 *
 * This is the foundation of principle #1 (financial data must be accurate).
 */

export interface CurrencyDef {
  code: string;
  /** Number of decimal places. PKR/USD = 2, JPY = 0, KWD = 3. */
  decimals: number;
  symbol: string;
  name: string;
  /** Digit grouping style. Indian grouping is 2,2,3 (1,00,000). */
  grouping: 'western' | 'indian';
}

export const CURRENCIES: Record<string, CurrencyDef> = {
  PKR: { code: 'PKR', decimals: 2, symbol: 'Rs.', name: 'Pakistani Rupee', grouping: 'indian' },
  USD: { code: 'USD', decimals: 2, symbol: '$', name: 'US Dollar', grouping: 'western' },
  EUR: { code: 'EUR', decimals: 2, symbol: '€', name: 'Euro', grouping: 'western' },
  GBP: { code: 'GBP', decimals: 2, symbol: '£', name: 'British Pound', grouping: 'western' },
  AED: { code: 'AED', decimals: 2, symbol: 'AED', name: 'UAE Dirham', grouping: 'western' },
  SAR: { code: 'SAR', decimals: 2, symbol: 'SAR', name: 'Saudi Riyal', grouping: 'western' },
  INR: { code: 'INR', decimals: 2, symbol: '₹', name: 'Indian Rupee', grouping: 'indian' },
  JPY: { code: 'JPY', decimals: 0, symbol: '¥', name: 'Japanese Yen', grouping: 'western' },
  KWD: { code: 'KWD', decimals: 3, symbol: 'KWD', name: 'Kuwaiti Dinar', grouping: 'western' },
  BHD: { code: 'BHD', decimals: 3, symbol: 'BHD', name: 'Bahraini Dinar', grouping: 'western' },
  CAD: { code: 'CAD', decimals: 2, symbol: 'C$', name: 'Canadian Dollar', grouping: 'western' },
  AUD: { code: 'AUD', decimals: 2, symbol: 'A$', name: 'Australian Dollar', grouping: 'western' },
  TRY: { code: 'TRY', decimals: 2, symbol: '₺', name: 'Turkish Lira', grouping: 'western' },
  CNY: { code: 'CNY', decimals: 2, symbol: 'CN¥', name: 'Chinese Yuan', grouping: 'western' },
};

export const DEFAULT_CURRENCY = 'PKR';

/**
 * Practical ceiling for a single amount, well inside Number.MAX_SAFE_INTEGER so
 * that summing thousands of transactions can never lose integer precision.
 * 1e15 minor units = Rs. 10 trillion.
 */
export const MAX_MINOR_UNITS = 1e15;

export function currencyOf(code: string): CurrencyDef {
  return CURRENCIES[code] ?? { code, decimals: 2, symbol: code, name: code, grouping: 'western' };
}

export function decimalsOf(code: string): number {
  return currencyOf(code).decimals;
}

/** 10 ** decimals — the number of minor units in one major unit. */
export function scaleOf(code: string): number {
  return Math.pow(10, decimalsOf(code));
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

/** Throws unless `v` is a safe, finite integer within the supported range. */
export function assertMinor(v: number, context = 'amount'): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new MoneyError(`${context} must be a finite number`);
  }
  if (!Number.isInteger(v)) {
    throw new MoneyError(`${context} must be an integer number of minor units (got ${v})`);
  }
  if (Math.abs(v) > MAX_MINOR_UNITS) {
    throw new MoneyError(`${context} exceeds the maximum supported value`);
  }
  return v;
}

export function isSafeMinor(v: number): boolean {
  return (
    typeof v === 'number' &&
    Number.isFinite(v) &&
    Number.isInteger(v) &&
    Math.abs(v) <= MAX_MINOR_UNITS
  );
}

// ---------------------------------------------------------------------------
// Rounding
// ---------------------------------------------------------------------------

/**
 * Round half away from zero — the convention people expect when entering money.
 * (0.5 -> 1, -0.5 -> -1). Avoids the surprise of Math.round(-0.5) === -0.
 */
export function roundHalfAwayFromZero(v: number): number {
  if (!Number.isFinite(v)) throw new MoneyError('cannot round a non-finite number');
  const r = v < 0 ? -Math.round(-v) : Math.round(v);
  // `+ 0` normalises -0 to 0, so a rounded-away value never renders as "−Rs. 0.00".
  return r + 0;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export type ParseResult =
  | { ok: true; minor: number }
  | { ok: false; error: string };

const SHORTHAND: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9, lac: 1e5, lakh: 1e5, cr: 1e7, crore: 1e7 };

/**
 * Parse human input into minor units.
 *
 * Accepts: "850", "1,234.56", "1,00,000" (Indian grouping), "Rs. 500", "-42",
 * "(42)" as negative, "5k", "2.5 lakh", "1.2m", and unicode Arabic-Indic digits.
 *
 * Rejects: empty, non-numeric, multiple decimal points, values out of range.
 */
export function parseAmount(input: string | number, currency = DEFAULT_CURRENCY): ParseResult {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return { ok: false, error: 'Enter a valid number' };
    return fromMajor(input, currency);
  }
  if (typeof input !== 'string') return { ok: false, error: 'Enter an amount' };

  let s = input.trim();
  if (!s) return { ok: false, error: 'Enter an amount' };

  // Normalise unicode digits (Arabic-Indic, Eastern Arabic-Indic) to ASCII.
  s = s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
  s = s.replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));

  // Accounting-style negatives: (1,200) === -1200
  let negative = false;
  const paren = s.match(/^\((.*)\)$/);
  if (paren) {
    negative = true;
    s = paren[1].trim();
  }

  // Strip currency symbols, codes and whitespace.
  s = s.replace(/[\p{Sc}]/gu, ' ');
  s = s.replace(/\b(?:rs|pkr|usd|eur|gbp|aed|sar|inr|jpy|kwd|bhd|cad|aud|try|cny)\b\.?/gi, ' ');
  s = s.replace(/\s+/g, ' ').trim();

  // Leading/trailing sign.
  const signMatch = s.match(/^([+-])\s*/);
  if (signMatch) {
    if (signMatch[1] === '-') negative = !negative;
    s = s.slice(signMatch[0].length);
  }

  // Shorthand multiplier suffix: 5k, 2.5 lakh, 1.2m
  let multiplier = 1;
  const suffix = s.match(/\s*(k|m|b|lac|lakh|cr|crore)\.?$/i);
  if (suffix) {
    multiplier = SHORTHAND[suffix[1].toLowerCase()];
    s = s.slice(0, s.length - suffix[0].length).trim();
  }

  if (!s) return { ok: false, error: 'Enter an amount' };

  // Remove digit-grouping commas and spaces. Handles western (1,234,567) and
  // Indian (12,34,567) grouping identically since we simply drop separators.
  const cleaned = s.replace(/[,\s_]/g, '');

  if (!/^\d*\.?\d*$/.test(cleaned) || cleaned === '' || cleaned === '.') {
    return { ok: false, error: 'That does not look like a number' };
  }
  if ((cleaned.match(/\./g) ?? []).length > 1) {
    return { ok: false, error: 'Too many decimal points' };
  }

  const magnitude = Number(cleaned) * multiplier;
  if (!Number.isFinite(magnitude)) return { ok: false, error: 'That number is too large' };

  const res = fromMajor(negative ? -magnitude : magnitude, currency);
  return res;
}

/** Convert a major-unit float (e.g. 12.34) to minor units (1234). */
export function fromMajor(major: number, currency = DEFAULT_CURRENCY): ParseResult {
  if (!Number.isFinite(major)) return { ok: false, error: 'Enter a valid number' };
  const scale = scaleOf(currency);
  // Scale via string-safe multiplication then round, to dodge 0.1+0.2 style error.
  const minor = roundHalfAwayFromZero(Number((major * scale).toPrecision(15)));
  if (!isSafeMinor(minor)) return { ok: false, error: 'That amount is too large' };
  return { ok: true, minor };
}

/** Convert minor units back to a major-unit number. Display only — never for maths. */
export function toMajor(minor: number, currency = DEFAULT_CURRENCY): number {
  return minor / scaleOf(currency);
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export interface FormatOptions {
  /** Include the currency symbol. Default true. */
  symbol?: boolean;
  /** 'auto' shows a minus only; 'always' shows + for positives; 'never' hides it. */
  sign?: 'auto' | 'always' | 'never';
  /** Abbreviate large values: 1.2M, 45k. Default false. */
  compact?: boolean;
  /** Hide minor units when they are zero (Rs. 850 rather than Rs. 850.00). */
  trimZeroDecimals?: boolean;
}

function groupIndian(intPart: string): string {
  if (intPart.length <= 3) return intPart;
  const last3 = intPart.slice(-3);
  const rest = intPart.slice(0, -3);
  return rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3;
}

function groupWestern(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Format minor units for display. Never used as an input to further maths. */
export function formatMoney(
  minor: number,
  currency = DEFAULT_CURRENCY,
  opts: FormatOptions = {},
): string {
  const { symbol = true, sign = 'auto', compact = false, trimZeroDecimals = false } = opts;
  const def = currencyOf(currency);

  if (!Number.isFinite(minor)) return symbol ? `${def.symbol} —` : '—';

  const negative = minor < 0;
  const abs = Math.abs(minor);

  let body: string;
  if (compact && abs >= 1000 * scaleOf(currency)) {
    body = compactBody(abs, def);
  } else {
    const scale = scaleOf(currency);
    const intPart = Math.floor(abs / scale).toString();
    const frac = def.decimals > 0 ? (abs % scale).toString().padStart(def.decimals, '0') : '';
    const grouped = def.grouping === 'indian' ? groupIndian(intPart) : groupWestern(intPart);
    const showFrac = def.decimals > 0 && !(trimZeroDecimals && Number(frac) === 0);
    body = showFrac ? `${grouped}.${frac}` : grouped;
  }

  let prefix = '';
  if (sign === 'auto') prefix = negative ? '−' : '';
  // Zero has no direction, so it never takes a sign even in 'always' mode —
  // "+0.00" reads as a gain that did not happen.
  else if (sign === 'always') prefix = negative ? '−' : minor > 0 ? '+' : '';

  return symbol ? `${prefix}${def.symbol} ${body}` : `${prefix}${body}`;
}

function compactBody(absMinor: number, def: CurrencyDef): string {
  const major = absMinor / Math.pow(10, def.decimals);
  const units: Array<[number, string]> =
    def.grouping === 'indian'
      ? [[1e7, 'Cr'], [1e5, 'L'], [1e3, 'k']]
      : [[1e9, 'B'], [1e6, 'M'], [1e3, 'k']];
  for (const [size, suffix] of units) {
    if (major >= size) {
      const v = major / size;
      const shown = v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2);
      return `${shown.replace(/\.?0+$/, '')}${suffix}`;
    }
  }
  return major.toFixed(def.decimals);
}

/** A bare numeric string suitable for a text input, e.g. "1234.56". */
export function toInputString(minor: number, currency = DEFAULT_CURRENCY): string {
  const def = currencyOf(currency);
  const scale = scaleOf(currency);
  const negative = minor < 0;
  const abs = Math.abs(minor);
  const intPart = Math.floor(abs / scale).toString();
  if (def.decimals === 0) return `${negative ? '-' : ''}${intPart}`;
  const frac = (abs % scale).toString().padStart(def.decimals, '0');
  return `${negative ? '-' : ''}${intPart}.${frac}`;
}

// ---------------------------------------------------------------------------
// Arithmetic
// ---------------------------------------------------------------------------

export function addMinor(...values: number[]): number {
  let total = 0;
  for (const v of values) total += assertMinor(v);
  return assertMinor(total, 'sum');
}

export function sumMinor(values: readonly number[]): number {
  return addMinor(...values);
}

export function negateMinor(v: number): number {
  return -assertMinor(v);
}

/**
 * Split `total` across `weights` so the parts sum to EXACTLY `total`.
 *
 * Uses the largest-remainder method: floor every share, then hand the leftover
 * minor units one at a time to the largest fractional remainders. This is what
 * guarantees principle #12 — a split of Rs. 5,000 always totals Rs. 5,000, with
 * no rounding dust appearing or vanishing.
 */
export function allocate(total: number, weights: readonly number[]): number[] {
  assertMinor(total, 'total');
  if (weights.length === 0) return [];
  if (weights.some((w) => !Number.isFinite(w) || w < 0)) {
    throw new MoneyError('allocation weights must be non-negative finite numbers');
  }
  const weightSum = weights.reduce((a, b) => a + b, 0);
  if (weightSum <= 0) {
    // Degenerate case: no weights. Put everything on the first slot.
    return weights.map((_, i) => (i === 0 ? total : 0));
  }

  const sign = total < 0 ? -1 : 1;
  const absTotal = Math.abs(total);

  const exact = weights.map((w) => (absTotal * w) / weightSum);
  const floored = exact.map((v) => Math.floor(v));
  let remainder = absTotal - floored.reduce((a, b) => a + b, 0);

  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  const out = floored.slice();
  let k = 0;
  while (remainder > 0 && order.length > 0) {
    out[order[k % order.length].i] += 1;
    remainder -= 1;
    k += 1;
  }

  // `+ 0` normalises -0 to 0 for zero-weight shares of a negative total.
  return out.map((v) => v * sign + 0);
}

/** Split `total` into `n` equal parts that sum exactly to `total`. */
export function allocateEvenly(total: number, n: number): number[] {
  if (!Number.isInteger(n) || n <= 0) throw new MoneyError('parts must be a positive integer');
  return allocate(total, new Array(n).fill(1));
}

// ---------------------------------------------------------------------------
// Currency conversion
// ---------------------------------------------------------------------------

/**
 * Convert an amount between currencies at an explicit rate.
 *
 * `rate` is expressed as: 1 unit of `from` = `rate` units of `to`.
 * The result is rounded to the target currency's precision, once.
 *
 * Rates are always supplied by the caller and frozen onto the transaction at
 * entry time (assumption A4) so that historical reports never change when
 * today's exchange rate moves.
 */
export function convertMinor(minor: number, from: string, to: string, rate: number): number {
  assertMinor(minor);
  if (from === to) return minor;
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new MoneyError('exchange rate must be a positive finite number');
  }
  const fromScale = scaleOf(from);
  const toScale = scaleOf(to);
  const converted = (minor / fromScale) * rate * toScale;
  const rounded = roundHalfAwayFromZero(Number(converted.toPrecision(15)));
  return assertMinor(rounded, 'converted amount');
}
