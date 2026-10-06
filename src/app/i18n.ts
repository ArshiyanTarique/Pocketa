/**
 * Minimal bilingual dictionary — English and Urdu.
 *
 * Keys are English strings used throughout the UI. A component calls t('key')
 * and gets back the string in the currently active language. If a key is
 * missing from the Urdu set the English fallback is returned so nothing breaks
 * during rollout.
 *
 * Usage:
 *   import { useT } from '../app/i18n';
 *   const t = useT();
 *   <h1>{t('Dashboard')}</h1>
 */

import * as React from 'react';
import { useStore } from '../store/useStore';
import { UR_SCREENS } from './i18n.ur';

export type Lang = 'en' | 'ur';

const UR: Record<string, string> = {
  // Navigation
  'Home': 'ہوم',
  'Activity': 'ریکارڈ',
  'Carpool': 'کارپول',
  'Plan': 'پلان',
  'More': 'مزید',
  'People': 'لوگ',
  'Reports': 'رپورٹس',
  'Net worth': 'کل پونجی',
  'Show amounts': 'رقم دکھائیں',
  'Sign in': 'سائن ان',
  'Offline': 'آف لائن',
  'What you can spend and what needs attention': 'کتنا خرچ کر سکتے ہیں اور کس پر دھیان دینا ہے',
  'Everything you have recorded': 'جو کچھ آپ نے لکھا ہے',
  'Log trips and see who owes what': 'سفر لکھیں اور دیکھیں کس نے کتنے دینے ہیں',
  'What you pay regularly': 'جو آپ ہر مہینے دیتے ہیں',
  'Limits you set on spending': 'خرچ کی حد جو آپ نے رکھی',
  'What you are saving for': 'آپ کس چیز کے لیے پیسے جوڑ رہے ہیں',
  'Your banks, cash and cards': 'آپ کے بینک، کیش اور کارڈ',
  'Who owes you and who you owe': 'کس نے آپ کو دینے ہیں اور آپ نے کسے',
  'Where your money went': 'پیسہ کہاں گیا',
  'Account, appearance, currency and data': 'اکاؤنٹ، ڈسپلے، کرنسی اور ڈیٹا',
  'Bills, budgets and goals': 'بل، بجٹ اور بچت',
  'Everything else': 'باقی سب',
  'Accounts': 'اکاؤنٹس',
  'Budgets': 'بجٹ',
  'Bills': 'بل',
  'Debts': 'ادھار',
  'Goals': 'بچت کے ٹارگٹ',
  'Analytics': 'رپورٹس',
  'Settings': 'سیٹنگز',
  'Join': 'شامل ہوں',
  'Pocketa': 'پاکٹہ',

  // QuickAdd
  'Add transaction': 'خرچ یا آمدنی لکھیں',
  'Edit transaction': 'ریکارڈ بدلیں',
  'Expense': 'خرچ',
  'Income': 'آمدنی',
  'Transfer': 'ٹرانسفر',
  'Lent': 'ادھار دیا',
  'Borrowed': 'ادھار لیا',
  'Form': 'فارم',
  'Quick type': 'جلدی لکھیں',
  'More options': 'مزید آپشن',
  'Notes, receipt, budget, split': 'نوٹ، رسید، بجٹ، تقسیم',
  'Say what happened': 'بتائیں کیا ہوا',
  'Which expense is this refunding?': 'یہ کس خرچ کی واپسی ہے؟',
  'Choose a person': 'کوئی بندہ چنیں',
  'Choose an account': 'اکاؤنٹ چنیں',
  'From my account': 'میرے اکاؤنٹ سے',
  'To whom': 'کس کو',
  'From whom': 'کس سے',
  'Into my account': 'میرے اکاؤنٹ میں',
  'Amount received in': 'پیسے آئے اس میں',
  'Earned': 'آیا',
  'Saved': 'بچا',
  'Overspent': 'زیادہ گیا',
  'Transfers': 'ٹرانسفر',
  'Safe to spend': 'خرچ کر سکتے ہیں',
  'How is this worked out?': 'یہ کیسے بنا؟',
  'Net': 'فرق',
  'entry': 'ریکارڈ',
  'entries': 'ریکارڈ',
  'Add an account': 'اکاؤنٹ ڈالیں',
  'Open Bills': 'بل دیکھیں',
  'Open Budgets': 'بجٹ دیکھیں',
  'Open People': 'لوگ دیکھیں',
  'Open Carpool': 'کارپول دیکھیں',
  'Refund': 'واپسی',
  'Amount': 'رقم',
  'Category': 'کیٹیگری',
  'Budget': 'بجٹ',
  'Paid from': 'کہاں سے دیے',
  'Into': 'میں',
  'Date': 'تاریخ',
  'Title': 'نام',
  'Merchant': 'دکان',
  'Notes': 'نوٹ',
  'Tags': 'ٹیگ',
  'Receipt': 'رسید',
  'Save': 'سیو کریں',
  'Save & add': 'سیو کریں اور ایک اور',
  'Save changes': 'سیو کریں',
  'Cancel': 'رہنے دیں',
  'From': 'سے',
  'To': 'تک',
  'Quick': 'فوری',
  'Type a sentence': 'ایک جملہ لکھیں',
  'Search categories': 'کیٹیگری ڈھونڈیں',
  'No category matches': 'ایسی کوئی کیٹیگری نہیں',
  'Optional': 'ضروری نہیں',
  'Date, merchant, notes and tags': 'تاریخ، دکان، نوٹ اور ٹیگ',
  'Split across categories': 'کئی کیٹیگریوں میں بانٹیں',
  'Remove split': 'تقسیم ہٹائیں',
  'Share with someone': 'کسی کے ساتھ بانٹیں',
  'Remove shares': 'بانٹنا ہٹائیں',
  'Fill in the amount, account and category first.': 'پہلے رقم، اکاؤنٹ اور کیٹیگری بھریں۔',
  'This cannot be saved yet': 'ابھی سیو نہیں ہو سکتا',
  'What budget does this belong to?': 'یہ کس بجٹ میں جائے گا؟',
  'No budget': 'کوئی بجٹ نہیں',

  // Dashboard
  'Left to spend': 'خرچ کے لیے باقی',
  'This month': 'اس مہینے',
  'In': 'آیا',
  'Out': 'گیا',
  'Kept': 'بچا',
  'Over': 'زیادہ',
  'Recent': 'حال ہی میں',
  'See all': 'سب دیکھیں',
  'No transactions yet': 'ابھی کچھ نہیں لکھا',

  // Settings
  'Account': 'اکاؤنٹ',
  'Appearance': 'ڈسپلے',
  'Money': 'پیسے',
  'Categories': 'کیٹیگریاں',
  'Data': 'ڈیٹا',
  'Theme': 'تھیم',
  'System': 'فون جیسا',
  'Light': 'لائٹ',
  'Dark': 'ڈارک',
  'Accent color': 'ایپ کا رنگ',
  'Hide amounts': 'رقم چھپائیں',
  'Week starts on': 'ہفتہ شروع ہوتا ہے',
  'Monday': 'پیر',
  'Sunday': 'اتوار',
  'Language': 'زبان',
  'English': 'انگریزی',
  'Urdu': 'اردو',
  'Font size': 'لکھائی کا سائز',
  'Font': 'فونٹ',
  'Normal': 'نارمل',
  'Large': 'بڑا',
  'Extra Large': 'اور بڑا',
  'Display density': 'جگہ',
  'Comfortable': 'کھلا کھلا',
  'Compact': 'تنگ',
  'Base currency': 'اصل کرنسی',

  // Transactions
  'Search': 'ڈھونڈیں',
  'Filter': 'فلٹر',
  'All': 'سب',
  'Moved': 'ٹرانسفر',
  'No transactions match': 'ایسا کچھ نہیں ملا',
  'Delete': 'مٹا دیں',
  'Edit': 'بدلیں',
  'Restore': 'واپس لائیں',
  'Show deleted': 'مٹائے ہوئے دکھائیں',
  'This month (filter)': 'اس مہینے',
  'Clear': 'صاف کریں',

  // Budgets screen
  'Budgets screen': 'بجٹ',
  'Still available': 'ابھی باقی',
  'Budgeted': 'بجٹ',
  'Spent': 'خرچ ہوا',
  'New budget': 'نیا بجٹ',
  'No budgets yet': 'ابھی کوئی بجٹ نہیں',

  // General
  'Add': 'نیا',
  'New': 'نیا',
  'Archive': 'پرانوں میں رکھیں',
  'Restored': 'واپس آ گیا',
  'Back': 'پیچھے',
  'Close': 'بند کریں',
  'Confirm': 'ہاں، ٹھیک ہے',
  'days left': 'دن باقی',
  'over': 'زیادہ',
  'left': 'باقی',
};

export function translate(key: string, lang: Lang): string {
  if (lang === 'en') return key;
  return UR[key] ?? UR_SCREENS[key] ?? key;
}

/**
 * Translate outside a hook. Screens remount on navigation and re-render on
 * any settings change, so reading the language directly is safe for them.
 */
export function tr(key: string): string {
  return translate(key, getCurrentLang());
}

/** Translate a string with `{placeholders}`, then fill them in. */
export function trf(key: string, vars: Record<string, string | number>): string {
  return tr(key).replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
}

/** React hook — returns a translator function for the current language. */
export function useT(): (key: string) => string {
  const lang = useStore((s) => s.settings.language ?? 'en');
  return React.useCallback((key: string) => translate(key, lang as Lang), [lang]);
}

/** The currently stored language, without subscribing to the store. */
export function getCurrentLang(): Lang {
  return (useStore.getState().settings.language ?? 'en') as Lang;
}
