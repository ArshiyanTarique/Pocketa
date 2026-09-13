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

export type Lang = 'en' | 'ur';

const UR: Record<string, string> = {
  // Navigation
  'Home': 'ہوم',
  'Activity': 'سرگرمی',
  'Carpool': 'کارپول',
  'Me': 'میں',
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
  'Lend / Borrow': 'قرض دیں / لیں',
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
  return UR[key] ?? key;
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
