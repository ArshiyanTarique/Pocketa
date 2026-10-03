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
  'Activity': 'سرگرمی',
  'Carpool': 'کارپول',
  'Plan': 'منصوبہ',
  'More': 'مزید',
  'People': 'لوگ',
  'Reports': 'رپورٹس',
  'Net worth': 'کل مالیت',
  'Show amounts': 'رقم دکھائیں',
  'Sign in': 'سائن ان',
  'Offline': 'آف لائن',
  'What you can spend and what needs attention': 'آپ کیا خرچ کر سکتے ہیں اور کس پر توجہ درکار ہے',
  'Everything you have recorded': 'آپ نے جو کچھ ریکارڈ کیا',
  'Log trips and see who owes what': 'سفر درج کریں اور دیکھیں کون کتنا دے گا',
  'What you pay regularly': 'جو آپ باقاعدگی سے ادا کرتے ہیں',
  'Limits you set on spending': 'خرچ پر آپ کی مقرر کردہ حدیں',
  'What you are saving for': 'آپ کس کے لیے بچت کر رہے ہیں',
  'Your banks, cash and cards': 'آپ کے بینک، نقد اور کارڈ',
  'Who owes you and who you owe': 'کون آپ کا مقروض ہے اور آپ کس کے',
  'Where your money went': 'آپ کا پیسہ کہاں گیا',
  'Account, appearance, currency and data': 'اکاؤنٹ، ظاہری شکل، کرنسی اور ڈیٹا',
  'Bills, budgets and goals': 'بل، بجٹ اور اہداف',
  'Everything else': 'باقی سب کچھ',
  'Accounts': 'اکاؤنٹ',
  'Budgets': 'بجٹ',
  'Bills': 'بل',
  'Debts': 'قرض',
  'Goals': 'اہداف',
  'Analytics': 'تجزیہ',
  'Settings': 'ترتیبات',
  'Join': 'شامل ہوں',
  'Pocketa': 'پاکٹہ',

  // QuickAdd
  'Add transaction': 'لین دین شامل کریں',
  'Edit transaction': 'لین دین میں ترمیم',
  'Expense': 'خرچہ',
  'Income': 'آمدنی',
  'Transfer': 'منتقلی',
  'Lent': 'قرض دیا',
  'Borrowed': 'قرض لیا',
  'Form': 'فارم',
  'Quick type': 'جلدی لکھیں',
  'More options': 'مزید اختیارات',
  'Notes, receipt, budget, split': 'نوٹ، رسید، بجٹ، تقسیم',
  'Say what happened': 'بتائیں کیا ہوا',
  'Which expense is this refunding?': 'یہ کس خرچے کی واپسی ہے؟',
  'Choose a person': 'کوئی شخص چنیں',
  'Choose an account': 'اکاؤنٹ چنیں',
  'From my account': 'میرے اکاؤنٹ سے',
  'To whom': 'کس کو',
  'From whom': 'کس سے',
  'Into my account': 'میرے اکاؤنٹ میں',
  'Amount received in': 'موصول شدہ رقم بصورت',
  'Earned': 'کمایا',
  'Saved': 'بچایا',
  'Overspent': 'زیادہ خرچ',
  'Transfers': 'منتقلیاں',
  'Safe to spend': 'خرچ کے لیے محفوظ',
  'How is this worked out?': 'یہ کیسے نکالا گیا؟',
  'Net': 'خالص',
  'entry': 'اندراج',
  'entries': 'اندراجات',
  'Add an account': 'اکاؤنٹ شامل کریں',
  'Open Bills': 'بل کھولیں',
  'Open Budgets': 'بجٹ کھولیں',
  'Open People': 'لوگ کھولیں',
  'Open Carpool': 'کارپول کھولیں',
  'Refund': 'واپسی',
  'Amount': 'رقم',
  'Category': 'زمرہ',
  'Budget': 'بجٹ',
  'Paid from': 'ادائیگی سے',
  'Into': 'میں',
  'Date': 'تاریخ',
  'Title': 'عنوان',
  'Merchant': 'دکاندار',
  'Notes': 'نوٹ',
  'Tags': 'ٹیگ',
  'Receipt': 'رسید',
  'Save': 'محفوظ کریں',
  'Save & add': 'محفوظ کریں اور شامل کریں',
  'Save changes': 'تبدیلیاں محفوظ کریں',
  'Cancel': 'منسوخ',
  'From': 'سے',
  'To': 'تک',
  'Quick': 'فوری',
  'Type a sentence': 'جملہ لکھیں',
  'Search categories': 'زمرے تلاش کریں',
  'No category matches': 'کوئی زمرہ نہیں ملا',
  'Optional': 'اختیاری',
  'Date, merchant, notes and tags': 'تاریخ، دکاندار، نوٹ اور ٹیگ',
  'Split across categories': 'زمروں میں تقسیم کریں',
  'Remove split': 'تقسیم ہٹائیں',
  'Share with someone': 'کسی کے ساتھ شیئر کریں',
  'Remove shares': 'حصص ہٹائیں',
  'Fill in the amount, account and category first.': 'پہلے رقم، اکاؤنٹ اور زمرہ بھریں۔',
  'This cannot be saved yet': 'ابھی محفوظ نہیں ہو سکتا',
  'What budget does this belong to?': 'یہ کس بجٹ سے تعلق رکھتا ہے؟',
  'No budget': 'کوئی بجٹ نہیں',

  // Dashboard
  'Left to spend': 'خرچ کرنے کے لیے باقی',
  'This month': 'اس مہینے',
  'In': 'آمدنی',
  'Out': 'خرچ',
  'Kept': 'بچت',
  'Over': 'زیادہ',
  'Recent': 'حالیہ',
  'See all': 'سب دیکھیں',
  'No transactions yet': 'ابھی کوئی لین دین نہیں',

  // Settings
  'Account': 'اکاؤنٹ',
  'Appearance': 'ظاہری شکل',
  'Money': 'رقم',
  'Categories': 'زمرے',
  'Data': 'ڈیٹا',
  'Theme': 'تھیم',
  'System': 'سسٹم',
  'Light': 'روشن',
  'Dark': 'تاریک',
  'Accent color': 'لہجے کا رنگ',
  'Hide amounts': 'رقم چھپائیں',
  'Week starts on': 'ہفتہ شروع ہوتا ہے',
  'Monday': 'سوموار',
  'Sunday': 'اتوار',
  'Language': 'زبان',
  'English': 'انگریزی',
  'Urdu': 'اردو',
  'Font size': 'حروف کا سائز',
  'Font': 'فونٹ',
  'Normal': 'معمول',
  'Large': 'بڑا',
  'Extra Large': 'بہت بڑا',
  'Display density': 'ڈسپلے کثافت',
  'Comfortable': 'آرام دہ',
  'Compact': 'گنجان',
  'Base currency': 'بنیادی کرنسی',

  // Transactions
  'Search': 'تلاش',
  'Filter': 'فلٹر',
  'All': 'سب',
  'Moved': 'منتقل',
  'No transactions match': 'کوئی لین دین نہیں ملا',
  'Delete': 'حذف کریں',
  'Edit': 'ترمیم',
  'Restore': 'بحال کریں',
  'Show deleted': 'حذف شدہ دکھائیں',
  'This month (filter)': 'اس مہینے',
  'Clear': 'صاف کریں',

  // Budgets screen
  'Budgets screen': 'بجٹ',
  'Still available': 'ابھی دستیاب',
  'Budgeted': 'بجٹ شدہ',
  'Spent': 'خرچ شدہ',
  'New budget': 'نیا بجٹ',
  'No budgets yet': 'ابھی کوئی بجٹ نہیں',

  // General
  'Add': 'شامل',
  'New': 'نیا',
  'Archive': 'آرکائیو',
  'Restored': 'بحال',
  'Back': 'واپس',
  'Close': 'بند کریں',
  'Confirm': 'تصدیق کریں',
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
