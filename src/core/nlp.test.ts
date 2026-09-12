import { describe, it, expect } from 'vitest';
import { parseNaturalLanguage, describeParse } from './nlp';
import { makeLedger, rs } from '../test/fixtures';

const ASOF = '2026-09-15'; // a Tuesday

function parse(text: string) {
  const { a, accounts } = makeLedger();
  return { parsed: parseNaturalLanguage(text, { accounts: [...accounts.values()], asOf: ASOF }), a };
}

describe('the worked example from the brief', () => {
  it('parses "Spent 850 on dinner at OPTP yesterday"', () => {
    const { parsed, a } = parse('Spent 850 on dinner at OPTP yesterday');
    expect(parsed.amount).toBe(rs(850));
    expect(parsed.date).toBe('2026-09-14');
    expect(parsed.merchant).toBe('OPTP');
    expect(parsed.kind).toBe('expense');
    // "dinner" resolves to Food, since this fixture has no "Dining out"
    expect(parsed.categoryId).toBe(a.food.id);
  });
});

describe('amounts', () => {
  it('reads bare numbers, currency prefixes and shorthand', () => {
    expect(parse('spent 1200 on groceries').parsed.amount).toBe(rs(1200));
    expect(parse('paid Rs. 4,500 for rent').parsed.amount).toBe(rs(4500));
    expect(parse('spent 2.5k on fuel').parsed.amount).toBe(rs(2500));
    expect(parse('paid 1 lakh for tuition').parsed.amount).toBe(rs(100000));
    expect(parse('spent 99.50 on coffee').parsed.amount).toBe(rs(99.5));
  });

  it('does not mistake a year for an amount', () => {
    const { parsed } = parse('paid 1500 for books on 12 Sep 2026');
    expect(parsed.amount).toBe(rs(1500));
    expect(parsed.date).toBe('2026-09-12');
  });

  it('reports when no amount could be found', () => {
    const { parsed } = parse('bought groceries at Imtiaz');
    expect(parsed.amount).toBeNull();
    expect(describeParse(parsed)).toContain('No amount found — enter it below.');
  });
});

describe('dates', () => {
  it('understands relative days', () => {
    expect(parse('spent 100 today').parsed.date).toBe('2026-09-15');
    expect(parse('spent 100 yesterday').parsed.date).toBe('2026-09-14');
    expect(parse('spent 100 tomorrow').parsed.date).toBe('2026-09-16');
    expect(parse('spent 100 3 days ago').parsed.date).toBe('2026-09-12');
    expect(parse('spent 100 2 weeks ago').parsed.date).toBe('2026-09-01');
  });

  it('resolves a bare weekday to the most recent past one', () => {
    // 15 Sep 2026 is a Tuesday; "friday" means the 11th, not the 18th.
    expect(parse('spent 100 on friday').parsed.date).toBe('2026-09-11');
    expect(parse('spent 100 last monday').parsed.date).toBe('2026-09-14');
  });

  it('reads explicit dates in several forms', () => {
    expect(parse('spent 100 on 12 Sep').parsed.date).toBe('2026-09-12');
    expect(parse('spent 100 on Sep 12').parsed.date).toBe('2026-09-12');
    expect(parse('spent 100 on 3 March 2025').parsed.date).toBe('2025-03-03');
    expect(parse('spent 100 on 2026-02-28').parsed.date).toBe('2026-02-28');
  });

  it('ignores an impossible date rather than inventing one', () => {
    expect(parse('spent 100 on 31 February').parsed.date).toBe(ASOF);
  });

  it('defaults to today when no date is mentioned', () => {
    const { parsed } = parse('spent 500 on groceries');
    expect(parsed.date).toBe(ASOF);
    expect(parsed.found.has('date')).toBe(false);
  });
});

describe('kind', () => {
  it('detects income, expense and transfer verbs', () => {
    expect(parse('received 200000 salary').parsed.kind).toBe('income');
    expect(parse('got 5000 from client').parsed.kind).toBe('income');
    expect(parse('spent 500 on lunch').parsed.kind).toBe('expense');
    expect(parse('transferred 20000 to cash').parsed.kind).toBe('transfer');
    expect(parse('withdrew 10000').parsed.kind).toBe('transfer');
  });

  it('picks an income category for income sentences', () => {
    const { parsed, a } = parse('received 200000 salary');
    expect(parsed.categoryId).toBe(a.salary.id);
  });
});

describe('merchant', () => {
  it('extracts a merchant after at/from', () => {
    expect(parse('spent 850 at OPTP').parsed.merchant).toBe('OPTP');
    expect(parse('spent 1200 at Imtiaz Super Market').parsed.merchant).toBe('Imtiaz Super Market');
    expect(parse('got 5000 from Acme Corp').parsed.merchant).toBe('Acme Corp');
  });

  it('leaves merchant empty when there is nothing to take', () => {
    expect(parse('spent 500 on groceries').parsed.merchant).toBeNull();
  });

  it('does not treat a filler word as a merchant', () => {
    expect(parse('spent 500 at the').parsed.merchant).toBeNull();
  });
});

describe('accounts and categories', () => {
  it('matches an account by name', () => {
    const { parsed, a } = parse('spent 500 on food from Meezan Bank');
    expect(parsed.accountId).toBe(a.bank.id);
  });

  it('understands cash, bank and card shorthands', () => {
    const { a } = makeLedger();
    expect(parse('spent 500 on food in cash').parsed.accountId).toBe(a.cash.id);
    expect(parse('spent 500 on food on card').parsed.accountId).toBe(a.card.id);
  });

  it('maps everyday words to categories', () => {
    const { a } = makeLedger();
    expect(parse('spent 300 on petrol').parsed.categoryId).toBe(a.transport.id);
    expect(parse('spent 2000 on groceries').parsed.categoryId).toBe(a.groceries.id);
    expect(parse('paid 1500 for uber').parsed.categoryId).toBe(a.transport.id);
  });

  it('matches a category by its own name', () => {
    const { parsed, a } = parse('spent 500 on Household');
    expect(parsed.categoryId).toBe(a.household.id);
  });
});

describe('tags', () => {
  it('extracts hashtags and removes them from the text', () => {
    const { parsed } = parse('spent 3000 on dinner #Family #Birthday');
    expect(parsed.tags).toEqual(['Family', 'Birthday']);
    expect(parsed.leftover).not.toContain('#');
  });
});

describe('confirmation is always required', () => {
  it('returns a proposal and never a saved record', () => {
    const { parsed } = parse('spent 850 on dinner at OPTP yesterday');
    // The parser has no access to a store and produces only data.
    expect(parsed).not.toHaveProperty('id');
    expect(parsed.found).toBeInstanceOf(Set);
  });

  it('flags every field it had to guess so the UI can surface it', () => {
    const { parsed } = parse('bought something');
    const notes = describeParse(parsed);
    expect(notes.length).toBeGreaterThan(0);
    expect(parsed.found.has('amount')).toBe(false);
    expect(parsed.found.has('category')).toBe(false);
  });
});

/**
 * How people actually type into a phone: no verb, lower case, the merchant
 * first, a quantity in the way, a person's name instead of a shop.
 */
describe('user-written sentences', () => {
  it('needs no verb: "optp 850"', () => {
    const { parsed, a } = parse('optp 850');
    expect(parsed.amount).toBe(rs(850));
    expect(parsed.kind).toBe('expense');
    expect(parsed.merchant).toBe('OPTP');
    expect(parsed.categoryId).toBe(a.food.id);
  });

  it('finds the merchant before the amount: "careem 350 to uni"', () => {
    const { parsed, a } = parse('careem 350 to uni');
    expect(parsed.amount).toBe(rs(350));
    expect(parsed.merchant).toBe('Careem');
    expect(parsed.categoryId).toBe(a.transport.id);
  });

  it('does not mistake a quantity for the price: "2 chai 120"', () => {
    const { parsed } = parse('2 chai 120');
    expect(parsed.amount).toBe(rs(120));
  });

  it('nor a plural count: "3 samosas for 90"', () => {
    expect(parse('3 samosas for 90').parsed.amount).toBe(rs(90));
  });

  it('multiplies "2 x 350"', () => {
    expect(parse('2 x 350 tickets').parsed.amount).toBe(rs(700));
    expect(parse('tickets 350 x 2').parsed.amount).toBe(rs(700));
  });

  it('prefers the number with a currency marker', () => {
    expect(parse('3 people rs 1800 dinner').parsed.amount).toBe(rs(1800));
    expect(parse('paid 250 for 5 kg').parsed.amount).toBe(rs(250));
  });

  it('reads brands as both merchant and category', () => {
    const { parsed, a } = parse('kfc 1200');
    expect(parsed.merchant).toBe('KFC');
    expect(parsed.categoryId).toBe(a.food.id);
    expect(parse('imtiaz 4300').parsed.categoryId).toBe(a.groceries.id);
    expect(parse('bykea 180 home').parsed.categoryId).toBe(a.transport.id);
  });

  it('matches a merchant this person has typed before, however it is cased', () => {
    const { accounts } = makeLedger();
    const parsed = parseNaturalLanguage('zahid nihari 400', {
      accounts: [...accounts.values()],
      asOf: ASOF,
      merchants: ['Zahid Nihari', 'Careem'],
    });
    expect(parsed.merchant).toBe('Zahid Nihari');
    expect(parsed.found.has('merchant')).toBe(true);
  });

  it('proposes the category that merchant is usually filed under', () => {
    const { accounts, a } = makeLedger();
    const parsed = parseNaturalLanguage('zahid nihari 400', {
      accounts: [...accounts.values()],
      asOf: ASOF,
      merchants: ['Zahid Nihari'],
      merchantMemory: new Map([['zahid nihari', a.food.id]]),
    });
    expect(parsed.categoryId).toBe(a.food.id);
    expect(parsed.found.has('category')).toBe(true);
  });

  it('offers an unknown leftover as the merchant, flagged as a guess', () => {
    const { parsed } = parse('bilal traders 900');
    expect(parsed.merchant).toBe('Bilal Traders');
    expect(parsed.found.has('merchant')).toBe(false);
    expect(describeParse(parsed).some((n) => n.includes('Bilal Traders'))).toBe(true);
  });

  it('does not offer a number-only or stopword-only leftover as a merchant', () => {
    expect(parse('spent 500 today').parsed.merchant).toBeNull();
    expect(parse('paid 500').parsed.merchant).toBeNull();
  });

  it('stops a merchant at the next verb: "went to dolmen mall spent 3000"', () => {
    const { parsed } = parse('went to dolmen mall spent 3000');
    expect(parsed.merchant).toBe('Dolmen Mall');
    expect(parsed.amount).toBe(rs(3000));
  });

  it('handles ordinal days: "rent 25000 on the 1st"', () => {
    // 15 Sep 2026 → the 1st is this month.
    expect(parse('rent 25000 on the 1st').parsed.date).toBe('2026-09-01');
    // The 20th has not happened yet this month, so it means last month.
    expect(parse('paid 3000 on 20th').parsed.date).toBe('2026-08-20');
  });

  it('handles "last week", "a week ago", "last night", "12/9"', () => {
    expect(parse('100 last week').parsed.date).toBe('2026-09-08');
    expect(parse('100 a week ago').parsed.date).toBe('2026-09-08');
    expect(parse('dinner 900 last night').parsed.date).toBe('2026-09-14');
    expect(parse('100 on 12/9').parsed.date).toBe('2026-09-12');
  });

  it('turns a known person into a loan, not a spend: "lent ali 500"', () => {
    const { a } = makeLedger();
    const { parsed } = parse('gave sara 500');
    expect(parsed.kind).toBe('lend');
    expect(parsed.toAccountId).toBe(a.sara.id);
    expect(parsed.amount).toBe(rs(500));
  });

  it('reads a repayment from a person: "sara paid me back 500"', () => {
    const { a } = makeLedger();
    const { parsed } = parse('sara paid me back 500');
    expect(parsed.kind).toBe('repay_in');
    expect(parsed.accountId).toBe(a.sara.id);
  });

  it('reads a borrowing: "borrowed 2000 from bilal"', () => {
    const { a } = makeLedger();
    const { parsed } = parse('borrowed 2000 from bilal');
    expect(parsed.kind).toBe('borrow');
    expect(parsed.accountId).toBe(a.bilal.id);
  });

  it('resolves both sides of a transfer: "moved 5000 from meezan bank to savings"', () => {
    const { a } = makeLedger();
    const { parsed } = parse('moved 5000 from meezan bank to savings');
    expect(parsed.kind).toBe('transfer');
    expect(parsed.accountId).toBe(a.bank.id);
    expect(parsed.toAccountId).toBe(a.savings.id);
  });

  it('treats "from X to Y" as a transfer even without a verb', () => {
    const { a } = makeLedger();
    const { parsed } = parse('5000 from cash to savings');
    expect(parsed.kind).toBe('transfer');
    expect(parsed.accountId).toBe(a.cash.id);
    expect(parsed.toAccountId).toBe(a.savings.id);
  });

  it('recognises a refund', () => {
    const { parsed } = parse('refund from daraz 1200');
    expect(parsed.kind).toBe('refund');
    expect(parsed.merchant).toBe('Daraz');
  });

  it('recognises more ways money arrives', () => {
    expect(parse('sold old phone 15000').parsed.kind).toBe('income');
    expect(parse('eidi 5000').parsed.kind).toBe('income');
    expect(parse('cashback 120').parsed.kind).toBe('income');
    const { parsed, a } = parse('freelance client sent me 50000');
    expect(parsed.kind).toBe('income');
    expect(parsed.categoryId).toBe(a.freelance.id);
  });

  it('reads e-wallet and card shorthands', () => {
    const { a } = makeLedger();
    expect(parse('chai 60 cash').parsed.accountId).toBe(a.cash.id);
    expect(parse('daraz 2500 on card').parsed.accountId).toBe(a.card.id);
  });

  it('records money owed to somebody new as a debt, never as a spend', () => {
    const { parsed, a } = parse('I owe hashim 240 rupees for the soft drink he bought for me');
    expect(parsed.kind).toBe('borrow');
    expect(parsed.personName).toBe('Hashim');
    expect(parsed.amount).toBe(rs(240));
    // "soft drink" → Coffee & snacks → falls back to Food in this ledger.
    expect(parsed.categoryId).toBe(a.food.id);
    // Pronouns and the verb do not leak into the note.
    expect(parsed.notes ?? '').not.toMatch(/\b(i|he|owe|bought)\b/i);
  });

  it('reads "X owes me" as a loan to a new person', () => {
    const { parsed } = parse('hashim owes me 300');
    expect(parsed.kind).toBe('lend');
    expect(parsed.personName).toBe('Hashim');
    expect(parsed.amount).toBe(rs(300));
  });

  it('reads "lent X" for a new person too', () => {
    const { parsed } = parse('lent ali 500');
    expect(parsed.kind).toBe('lend');
    expect(parsed.personName).toBe('Ali');
    expect(parsed.toAccountId).toBeNull();
  });

  it('does not invent a person when the name is already an account', () => {
    const { parsed, a } = parse('gave sara 500');
    expect(parsed.personName).toBeNull();
    expect(parsed.toAccountId).toBe(a.sara.id);
  });

  it('still leaves nothing silently behind', () => {
    const { parsed } = parse('spent 500 on groceries and other random stuff');
    expect(parsed.categoryId).not.toBeNull();
    // "other random stuff" is neither a brand nor a merchant guess of ≤3 words
    // that survives the stopword test — it comes back as notes.
    expect(parsed.notes ?? parsed.leftover).toMatch(/random/);
  });
});

describe('robustness', () => {
  it('never throws on odd input', () => {
    for (const text of ['', '   ', '!!!', '0', '-', 'spent', '#', '999999999999999999999']) {
      expect(() => parseNaturalLanguage(text, { accounts: [], asOf: ASOF })).not.toThrow();
    }
  });

  it('handles an empty ledger with no accounts', () => {
    const parsed = parseNaturalLanguage('spent 500 on food', { accounts: [], asOf: ASOF });
    expect(parsed.accountId).toBeNull();
    expect(parsed.categoryId).toBeNull();
    expect(parsed.amount).toBe(rs(500));
  });
});
