/**
 * Natural-language transaction entry.
 *
 * Deliberately a deterministic local parser rather than a model call: it works
 * offline, costs nothing, needs no API key, and — most importantly — is
 * predictable. A finance app that sometimes guesses differently for the same
 * sentence is worse than one that guesses simply and always the same way.
 *
 * The parser NEVER writes anything. It returns a proposal with a confidence
 * note per field, which the UI must show for confirmation before saving
 * (business rule R11). An LLM could be slotted in behind this same interface.
 *
 * What it is tuned for is how people actually type into a phone, not the tidy
 * sentence on the placeholder. Real entries look like "optp 850", "careem 350
 * uni", "2 chai 120", "lent ali 500", "rent 25000 on the 1st". So:
 *
 *   - no verb is needed; the default is an expense
 *   - a merchant is recognised anywhere in the sentence, not only after "at"
 *   - the merchants this person has typed before are matched first, and the
 *     category they usually file that merchant under is proposed with it
 *   - Karachi brands and everyday words map to categories
 *   - a quantity ("2 chai") is not mistaken for the amount
 *   - a person the ledger knows turns "gave X 500" into a loan, not a spend
 *   - what is left over is offered as the merchant, marked as a guess, so the
 *     second time it is typed it is a known merchant
 */

import { parseAmount } from './money';
import {
  addDays,
  addMonths,
  dayOfWeek,
  isValidDate,
  today,
  toDayNumber,
  fromDayNumber,
  type CalendarDate,
} from './dates';
import type { Account, ID } from './types';

export type ParsedField = 'amount' | 'date' | 'merchant' | 'category' | 'account' | 'kind' | 'tags';

export type ParsedKind =
  | 'expense'
  | 'income'
  | 'transfer'
  | 'refund'
  | 'lend'
  | 'borrow'
  | 'repay_in'
  | 'repay_out';

export interface ParsedTransaction {
  amount: number | null;
  date: CalendarDate;
  merchant: string | null;
  categoryId: ID | null;
  /** The account money leaves (expense, transfer, lend) or arrives in (income). */
  accountId: ID | null;
  /** The other side of a transfer or a debt: the destination, or the person. */
  toAccountId: ID | null;
  kind: ParsedKind;
  /**
   * A person named in a debt sentence whom the ledger does not know yet —
   * "I owe hashim 240" before Hashim exists. The UI offers to add them.
   */
  personName: string | null;
  tags: string[];
  notes: string | null;
  /** Which fields the parser actually found, versus defaulted or guessed. */
  found: Set<ParsedField>;
  /** Words the parser could not account for; shown so nothing is silently lost. */
  leftover: string;
}

export interface ParseContext {
  accounts: readonly Account[];
  asOf?: CalendarDate;
  /** Merchants this person has typed before, most frequent first. */
  merchants?: readonly string[];
  /** Merchant (lower-cased) → the category it is usually filed under. */
  merchantMemory?: ReadonlyMap<string, ID>;
}

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

const INCOME_VERBS =
  /\b(received|recieved|got paid|earned|salary|paid me|sent me|gave me|income|credited|cashback|bonus|stipend|pocket money|allowance|eidi|reimbursed|sold)\b/i;
const REFUND_WORDS = /\b(refund(?:ed)?|money back|returned (?:it|them|the)|reversal)\b/i;
const TRANSFER_VERBS = /\b(transferred|transfer|moved|withdrew|withdrawn|withdrawal|deposited|deposit|topped up|top up|sent to my)\b/i;
const EXPENSE_VERBS = /\b(spent|paid|bought|purchased|cost|charged|for|ordered|booked|got)\b/i;

const LEND_VERBS = /\b(lent|loaned|gave|paid for|covered for|advanced)\b/i;
const BORROW_VERBS = /\b(borrowed|took (?:a loan )?from|owe|owes|owed)\b/i;
const REPAY_IN = /\b(paid me back|returned my|gave back|repaid me|settled up|paid back)\b/i;
const REPAY_OUT = /\b(paid (?:\w+ )?back|returned|repaid|settled)\b/i;

const WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3, thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5, saturday: 6, sat: 6,
};

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
};

/**
 * Words that mean a category without naming it.
 *
 * Each rule lists candidate category names from most to least specific, so the
 * parser still lands somewhere sensible when a person has renamed, archived, or
 * never had the precise subcategory — "dinner" finds Dining out if it exists,
 * otherwise Food & Drink, otherwise Food.
 */
const KEYWORD_RULES: Array<{ names: string[]; words: string[] }> = [
  {
    names: ['Dining out', 'Food & Drink', 'Food'],
    words: [
      'dinner', 'lunch', 'breakfast', 'restaurant', 'brunch', 'meal', 'biryani', 'karahi', 'nihari',
      'haleem', 'bbq', 'tikka', 'burger', 'pizza', 'shawarma', 'zinger', 'broast', 'paratha', 'dhaba',
      'canteen', 'cafeteria', 'iftar', 'sehri', 'takeaway', 'take away', 'delivery', 'foodpanda', 'food panda',
      'cheetay', 'kfc', 'mcdonalds', "mcdonald's", 'mcd', 'optp', 'hardees', "hardee's", 'pizza hut', 'dominos',
      "domino's", 'subway', 'kababjees', 'bbq tonight', 'student biryani', 'javed nihari', 'burger lab',
      'burger o clock', 'ginsoy', 'kolachi', 'do darya', 'sajjad', 'bundu khan',
    ],
  },
  {
    names: ['Coffee & snacks', 'Food & Drink', 'Food'],
    words: [
      'coffee', 'tea', 'chai', 'chaye', 'snack', 'snacks', 'cafe', 'samosa', 'samosas', 'pakora', 'juice',
      'lassi', 'ice cream', 'icecream', 'dessert', 'biscuits', 'chips', 'cold drink', 'cold drinks', 'soft drink',
      'soft drinks', 'drink', 'drinks', 'soda', 'pepsi', 'coke', '7up', 'sprite', 'fanta', 'mountain dew', 'water bottle',
      'espresso', 'gloria jeans', 'tim hortons', 'dunkin', 'chai wala', 'chaye khana', 'quetta cafe',
      'chai shai', 'dolce',
    ],
  },
  {
    names: ['Groceries', 'Food & Drink', 'Food'],
    words: [
      'groceries', 'grocery', 'supermarket', 'vegetables', 'sabzi', 'kirana', 'milk', 'doodh', 'eggs', 'anday',
      'bread', 'atta', 'flour', 'rice', 'chawal', 'chicken', 'meat', 'gosht', 'fruit', 'fruits', 'ration',
      'imtiaz', 'carrefour', 'naheed', 'chase up', 'chaseup', 'hyperstar', 'metro cash', 'al-fatah', 'al fatah',
      'springs', 'krave mart', 'kravemart', 'pandamart', 'bin hashim', 'agha', 'general store',
    ],
  },
  { names: ['Fuel', 'Transport'], words: ['petrol', 'fuel', 'diesel', 'cng', 'pso', 'shell', 'total parco', 'attock', 'hascol', 'gas station', 'pump'] },
  {
    names: ['Ride-hailing', 'Transport'],
    words: ['uber', 'careem', 'indrive', 'in drive', 'yango', 'bykea', 'taxi', 'rickshaw', 'riksha', 'ricksha', 'ride', 'cab'],
  },
  { names: ['Public transport', 'Transport'], words: ['bus', 'metro bus', 'train', 'van fare', 'fare', 'green line', 'orange line', 'people bus', 'chingchi', 'qingqi'] },
  { names: ['Parking', 'Transport'], words: ['parking', 'toll', 'toll tax', 'm-tag', 'mtag'] },
  { names: ['Maintenance', 'Transport'], words: ['mechanic', 'oil change', 'car wash', 'tyre', 'tyres', 'tire', 'puncture', 'service station', 'car service', 'bike service', 'workshop'] },
  { names: ['Rent', 'Housing'], words: ['rent', 'kiraya', 'hostel fee', 'hostel'] },
  {
    names: ['Utilities', 'Housing'],
    words: [
      'electricity', 'electric bill', 'bijli', 'k-electric', 'kelectric', 'k electric', 'kesc', 'ke bill', 'gas bill',
      'ssgc', 'sui gas', 'sngpl', 'water bill', 'kwsb', 'tanker', 'water tanker', 'utility', 'utilities',
      'mobile load', 'easyload', 'easy load', 'jazz load', 'zong load', 'telenor load', 'ufone load', 'balance load',
      'top-up', 'topup', 'data package', 'data bundle', 'phone bill', 'mobile bill', 'jazz', 'zong', 'telenor', 'ufone',
    ],
  },
  {
    names: ['Internet', 'Housing'],
    words: ['internet', 'wifi', 'wi-fi', 'broadband', 'fiber', 'fibre', 'ptcl', 'stormfiber', 'storm fiber', 'nayatel', 'cybernet', 'transworld', 'wateen', 'connect'],
  },
  { names: ['Maintenance', 'Housing'], words: ['repair', 'plumber', 'electrician', 'maintenance', 'carpenter', 'painter', 'ac service', 'ac repair'] },
  {
    names: ['Doctor', 'Health'],
    words: ['doctor', 'dr', 'clinic', 'hospital', 'consultation', 'checkup', 'check-up', 'dentist', 'lab test', 'blood test', 'x-ray', 'xray', 'ultrasound', 'aga khan', 'aku', 'liaquat national', 'shifa', 'chughtai', 'essa lab', 'dow'],
  },
  {
    names: ['Pharmacy', 'Health'],
    words: ['medicine', 'medicines', 'dawai', 'pharmacy', 'chemist', 'tablets', 'panadol', 'syrup', 'dvago', 'd.watson', 'd watson', 'servaid', 'medical store'],
  },
  { names: ['Fitness', 'Health'], words: ['gym', 'fitness', 'yoga', 'protein', 'whey'] },
  {
    names: ['Subscriptions', 'Entertainment'],
    words: ['netflix', 'spotify', 'subscription', 'youtube premium', 'youtube', 'icloud', 'google one', 'chatgpt', 'openai', 'apple music', 'prime video', 'tapmad', 'disney', 'hbo', 'crunchyroll', 'game pass', 'ps plus'],
  },
  { names: ['Events', 'Entertainment'], words: ['cinema', 'movie', 'movies', 'concert', 'match ticket', 'cinepax', 'nueplex', 'atrium', 'tickets', 'ticket', 'bowling', 'arcade', 'gaming zone', 'snooker'] },
  { names: ['Games', 'Entertainment'], words: ['game', 'games', 'steam', 'ps5', 'playstation', 'xbox', 'pubg', 'uc', 'in-app', 'in app'] },
  {
    names: ['Clothing', 'Shopping'],
    words: [
      'clothes', 'shirt', 'shoes', 'clothing', 'jacket', 'jeans', 'kurta', 'shalwar', 'kameez', 'suit', 'dupatta',
      'khaadi', 'gul ahmed', 'outfitters', 'sapphire', 'junaid jamshed', 'j.', 'bonanza', 'limelight', 'ethnic',
      'nishat', 'alkaram', 'bata', 'servis', 'ndure', 'sneakers', 'sandals', 'chappal', 'tailor', 'darzi',
    ],
  },
  {
    names: ['Electronics', 'Shopping'],
    words: ['laptop', 'charger', 'headphones', 'earphones', 'earbuds', 'airpods', 'mobile', 'phone', 'phone case', 'cable', 'power bank', 'powerbank', 'mouse', 'keyboard', 'ssd', 'usb', 'techno city', 'star city'],
  },
  { names: ['Household', 'Shopping'], words: ['detergent', 'household', 'cleaning', 'surf', 'soap', 'shampoo', 'toothpaste', 'tissue', 'tissues', 'bulb', 'battery', 'batteries', 'kitchen'] },
  { names: ['Shopping'], words: ['daraz', 'amazon', 'aliexpress', 'temu', 'mall', 'dolmen', 'lucky one', 'lucky 1', 'ocean mall', 'zamzama', 'tariq road', 'saddar', 'bazaar', 'market'] },
  {
    names: ['Tuition', 'Education'],
    words: ['tuition', 'semester', 'semester fee', 'university fee', 'uni fee', 'school fee', 'fee', 'fees', 'admission', 'exam fee', 'challan', 'academy', 'coaching'],
  },
  { names: ['Books', 'Education'], words: ['book', 'books', 'stationery', 'stationary', 'notebook', 'register', 'photocopy', 'photocopies', 'printout', 'printouts', 'print', 'prints', 'library', 'urdu bazaar', 'liberty books'] },
  { names: ['Courses', 'Education'], words: ['course', 'udemy', 'coursera', 'certification', 'workshop fee'] },
  { names: ['Flights', 'Travel'], words: ['flight', 'flights', 'airline', 'pia', 'airblue', 'serene', 'air sial', 'ticket to'] },
  { names: ['Stays', 'Travel'], words: ['hotel', 'airbnb', 'guest house', 'guesthouse', 'resort', 'motel'] },
  { names: ['Travel'], words: ['trip', 'daewoo', 'faisal movers', 'travel', 'visa fee', 'passport'] },
  { names: ['Gifts', 'Personal'], words: ['gift', 'present', 'eid gift', 'birthday gift', 'wedding gift', 'salami', 'flowers', 'bouquet'] },
  { names: ['Grooming', 'Personal'], words: ['haircut', 'salon', 'barber', 'parlour', 'parlor', 'shave', 'facial', 'nai'] },
  { names: ['Charity', 'Personal'], words: ['zakat', 'sadqa', 'sadaqah', 'charity', 'donation', 'donated', 'masjid', 'mosque', 'edhi', 'saylani', 'chhipa', 'fitrana', 'qurbani'] },
  { names: ['Family'], words: ['ammi', 'abbu', 'mom', 'dad', 'mother', 'father', 'family', 'sister', 'brother', 'bhai', 'baji', 'nani', 'dadi'] },
  { names: ['Bank fees', 'Fees & Charges'], words: ['bank fee', 'bank charges', 'service charge', 'service charges', 'atm fee', 'atm charges', 'annual fee', 'card fee', 'sms charges', 'fbr', 'withholding'] },
  { names: ['Taxes', 'Fees & Charges'], words: ['tax', 'taxes', 'token tax', 'excise', 'fine', 'challan fine', 'penalty', 'late fee'] },
  { names: ['Salary'], words: ['salary', 'payroll', 'wages', 'tankhwa', 'internship stipend', 'stipend'] },
  { names: ['Freelance'], words: ['freelance', 'client', 'upwork', 'fiverr', 'project payment', 'invoice paid', 'gig'] },
  { names: ['Business'], words: ['business', 'sales', 'sale', 'customer'] },
  { names: ['Gifts received', 'Other income'], words: ['eidi', 'pocket money', 'allowance', 'gift money', 'cash gift'] },
  { names: ['Other income'], words: ['cashback', 'bonus', 'prize', 'reward', 'sold', 'olx', 'refund'] },
];

/** Every single word or phrase above, for spotting them anywhere in a sentence. */
const KEYWORD_INDEX: Array<{ word: string; rule: (typeof KEYWORD_RULES)[number] }> = KEYWORD_RULES.flatMap((rule) =>
  rule.words.map((word) => ({ word, rule })),
).sort((a, b) => b.word.length - a.word.length);

/**
 * Words that look like a merchant but never are. Kept small on purpose — a
 * false "not a merchant" is more annoying than a false "is a merchant" that the
 * confirm step lets the person clear.
 */
const STOPWORDS = new Set([
  'the', 'a', 'an', 'my', 'me', 'i', 'we', 'it', 'them', 'him', 'her', 'his', 'our', 'this', 'that', 'these',
  'and', 'or', 'but', 'so', 'then', 'with', 'without', 'via', 'by', 'on', 'in', 'at', 'to', 'from', 'for',
  'of', 'off', 'up', 'out', 'into', 'per', 'each', 'some', 'something', 'stuff', 'things', 'thing', 'again',
  'today', 'yesterday', 'tomorrow', 'now', 'just', 'also', 'only', 'about', 'around', 'approx', 'roughly',
  'cash', 'bank', 'card', 'account', 'wallet', 'rs', 'rs.', 'pkr', 'rupees', 'rupee', 'total', 'amount',
  'spent', 'spend', 'paid', 'pay', 'bought', 'buy', 'purchased', 'got', 'received', 'earned', 'cost',
  'charged', 'ordered', 'booked', 'went', 'go', 'had', 'have', 'was', 'were', 'is', 'are', 'be', 'been',
  'did', 'do', 'done', 'made', 'make', 'gave', 'give', 'took', 'take', 'sent', 'send', 'used', 'use',
  'morning', 'evening', 'afternoon', 'night', 'tonight', 'week', 'month', 'last', 'ago', 'the', 'x',
  'uni', 'university', 'office', 'home', 'work', 'way', 'back', 'there', 'here', 'trip',
]);

/** Small integers followed by one of these are a quantity, not an amount. */
const UNIT_WORDS = /^(x|pcs?|pieces?|items?|cups?|plates?|kg|kgs|g|grams?|litres?|liters?|l|ltr|dozen|packs?|packets?|bottles?|cans?|tickets?|persons?|people|ppl|days?|nights?|hours?|hrs?|months?|weeks?|times?|rides?|trips?)$/i;

// ---------------------------------------------------------------------------
// The parser
// ---------------------------------------------------------------------------

export function parseNaturalLanguage(input: string, ctx: ParseContext): ParsedTransaction {
  const asOf = ctx.asOf ?? today();
  const found = new Set<ParsedField>();
  let rest = ` ${input.trim().replace(/\s+/g, ' ')} `;

  // --- tags: #university -------------------------------------------------
  const tags: string[] = [];
  rest = rest.replace(/#([\p{L}\p{N}_-]+)/gu, (_, tag: string) => {
    tags.push(tag);
    return ' ';
  });
  if (tags.length) found.add('tags');

  // --- date, first: "12 Sep 2026" holds numbers that are not money --------
  const dateResult = extractDate(rest, asOf);
  const date = dateResult.date;
  if (dateResult.matched) {
    found.add('date');
    rest = replaceOnce(rest, dateResult.matched);
  }

  // --- amount ------------------------------------------------------------
  const amountResult = extractAmount(rest);
  const amount = amountResult.minor;
  if (amountResult.matched) {
    found.add('amount');
    rest = replaceOnce(rest, amountResult.matched);
  }

  // --- the people and accounts this ledger knows -------------------------
  const live = ctx.accounts.filter((a) => !a.archived);
  const spendable = live.filter((a) => !['expense_category', 'income_category', 'adjustment', 'opening_balance', 'receivable', 'payable', 'goal'].includes(a.class));
  const people = live.filter((a) => a.class === 'receivable' || a.class === 'payable');
  const goals = live.filter((a) => a.class === 'goal');

  // Two named accounts with "from … to …" is a transfer, whatever the verb.
  const fromTo = extractFromTo(rest, [...spendable, ...goals, ...people]);

  // A person named in the sentence changes what kind of thing this is — but
  // only when the sentence is about money between people. A bare first name
  // is often a shop ("bilal traders"), so it needs a debt verb, a "to"/"from",
  // or an "owes" beside it before it counts as a person.
  const namedPerson = findNamed(rest, people);
  const debtContext =
    LEND_VERBS.test(rest) || BORROW_VERBS.test(rest) || REPAY_IN.test(rest) || REPAY_OUT.test(rest) ||
    (namedPerson != null &&
      new RegExp(`\\b(?:to|from|for)\\s+${escapeRegExp(namedPerson.name)}\\b|\\b${escapeRegExp(namedPerson.name)}\\s+(?:owes|paid|returned|gave|sent)\\b`, 'i').test(rest));
  const person = fromTo.to && people.some((p) => p.id === fromTo.to)
    ? people.find((p) => p.id === fromTo.to)!
    : fromTo.from && people.some((p) => p.id === fromTo.from)
      ? people.find((p) => p.id === fromTo.from)!
      : debtContext
        ? namedPerson
        : null;

  // --- kind --------------------------------------------------------------
  let kind: ParsedKind = 'expense';
  let accountId: ID | null = null;
  let toAccountId: ID | null = null;
  let personName: string | null = null;

  // A debt sentence about somebody the ledger has not met — "I owe hashim
  // 240". The name is taken from beside the verb and offered as a new person,
  // because recording money owed as an expense is the one mistake this app
  // must not make quietly.
  if (!person && debtContext) {
    const stranger = findStranger(rest, [...live.map((a) => a.name)]);
    if (stranger) {
      personName = stranger.name;
      const theyOwe = new RegExp(`\\b${escapeRegExp(stranger.name)}\\s+(?:owes|owed)\\b`, 'i').test(rest);
      const theyPaid = new RegExp(`\\b${escapeRegExp(stranger.name)}\\s+(?:paid me|returned|gave back|repaid)\\b`, 'i').test(rest);
      // "hashim owes me" is checked before the borrow verbs, or the "owes" in
      // it would read as me owing him.
      if (theyOwe) {
        kind = 'lend';
      } else if (theyPaid) {
        kind = 'repay_in';
      } else if (/\b(?:i|we)\s+owe\b/i.test(rest) || BORROW_VERBS.test(rest) || new RegExp(`\\bfrom\\s+${escapeRegExp(stranger.name)}\\b`, 'i').test(rest)) {
        kind = 'borrow';
      } else if (REPAY_OUT.test(rest)) {
        kind = 'repay_out';
      } else {
        kind = 'lend';
      }
      found.add('kind');
      rest = replaceOnce(rest, stranger.matched);
    }
  }

  if (person) {
    // "ali paid me back 500" / "paid ali back 500" / "lent ali 500" / "borrowed 2000 from sara"
    if (REPAY_IN.test(rest) || new RegExp(`\\b${escapeRegExp(person.name)}\\b[^.]*\\b(returned|paid back|repaid|gave back)\\b`, 'i').test(rest)) {
      kind = 'repay_in';
    } else if (REPAY_OUT.test(rest) && !REPAY_IN.test(rest)) {
      kind = 'repay_out';
    } else if (BORROW_VERBS.test(rest) || new RegExp(`\\bfrom\\s+${escapeRegExp(person.name)}\\b`, 'i').test(rest)) {
      kind = 'borrow';
    } else if (LEND_VERBS.test(rest) || new RegExp(`\\b(?:to|for)\\s+${escapeRegExp(person.name)}\\b`, 'i').test(rest) || new RegExp(`\\b${escapeRegExp(person.name)}\\s+owes\\b`, 'i').test(rest)) {
      kind = 'lend';
    } else if (INCOME_VERBS.test(rest)) {
      kind = 'repay_in';
    } else {
      kind = 'lend';
    }
    found.add('kind');
    rest = replaceOnce(rest, new RegExp(`\\b${escapeRegExp(person.name)}\\b`, 'i'));
  } else if (fromTo.from && fromTo.to) {
    kind = 'transfer';
    found.add('kind');
  } else if (TRANSFER_VERBS.test(rest)) {
    kind = 'transfer';
    found.add('kind');
  } else if (REFUND_WORDS.test(rest)) {
    kind = 'refund';
    found.add('kind');
  } else if (INCOME_VERBS.test(rest) || /\b(?:got|received)\b[^.]{0,40}\bfrom\b/i.test(rest)) {
    // "got 5000 from client" is money arriving; a bare "got" ("got a coffee")
    // is a spend, which is why it is not in the income verbs on its own.
    kind = 'income';
    found.add('kind');
  } else if (EXPENSE_VERBS.test(rest)) {
    found.add('kind');
  }

  // --- accounts ----------------------------------------------------------
  if (fromTo.from || fromTo.to) {
    accountId = fromTo.from;
    toAccountId = fromTo.to;
    if (fromTo.fromText) rest = replaceOnce(rest, fromTo.fromText);
    if (fromTo.toText) rest = replaceOnce(rest, fromTo.toText);
    if (accountId || toAccountId) found.add('account');
  }

  // Any remaining named spendable account. Longest names first so "Meezan
  // Bank" beats a bare "Bank".
  if (!accountId) {
    const named = findNamed(rest, spendable);
    if (named) {
      accountId = named.id;
      found.add('account');
      rest = replaceOnce(rest, new RegExp(`\\b${escapeRegExp(named.name)}\\b`, 'i'));
    }
  }

  // "on my card" / "in cash" / "from bank" shorthands.
  if (!accountId) {
    let shorthand: Account | undefined;
    if (/\b(credit card|card|visa|mastercard)\b/i.test(rest)) shorthand = spendable.find((a) => a.class === 'credit_card');
    else if (/\bcash\b/i.test(rest)) shorthand = spendable.find((a) => a.class === 'cash');
    else if (/\b(bank|debit)\b/i.test(rest)) shorthand = spendable.find((a) => a.class === 'bank');
    else if (/\b(easypaisa|jazzcash|sadapay|nayapay|wallet)\b/i.test(rest)) shorthand = spendable.find((a) => a.class === 'ewallet');
    if (shorthand) {
      accountId = shorthand.id;
      found.add('account');
      rest = rest.replace(/\b(credit card|card|visa|mastercard|cash|bank|debit|easypaisa|jazzcash|sadapay|nayapay|wallet)\b/i, ' ');
    }
  }

  // People and debts: the person is one side, an account of mine the other.
  // "from"/"to" may already have put the person on a side; this only settles
  // which side, and never leaves the person on both.
  //
  // A person has two accounts with the same name — what they owe me and what
  // I owe them — and the direction decides which one this touches.
  if (person) {
    const wantedClass = kind === 'lend' || kind === 'repay_in' ? 'receivable' : 'payable';
    const side =
      people.find((p) => p.class === wantedClass && (p.personId ? p.personId === person.personId : p.name === person.name)) ?? person;
    const mine = [accountId, toAccountId].find((id) => id && id !== person.id && id !== side.id) ?? null;
    if (kind === 'lend' || kind === 'repay_out') {
      accountId = mine;
      toAccountId = side.id;
    } else {
      accountId = side.id;
      toAccountId = mine;
    }
  }

  // --- merchant ----------------------------------------------------------
  // In order of how much we trust it: a merchant this person has typed before,
  // a brand we know, the "at X" rule, and finally whatever is left over.
  let merchant: string | null = null;
  let merchantConfident = false;

  const known = findKnownMerchant(rest, ctx.merchants ?? []);
  if (known) {
    merchant = known.name;
    merchantConfident = true;
    rest = replaceOnce(rest, known.matched);
  }

  if (!merchant) {
    const prepositional = rest.match(
      /\b(?:at|from|to|in|@)\s+([\p{Lu}][\p{L}\p{N}&'’.-]*(?:\s+[\p{Lu}\p{N}][\p{L}\p{N}&'’.-]*){0,3}|[\p{Ll}\p{N}][\p{L}\p{N}&'’.-]*(?:\s+[\p{Ll}\p{N}][\p{L}\p{N}&'’.-]*){0,2})/u,
    );
    if (prepositional) {
      const words = prepositional[1].trim().replace(/[.,]$/, '').split(/\s+/);
      // Stop at the first stopword or keyword, so "to dolmen mall spent" is "dolmen mall".
      const kept: string[] = [];
      for (const w of words) {
        const lw = w.toLowerCase();
        if (STOPWORDS.has(lw) || WEEKDAYS[lw] !== undefined || /^\d/.test(lw)) break;
        kept.push(w);
      }
      const candidate = kept.join(' ');
      if (candidate && !isNoiseWord(candidate)) {
        merchant = titleCaseIfShouty(candidate);
        merchantConfident = true;
        rest = replaceOnce(rest, new RegExp(`\\b(?:at|from|to|in|@)\\s+${escapeRegExp(candidate)}`, 'iu'));
      }
    }
  }

  // --- category ----------------------------------------------------------
  const wantedClass = kind === 'income' || kind === 'repay_in' ? 'income_category' : 'expense_category';
  const categories = live.filter((a) => a.class === wantedClass);
  let categoryId: ID | null = null;
  let categoryText: string | RegExp | null = null;

  // 1. Named outright.
  const namedCategory = findNamed(rest, categories);
  if (namedCategory) {
    categoryId = namedCategory.id;
    categoryText = new RegExp(`\\b${escapeRegExp(namedCategory.name)}\\b`, 'i');
  }

  // 2. Where this person usually files this merchant.
  if (!categoryId && merchant && ctx.merchantMemory) {
    const remembered = ctx.merchantMemory.get(merchant.toLowerCase());
    if (remembered && categories.some((c) => c.id === remembered)) categoryId = remembered;
  }

  // 3. An everyday word or a brand.
  let keywordHit: { word: string; rule: (typeof KEYWORD_RULES)[number] } | null = null;
  if (!categoryId) {
    keywordHit = findKeyword(rest);
    if (keywordHit) {
      categoryId = resolveRule(keywordHit.rule, categories);
      // A brand word that IS the merchant ("optp 850") should also become the
      // merchant, not vanish into the category.
      if (!merchant && looksLikeBrand(keywordHit.word)) {
        merchant = titleCaseIfShouty(keywordHit.word);
        merchantConfident = true;
      }
      if (categoryId) categoryText = new RegExp(`\\b${escapeRegExp(keywordHit.word)}\\b`, 'i');
    }
  }

  if (categoryId) {
    found.add('category');
    if (categoryText) rest = replaceOnce(rest, categoryText);
  }

  // --- leftover ----------------------------------------------------------
  let leftover = rest
    .replace(/\b(spent|spend|paid|pay|bought|buy|purchased|received|recieved|got|earned|gave|lent|loaned|borrowed|owe|owes|owed|transferred|transfer|moved|withdrew|deposited|ordered|booked|cost|charged|went|had|has|have|was|were|is|are|on|for|at|from|to|in|of|the|a|an|my|me|i|we|he|she|they|you|his|her|their|our|us|it|its|this|that|which|because|with|via|by|rs\.?|pkr|rupees?|today|yesterday|tomorrow|just|now|also|back|per|each|x)\b/gi, ' ')
    .replace(/[,.;:!?]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // 4. Nothing named the merchant, but a word or two is unaccounted for —
  //    offer it as the merchant, flagged as a guess. Confirmed once, it is a
  //    known merchant from then on, which is how the parser learns.
  if (!merchant && leftover) {
    const words = leftover.split(' ');
    if (words.length <= 3 && !words.some((w) => /\d/.test(w)) && !words.every((w) => STOPWORDS.has(w.toLowerCase()))) {
      merchant = titleCaseIfShouty(leftover);
      merchantConfident = false;
      leftover = '';
    }
  }

  if (merchant && merchantConfident) found.add('merchant');

  return {
    amount,
    date,
    merchant,
    categoryId,
    accountId,
    toAccountId,
    kind,
    personName,
    tags,
    notes: leftover.length > 2 ? leftover : null,
    found,
    leftover,
  };
}

// ---------------------------------------------------------------------------
// Amounts
// ---------------------------------------------------------------------------

/**
 * Pick the number that is the money.
 *
 * A sentence often holds more than one: "2 chai 120", "3 tickets 1500", "paid
 * 500 for 2 kg". Every candidate is scored — a currency marker or shorthand
 * suffix is strong evidence, a small integer followed by a unit word is
 * evidence against — and the best one wins. "2 x 350" is multiplied out.
 */
function extractAmount(text: string): { minor: number | null; matched: string | null } {
  // "2 x 350", "350 x 2", "2*350"
  const times = text.match(/\b(\d{1,3})\s*[x×*]\s*([\d,]+(?:\.\d+)?)\b|\b([\d,]+(?:\.\d+)?)\s*[x×*]\s*(\d{1,3})\b/i);
  if (times) {
    const qty = Number(times[1] ?? times[4]);
    const unit = parseAmount(times[2] ?? times[3]);
    if (unit.ok && unit.minor > 0 && qty > 0 && qty <= 999) {
      return { minor: unit.minor * qty, matched: times[0] };
    }
  }

  // The prefix must start a word: "traders 900" is not "Rs 900".
  const pattern =
    /(?:(?<![\p{L}\p{N}])(rs\.?|pkr|₨|rupees?)\s*)?(\d[\d,]*(?:\.\d+)?)\s*(k|m|lac|lakh|cr|crore)?\b\s*(rs\.?|pkr|rupees?|\/-)?/giu;

  let best: { minor: number; matched: string; score: number; index: number } | null = null;

  for (const m of text.matchAll(pattern)) {
    const [whole, prefix, digits, suffix, postfix] = m;
    const raw = digits.replace(/,/g, '');
    if (!raw || /^0+$/.test(raw)) continue;
    // A year is a date fragment, never money.
    if (/^(19|20)\d{2}$/.test(raw) && !prefix && !suffix && !postfix) continue;

    const parsed = parseAmount(`${digits}${suffix ? ' ' + suffix : ''}`);
    if (!parsed.ok || parsed.minor <= 0) continue;

    let score = 0;
    if (prefix || postfix) score += 4;
    if (suffix) score += 4;
    if (digits.includes('.')) score += 1;
    if (digits.includes(',')) score += 1;

    // A small whole number followed by a unit word ("2 chai", "3 kg") is a
    // quantity, not the price.
    const after = text.slice(m.index! + whole.length).trimStart().split(/\s+/)[0] ?? '';
    const before = text.slice(0, m.index!).trimEnd().split(/\s+/).pop() ?? '';
    const value = Number(raw);
    if (Number.isInteger(value) && value <= 12 && !suffix && !prefix && !postfix) {
      if (UNIT_WORDS.test(after) || /^[a-z]+s$/i.test(after) || /^(x|×)$/i.test(before)) score -= 5;
      else score -= 1;
    }
    // Ordinal days ("on the 5th") are dates and were already removed; anything
    // that still reads "5th" is not money.
    if (/^(st|nd|rd|th)\b/i.test(after)) continue;
    // Percentages are not money.
    if (/^%/.test(after)) continue;

    // Larger figures are likelier to be the price; tie-break towards the end.
    score += Math.min(3, Math.log10(value + 1));

    if (!best || score > best.score || (score === best.score && m.index! > best.index)) {
      best = { minor: parsed.minor, matched: whole.trim(), score, index: m.index! };
    }
  }

  return best ? { minor: best.minor, matched: best.matched } : { minor: null, matched: null };
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

function extractDate(text: string, asOf: CalendarDate): { date: CalendarDate; matched: string | null } {
  const lower = text.toLowerCase();

  if (/\bday before yesterday\b/.test(lower)) return { date: addDays(asOf, -2), matched: 'day before yesterday' };
  if (/\byesterday\b/.test(lower)) return { date: addDays(asOf, -1), matched: 'yesterday' };
  if (/\b(today|tonight|this (?:morning|afternoon|evening))\b/.test(lower)) {
    return { date: asOf, matched: lower.match(/\b(today|tonight|this (?:morning|afternoon|evening))\b/)![0] };
  }
  if (/\btomorrow\b/.test(lower)) return { date: addDays(asOf, 1), matched: 'tomorrow' };
  if (/\blast (?:night|evening)\b/.test(lower)) return { date: addDays(asOf, -1), matched: lower.match(/\blast (?:night|evening)\b/)![0] };
  if (/\blast week\b/.test(lower)) return { date: addDays(asOf, -7), matched: 'last week' };
  if (/\blast month\b/.test(lower)) return { date: addMonths(asOf, -1), matched: 'last month' };

  // "3 days ago", "2 weeks ago", "a week ago"
  const ago = lower.match(/\b(\d{1,3}|a|an|one|two|three|four|five|six)\s+(day|week|month)s?\s+ago\b/);
  if (ago) {
    const n = wordToNumber(ago[1]);
    const date =
      ago[2] === 'day' ? addDays(asOf, -n) : ago[2] === 'week' ? addDays(asOf, -n * 7) : addMonths(asOf, -n);
    return { date, matched: ago[0] };
  }

  // "last friday" / "on monday" / "friday"
  const weekday = lower.match(/\b(?:last|on|this)?\s*(sunday|sun|monday|mon|tuesday|tues|tue|wednesday|wed|thursday|thurs|thur|thu|friday|fri|saturday|sat)\b/);
  if (weekday) {
    const target = WEEKDAYS[weekday[1]];
    const current = dayOfWeek(asOf);
    let delta = target - current;
    // Always resolve to the most recent past occurrence; a bare weekday in a
    // finance note nearly always means one that already happened.
    if (delta >= 0) delta -= 7;
    return { date: fromDayNumber(toDayNumber(asOf) + delta), matched: weekday[0].trim() };
  }

  // "12 Sep", "12th September 2026", "Sep 12", "12/9", "12-09-2026"
  const dayMonth = lower.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([a-z]{3,9})\.?(?:,?\s+(\d{4}))?\b/);
  if (dayMonth && MONTHS[dayMonth[2]]) {
    const candidate = buildDate(Number(dayMonth[3] ?? asOf.slice(0, 4)), MONTHS[dayMonth[2]], Number(dayMonth[1]));
    if (candidate) return { date: candidate, matched: dayMonth[0] };
  }
  const monthDay = lower.match(/\b([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/);
  if (monthDay && MONTHS[monthDay[1]]) {
    const candidate = buildDate(Number(monthDay[3] ?? asOf.slice(0, 4)), MONTHS[monthDay[1]], Number(monthDay[2]));
    if (candidate) return { date: candidate, matched: monthDay[0] };
  }
  const numeric = lower.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (numeric) {
    const year = numeric[3] ? Number(numeric[3].length === 2 ? `20${numeric[3]}` : numeric[3]) : Number(asOf.slice(0, 4));
    // Day first, the way it is written here.
    const candidate = buildDate(year, Number(numeric[2]), Number(numeric[1]));
    if (candidate) return { date: candidate, matched: numeric[0] };
  }

  // "on the 5th", "on 1st" — this month if it has passed, else last month.
  const ordinal = lower.match(/\b(?:on\s+)?(?:the\s+)?(\d{1,2})(st|nd|rd|th)\b/);
  if (ordinal) {
    const day = Number(ordinal[1]);
    const thisMonth = buildDate(Number(asOf.slice(0, 4)), Number(asOf.slice(5, 7)), day);
    if (thisMonth && thisMonth <= asOf) return { date: thisMonth, matched: ordinal[0] };
    const previous = addMonths(asOf, -1);
    const lastMonth = buildDate(Number(previous.slice(0, 4)), Number(previous.slice(5, 7)), day);
    if (lastMonth) return { date: lastMonth, matched: ordinal[0] };
  }

  // ISO
  const iso = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (iso && isValidDate(iso[1])) return { date: iso[1], matched: iso[0] };

  return { date: asOf, matched: null };
}

function wordToNumber(w: string): number {
  const words: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
  return words[w] ?? Number(w);
}

function buildDate(y: number, m: number, d: number): CalendarDate | null {
  const candidate = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return isValidDate(candidate) ? candidate : null;
}

// ---------------------------------------------------------------------------
// Names the ledger knows
// ---------------------------------------------------------------------------

/** The longest account name present in the text, if any. */
function findNamed(text: string, accounts: readonly Account[]): Account | null {
  for (const account of [...accounts].sort((x, y) => y.name.length - x.name.length)) {
    if (account.name.length < 2) continue;
    if (new RegExp(`\\b${escapeRegExp(account.name)}\\b`, 'i').test(text)) return account;
  }
  return null;
}

/**
 * The name beside a debt verb, when it is nobody the ledger knows.
 *
 * "I owe hashim 240", "lent ali 500", "gave 500 to sara", "hashim owes me
 * 300", "borrowed 2000 from bilal". The word is taken from the slot the
 * grammar puts a person in, then rejected if it is a stopword, a number, a
 * keyword, or something the ledger already calls an account.
 */
function findStranger(text: string, knownNames: readonly string[]): { name: string; matched: RegExp } | null {
  const known = new Set(knownNames.map((n) => n.toLowerCase()));
  const word = "([\\p{L}][\\p{L}'’-]{1,24})";
  const slots = [
    // after the verb / preposition: "owe hashim", "lent ali", "to sara", "from bilal"
    new RegExp(`\\b(?:owe|owes|owed|lent|loaned|gave|paid|borrowed|to|from|for)\\s+(?:to\\s+)?${word}\\b`, 'iu'),
    // before the verb: "hashim owes me", "ali paid me back", "sara lent me"
    new RegExp(`\\b${word}\\s+(?:owes|owed|paid me|lent me|gave me|returned|repaid)\\b`, 'iu'),
  ];

  for (const re of slots) {
    const m = text.match(re);
    if (!m) continue;
    const candidate = m[1];
    const lower = candidate.toLowerCase();
    if (STOPWORDS.has(lower) || known.has(lower) || WEEKDAYS[lower] !== undefined || MONTHS[lower] !== undefined) continue;
    if (KEYWORD_INDEX.some((k) => k.word === lower)) continue;
    if (/^(back|me|my|him|her|them|us|you|it|this|that|some|money|cash|rupees?|rs)$/i.test(lower)) continue;
    return {
      name: candidate[0].toUpperCase() + candidate.slice(1),
      matched: new RegExp(`\\b${escapeRegExp(candidate)}\\b`, 'iu'),
    };
  }
  return null;
}

/** "from X to Y" where X and Y are accounts or people the ledger knows. */
function extractFromTo(
  text: string,
  accounts: readonly Account[],
): { from: ID | null; to: ID | null; fromText: RegExp | null; toText: RegExp | null } {
  let from: ID | null = null;
  let to: ID | null = null;
  let fromText: RegExp | null = null;
  let toText: RegExp | null = null;

  for (const account of [...accounts].sort((x, y) => y.name.length - x.name.length)) {
    if (account.name.length < 2) continue;
    const name = escapeRegExp(account.name);
    if (!from) {
      const f = new RegExp(`\\bfrom\\s+(?:my\\s+)?${name}\\b`, 'i');
      if (f.test(text)) {
        from = account.id;
        fromText = f;
        continue;
      }
    }
    if (!to) {
      const t = new RegExp(`\\b(?:to|into)\\s+(?:my\\s+)?${name}\\b`, 'i');
      if (t.test(text)) {
        to = account.id;
        toText = t;
      }
    }
  }
  return { from, to, fromText, toText };
}

/** A merchant this person has typed before, longest match first. */
function findKnownMerchant(text: string, merchants: readonly string[]): { name: string; matched: RegExp } | null {
  const sorted = [...merchants].filter((m) => m.trim().length >= 2).sort((a, b) => b.length - a.length);
  for (const name of sorted) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(name.trim())}(?![\\p{L}\\p{N}])`, 'iu');
    if (re.test(text)) return { name: name.trim(), matched: re };
  }
  return null;
}

function findKeyword(text: string): { word: string; rule: (typeof KEYWORD_RULES)[number] } | null {
  const lower = text.toLowerCase();
  for (const entry of KEYWORD_INDEX) {
    if (new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(entry.word)}(?![\\p{L}\\p{N}])`, 'iu').test(lower)) return entry;
  }
  return null;
}

function resolveRule(rule: (typeof KEYWORD_RULES)[number], categories: readonly Account[]): ID | null {
  for (const name of rule.names) {
    const match = categories.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (match) return match.id;
  }
  // Fall back to the parent, if the ledger nests categories that way.
  for (const name of rule.names) {
    const match = categories.find((c) => c.name.toLowerCase().includes(name.toLowerCase()));
    if (match) return match.id;
  }
  return null;
}

/** Brand names, as opposed to generic words like "dinner". */
const GENERIC_WORDS = new Set(
  KEYWORD_RULES.flatMap((r) => r.words).filter((w) =>
    /^(dinner|lunch|breakfast|restaurant|brunch|meal|biryani|karahi|nihari|haleem|bbq|tikka|burger|pizza|shawarma|zinger|broast|paratha|dhaba|canteen|cafeteria|iftar|sehri|takeaway|take away|delivery|coffee|tea|chai|chaye|snacks?|cafe|samosas?|pakora|juice|lassi|ice ?cream|dessert|biscuits|chips|cold drink|groceries|grocery|supermarket|vegetables|sabzi|kirana|milk|doodh|eggs|anday|bread|atta|flour|rice|chawal|chicken|meat|gosht|fruits?|ration|general store|petrol|fuel|diesel|cng|gas station|pump|taxi|rickshaw|riksha|ricksha|ride|cab|bus|train|van fare|fare|chingchi|qingqi|parking|toll|toll tax|mechanic|oil change|car wash|tyres?|tire|puncture|service station|car service|bike service|workshop|rent|kiraya|hostel fee|hostel|electricity|electric bill|bijli|gas bill|water bill|tanker|water tanker|utility|utilities|mobile load|easyload|easy load|balance load|top-up|topup|data package|data bundle|phone bill|mobile bill|internet|wifi|wi-fi|broadband|fiber|fibre|repair|plumber|electrician|maintenance|carpenter|painter|ac service|ac repair|doctor|dr|clinic|hospital|consultation|checkup|check-up|dentist|lab test|blood test|x-ray|xray|ultrasound|medicines?|dawai|pharmacy|chemist|tablets|syrup|medical store|gym|fitness|yoga|protein|whey|subscription|cinema|movies?|concert|match ticket|tickets?|bowling|arcade|gaming zone|snooker|games?|in-app|in app|clothes|shirt|shoes|clothing|jacket|jeans|kurta|shalwar|kameez|suit|dupatta|sneakers|sandals|chappal|tailor|darzi|laptop|charger|headphones|earphones|earbuds|mobile|phone|phone case|cable|power ?bank|mouse|keyboard|ssd|usb|detergent|household|cleaning|surf|soap|shampoo|toothpaste|tissues?|bulb|batter(?:y|ies)|kitchen|mall|bazaar|market|tuition|semester|semester fee|university fee|uni fee|school fee|fees?|admission|exam fee|challan|academy|coaching|books?|stationery|stationary|notebook|register|photocop(?:y|ies)|printouts?|prints?|library|course|certification|workshop fee|flights?|airline|ticket to|hotel|guest ?house|resort|motel|trip|travel|visa fee|passport|gift|present|eid gift|birthday gift|wedding gift|salami|flowers|bouquet|haircut|salon|barber|parlou?r|shave|facial|nai|zakat|sadqa|sadaqah|charity|donation|donated|masjid|mosque|fitrana|qurbani|ammi|abbu|mom|dad|mother|father|family|sister|brother|bhai|baji|nani|dadi|bank fee|bank charges|service charges?|atm fee|atm charges|annual fee|card fee|sms charges|withholding|tax(?:es)?|token tax|excise|fine|challan fine|penalty|late fee|salary|payroll|wages|tankhwa|internship stipend|stipend|freelance|client|project payment|invoice paid|gig|business|sales?|customer|eidi|pocket money|allowance|gift money|cash gift|cashback|bonus|prize|reward|sold|refund|uc|connect|dolce|agha|dow|ke bill|ethnic|springs)$/i.test(w),
  ),
);

function looksLikeBrand(word: string): boolean {
  return !GENERIC_WORDS.has(word);
}

// ---------------------------------------------------------------------------

function isNoiseWord(candidate: string): boolean {
  return STOPWORDS.has(candidate.trim().toLowerCase());
}

/** Names people type in lower case that are properly written in capitals. */
const ACRONYMS = new Set([
  'optp', 'kfc', 'mcd', 'pso', 'cng', 'ptcl', 'ssgc', 'kesc', 'ke', 'aku', 'pia', 'hbl', 'ubl', 'mcb',
  'nbp', 'jazzcash', 'olx', 'bbq', 'ac', 'atm', 'fbr', 'ned', 'iba', 'lums', 'fast', 'uc',
]);

function titleCaseIfShouty(text: string): string {
  // Preserve deliberate capitalisation like "OPTP" or "KFC"; tidy "optp shop".
  if (/^[A-Z0-9&.'-]+$/.test(text)) return text;
  return text
    .split(/\s+/)
    .map((w) => {
      const lower = w.toLowerCase();
      if (ACRONYMS.has(lower)) return lower === 'jazzcash' ? 'JazzCash' : lower.toUpperCase();
      return w.length > 1 && w === lower ? w[0].toUpperCase() + w.slice(1) : w;
    })
    .join(' ');
}

/** Replace the first occurrence of a string or pattern with a space. */
function replaceOnce(text: string, what: string | RegExp): string {
  return typeof what === 'string' ? text.replace(what, ' ') : text.replace(what, ' ');
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A short human summary of what the parser understood, for the confirm step. */
export function describeParse(parsed: ParsedTransaction): string[] {
  const notes: string[] = [];
  if (!parsed.found.has('amount')) notes.push('No amount found — enter it below.');
  if (!parsed.found.has('category') && parsed.kind !== 'transfer') notes.push('Category not recognised — pick one.');
  if (parsed.merchant && !parsed.found.has('merchant')) notes.push(`Taking "${parsed.merchant}" as the merchant — clear it if not.`);
  if (!parsed.found.has('date')) notes.push('Dated today.');
  if (!parsed.found.has('account')) notes.push('Using your usual account.');
  return notes;
}
