import { describe, it, expect } from 'vitest';
import {
  parseAmount,
  formatMoney,
  fromMajor,
  toMajor,
  toInputString,
  allocate,
  allocateEvenly,
  convertMinor,
  addMinor,
  sumMinor,
  assertMinor,
  isSafeMinor,
  roundHalfAwayFromZero,
  MAX_MINOR_UNITS,
  MoneyError,
} from './money';

const ok = (r: ReturnType<typeof parseAmount>) => {
  if (!r.ok) throw new Error(`expected parse to succeed, got: ${r.error}`);
  return r.minor;
};

describe('parseAmount', () => {
  it('parses plain integers into minor units', () => {
    expect(ok(parseAmount('850'))).toBe(85000);
    expect(ok(parseAmount('0'))).toBe(0);
  });

  it('parses decimals exactly, without float drift', () => {
    expect(ok(parseAmount('12.34'))).toBe(1234);
    expect(ok(parseAmount('0.1'))).toBe(10);
    expect(ok(parseAmount('0.01'))).toBe(1);
    expect(ok(parseAmount('.5'))).toBe(50);
    // The classic float trap: 1.005 * 100 === 100.49999999999999
    expect(ok(parseAmount('1.005'))).toBe(101);
    expect(ok(parseAmount('8.615'))).toBe(862);
  });

  it('rounds beyond currency precision rather than silently truncating', () => {
    expect(ok(parseAmount('12.345'))).toBe(1235);
    expect(ok(parseAmount('12.344'))).toBe(1234);
  });

  it('handles western and Indian digit grouping', () => {
    expect(ok(parseAmount('1,234.56'))).toBe(123456);
    expect(ok(parseAmount('1,00,000'))).toBe(10000000);
    expect(ok(parseAmount('12,34,567.89'))).toBe(123456789);
  });

  it('strips currency symbols and codes', () => {
    expect(ok(parseAmount('Rs. 500'))).toBe(50000);
    expect(ok(parseAmount('$12.50', 'USD'))).toBe(1250);
    expect(ok(parseAmount('PKR 1,200'))).toBe(120000);
    expect(ok(parseAmount('₹99', 'INR'))).toBe(9900);
  });

  it('accepts negatives in minus and accounting-parenthesis form', () => {
    expect(ok(parseAmount('-42'))).toBe(-4200);
    expect(ok(parseAmount('(1,200)'))).toBe(-120000);
    expect(ok(parseAmount('(-5)'))).toBe(500); // double negation
  });

  it('expands shorthand multipliers for fast entry', () => {
    expect(ok(parseAmount('5k'))).toBe(500000);
    expect(ok(parseAmount('1.5k'))).toBe(150000);
    expect(ok(parseAmount('2.5 lakh'))).toBe(25000000);
    expect(ok(parseAmount('1 cr'))).toBe(1000000000);
    expect(ok(parseAmount('1.2m'))).toBe(120000000);
  });

  it('normalises non-ASCII digits', () => {
    expect(ok(parseAmount('٨٥٠'))).toBe(85000);
  });

  it('respects currencies with different precision', () => {
    expect(ok(parseAmount('1000', 'JPY'))).toBe(1000); // zero decimals
    expect(ok(parseAmount('1.234', 'KWD'))).toBe(1234); // three decimals
    expect(ok(parseAmount('1.2345', 'KWD'))).toBe(1235);
  });

  it('rejects malformed input with a readable message', () => {
    for (const bad of ['', '   ', 'abc', '1.2.3', '--5', 'Rs.', '1,2,,3.4.5']) {
      const r = parseAmount(bad);
      expect(r.ok, `expected "${bad}" to be rejected`).toBe(false);
      if (!r.ok) expect(r.error.length).toBeGreaterThan(0);
    }
  });

  it('rejects values beyond the supported range', () => {
    expect(parseAmount('1e400').ok).toBe(false);
    expect(parseAmount('999999999999999999999').ok).toBe(false);
    expect(fromMajor(Number.POSITIVE_INFINITY).ok).toBe(false);
    expect(fromMajor(Number.NaN).ok).toBe(false);
  });

  it('accepts extremely large but supported amounts', () => {
    // Rs. 1 billion
    expect(ok(parseAmount('1000000000'))).toBe(100000000000);
  });
});

describe('assertMinor / isSafeMinor', () => {
  it('rejects floats, NaN, Infinity and out-of-range values', () => {
    expect(() => assertMinor(1.5)).toThrow(MoneyError);
    expect(() => assertMinor(Number.NaN)).toThrow(MoneyError);
    expect(() => assertMinor(Number.POSITIVE_INFINITY)).toThrow(MoneyError);
    expect(() => assertMinor(MAX_MINOR_UNITS * 10)).toThrow(MoneyError);
    expect(isSafeMinor(1.5)).toBe(false);
    expect(isSafeMinor(0)).toBe(true);
    expect(isSafeMinor(-100)).toBe(true);
  });
});

describe('roundHalfAwayFromZero', () => {
  it('rounds symmetrically around zero', () => {
    expect(roundHalfAwayFromZero(0.5)).toBe(1);
    expect(roundHalfAwayFromZero(-0.5)).toBe(-1);
    expect(roundHalfAwayFromZero(2.4)).toBe(2);
    expect(roundHalfAwayFromZero(-2.6)).toBe(-3);
    expect(Object.is(roundHalfAwayFromZero(-0.4), -0)).toBe(false);
  });
});

describe('formatMoney', () => {
  it('formats PKR with Indian grouping', () => {
    expect(formatMoney(85000)).toBe('Rs. 850.00');
    expect(formatMoney(10000000)).toBe('Rs. 1,00,000.00');
    expect(formatMoney(123456789)).toBe('Rs. 12,34,567.89');
  });

  it('formats USD with western grouping', () => {
    expect(formatMoney(123456, 'USD')).toBe('$ 1,234.56');
  });

  it('uses a true minus sign, not a hyphen', () => {
    expect(formatMoney(-85000)).toBe('−Rs. 850.00');
  });

  it('never renders negative zero', () => {
    expect(formatMoney(roundHalfAwayFromZero(-0.4))).toBe('Rs. 0.00');
  });

  it('never signs a zero', () => {
    expect(formatMoney(0, 'PKR', { sign: 'always', symbol: false })).toBe('0.00');
  });

  it('can show explicit signs', () => {
    expect(formatMoney(100, 'PKR', { sign: 'always', symbol: false })).toBe('+1.00');
    expect(formatMoney(-100, 'PKR', { sign: 'always', symbol: false })).toBe('−1.00');
    expect(formatMoney(-100, 'PKR', { sign: 'never', symbol: false })).toBe('1.00');
  });

  it('trims zero decimals when asked', () => {
    expect(formatMoney(85000, 'PKR', { trimZeroDecimals: true })).toBe('Rs. 850');
    expect(formatMoney(85050, 'PKR', { trimZeroDecimals: true })).toBe('Rs. 850.50');
  });

  it('handles zero-decimal currencies', () => {
    expect(formatMoney(1000, 'JPY')).toBe('¥ 1,000');
  });

  it('compacts large values using locale-appropriate units', () => {
    expect(formatMoney(10000000, 'PKR', { compact: true, symbol: false })).toBe('1L');
    expect(formatMoney(100000000000, 'PKR', { compact: true, symbol: false })).toBe('1Cr');
    expect(formatMoney(100000000, 'USD', { compact: true, symbol: false })).toBe('1M');
  });

  it('never renders NaN to the user', () => {
    expect(formatMoney(Number.NaN)).toContain('—');
  });
});

describe('toMajor / toInputString', () => {
  it('round-trips through major units', () => {
    expect(toMajor(123456)).toBe(1234.56);
    expect(toInputString(123456)).toBe('1234.56');
    expect(toInputString(-50)).toBe('-0.50');
    expect(toInputString(1000, 'JPY')).toBe('1000');
  });
});

describe('addMinor / sumMinor', () => {
  it('sums integers exactly', () => {
    expect(addMinor(1, 2, 3)).toBe(6);
    expect(sumMinor([300000, 120000, 80000])).toBe(500000);
    expect(sumMinor([])).toBe(0);
  });

  it('refuses to silently accept floats', () => {
    expect(() => addMinor(1.5, 2)).toThrow(MoneyError);
  });
});

describe('allocate — the split-transaction guarantee', () => {
  it('splits by weights and sums to exactly the total', () => {
    const parts = allocate(500000, [300000, 120000, 80000]);
    expect(parts).toEqual([300000, 120000, 80000]);
    expect(sumMinor(parts)).toBe(500000);
  });

  it('distributes indivisible remainders without losing or inventing money', () => {
    // Rs. 10.00 three ways cannot divide evenly: 333 + 333 + 334
    const parts = allocateEvenly(1000, 3);
    expect(sumMinor(parts)).toBe(1000);
    expect(parts.sort((a, b) => a - b)).toEqual([333, 333, 334]);
  });

  it('holds the invariant across many awkward splits', () => {
    for (let total = 1; total <= 400; total++) {
      for (let n = 1; n <= 7; n++) {
        const parts = allocateEvenly(total, n);
        expect(sumMinor(parts), `total=${total} n=${n}`).toBe(total);
        expect(parts).toHaveLength(n);
      }
    }
  });

  it('handles negative totals symmetrically', () => {
    const parts = allocateEvenly(-1000, 3);
    expect(sumMinor(parts)).toBe(-1000);
    expect(parts.every((p) => p <= 0)).toBe(true);
  });

  it('handles zero totals', () => {
    expect(allocateEvenly(0, 4)).toEqual([0, 0, 0, 0]);
  });

  it('handles a single share', () => {
    expect(allocateEvenly(12345, 1)).toEqual([12345]);
  });

  it('handles zero weights without dividing by zero', () => {
    expect(sumMinor(allocate(1000, [0, 0, 0]))).toBe(1000);
  });

  it('rejects invalid weights and part counts', () => {
    expect(() => allocate(1000, [-1, 2])).toThrow(MoneyError);
    expect(() => allocateEvenly(1000, 0)).toThrow(MoneyError);
    expect(() => allocateEvenly(1000, 2.5)).toThrow(MoneyError);
  });
});

describe('convertMinor', () => {
  it('returns the input unchanged for same-currency conversion', () => {
    expect(convertMinor(12345, 'PKR', 'PKR', 1)).toBe(12345);
    // even with a nonsense rate, same-currency is a no-op
    expect(convertMinor(12345, 'PKR', 'PKR', 3)).toBe(12345);
  });

  it('converts between two-decimal currencies', () => {
    // $10.00 at 278.50 PKR/USD = Rs. 2,785.00
    expect(convertMinor(1000, 'USD', 'PKR', 278.5)).toBe(278500);
  });

  it('converts across differing precision', () => {
    // $10.00 at 149.20 JPY/USD = ¥1492 (zero decimals)
    expect(convertMinor(1000, 'USD', 'JPY', 149.2)).toBe(1492);
    // ¥1000 at 0.0067 USD/JPY = $6.70
    expect(convertMinor(1000, 'JPY', 'USD', 0.0067)).toBe(670);
  });

  it('rounds once, at the end', () => {
    expect(convertMinor(333, 'USD', 'PKR', 278.5333)).toBe(92752);
  });

  it('rejects non-positive or non-finite rates', () => {
    expect(() => convertMinor(100, 'USD', 'PKR', 0)).toThrow(MoneyError);
    expect(() => convertMinor(100, 'USD', 'PKR', -1)).toThrow(MoneyError);
    expect(() => convertMinor(100, 'USD', 'PKR', Number.NaN)).toThrow(MoneyError);
  });

  it('preserves sign', () => {
    expect(convertMinor(-1000, 'USD', 'PKR', 278.5)).toBe(-278500);
  });
});
