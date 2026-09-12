import * as React from 'react';
import { cn } from './cn';
import { formatMoney, parseAmount, toInputString } from '../core/money';
import { normaliseTags } from '../core/ledger';
import { FieldContext, useControlId, useFieldLabelId } from './fieldContext';

// ---------------------------------------------------------------------------
// Field shell
// ---------------------------------------------------------------------------

export function Field({
  label,
  hint,
  error,
  children,
  className,
  htmlFor,
  optional,
}: {
  label?: string;
  hint?: string;
  error?: string | null;
  children: React.ReactNode;
  className?: string;
  htmlFor?: string;
  optional?: boolean;
}) {
  const uid = React.useId();
  const controlId = htmlFor ?? uid;
  const labelId = `${uid}-label`;

  // `for` only appears once a control has taken the id. A dangling `for`
  // points a screen reader at nothing, which is worse than an unlabelled field.
  const [bound, setBound] = React.useState(!!htmlFor);
  const claim = React.useCallback(() => setBound(true), []);
  const binding = React.useMemo(
    () => ({ controlId, labelId, claim }),
    [controlId, labelId, claim],
  );

  return (
    <div className={cn('space-y-1.5', className)}>
      {label && (
        <label
          id={labelId}
          htmlFor={bound ? controlId : undefined}
          className="flex items-baseline gap-2 text-[0.8125rem] font-medium text-ink-2"
        >
          {label}
          {optional && <span className="text-xs font-normal text-ink-4">optional</span>}
        </label>
      )}
      <FieldContext.Provider value={binding}>{children}</FieldContext.Provider>
      {error ? (
        <p className="flex items-start gap-1.5 text-xs text-negative" role="alert">
          {error}
        </p>
      ) : (
        hint && <p className="text-xs leading-relaxed text-ink-4">{hint}</p>
      )}
    </div>
  );
}

const CONTROL = [
  'w-full rounded-[11px] border bg-surface px-3 text-sm text-ink',
  'transition-[border-color,box-shadow] duration-150',
  'placeholder:text-ink-4',
  'focus:outline-none focus:border-accent focus:ring-[3px] focus:ring-[color-mix(in_srgb,var(--accent)_18%,transparent)]',
  'disabled:opacity-50 disabled:cursor-not-allowed',
].join(' ');

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

export const TextInput = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }
>(function TextInput({ className, invalid, ...rest }, ref) {
  const id = useControlId(rest);
  return (
    <input
      ref={ref}
      className={cn(CONTROL, 'h-11', invalid ? 'border-negative' : 'border-line-strong', className)}
      aria-invalid={invalid || undefined}
      {...rest}
      id={id}
    />
  );
});

export function Textarea({
  className,
  rows = 3,
  ...rest
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useControlId(rest);
  return (
    <textarea
      rows={rows}
      className={cn(CONTROL, 'resize-none border-line-strong py-2.5 leading-relaxed', className)}
      {...rest}
      id={id}
    />
  );
}

export function Select({
  className,
  invalid,
  children,
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  const id = useControlId(rest);
  return (
    <div className="relative">
      <select
        className={cn(
          CONTROL,
          'h-11 appearance-none pr-9',
          invalid ? 'border-negative' : 'border-line-strong',
          className,
        )}
        {...rest}
        id={id}
      >
        {children}
      </select>
      <svg
        className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-ink-4"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Amount
// ---------------------------------------------------------------------------

export interface AmountInputProps {
  /** Minor units, or null when the field is empty or unparseable. */
  value: number | null;
  onChange: (minor: number | null) => void;
  currency?: string;
  autoFocus?: boolean;
  placeholder?: string;
  size?: 'md' | 'hero';
  id?: string;
  invalid?: boolean;
  onEnter?: () => void;
  className?: string;
  /** For a field whose label cannot be a `<label for>` — a row of them, say. */
  'aria-label'?: string;
}

/**
 * The amount field.
 *
 * Accepts what people actually type — "1,200", "5k", "Rs. 850", "2.5 lakh" —
 * and converts to minor units on the way in, so no float ever reaches the
 * ledger. Shows the parsed value back beneath the field so the user can
 * confirm the app understood them before saving.
 */
export function AmountInput({
  value,
  onChange,
  currency = 'PKR',
  autoFocus,
  placeholder = '0',
  size = 'md',
  id: idProp,
  invalid,
  onEnter,
  className,
  'aria-label': ariaLabel,
}: AmountInputProps) {
  const id = useControlId({ id: idProp, 'aria-label': ariaLabel });
  const [text, setText] = React.useState(() => (value != null ? toInputString(value, currency) : ''));
  const [touched, setTouched] = React.useState(false);
  const lastEmitted = React.useRef(value);

  // Track external changes (e.g. the form loading an existing transaction)
  // without stomping on what the user is mid-way through typing.
  React.useEffect(() => {
    if (value !== lastEmitted.current) {
      setText(value != null ? toInputString(value, currency) : '');
      lastEmitted.current = value;
    }
  }, [value, currency]);

  const parsed = text.trim() ? parseAmount(text, currency) : null;
  const showEcho =
    touched && parsed?.ok === true && /[a-zA-Z,]/.test(text) && parsed.minor !== 0;

  function handle(next: string) {
    setText(next);
    setTouched(true);
    const result = next.trim() ? parseAmount(next, currency) : null;
    const minor = result?.ok ? result.minor : null;
    lastEmitted.current = minor;
    onChange(minor);
  }

  return (
    <div className={className}>
      <div className="relative">
        <span
          className={cn(
            'pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 tnum text-ink-4',
            size === 'hero' ? 'text-2xl' : 'text-sm left-3',
          )}
        >
          {currencySymbol(currency)}
        </span>
        <input
          id={id}
          aria-label={ariaLabel}
          inputMode="decimal"
          autoComplete="off"
          autoFocus={autoFocus}
          value={text}
          placeholder={placeholder}
          onChange={(e) => handle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && onEnter) {
              e.preventDefault();
              onEnter();
            }
          }}
          aria-invalid={invalid || undefined}
          className={cn(
            'tnum w-full bg-transparent text-ink placeholder:text-ink-4',
            'focus:outline-none',
            size === 'hero'
              ? 'border-0 border-b-2 pb-1 pl-9 text-[2.25rem] font-medium leading-tight focus:border-accent'
              : cn(CONTROL, 'h-11 pl-10'),
            size === 'hero' && (invalid ? 'border-negative' : 'border-line-strong'),
            size !== 'hero' && (invalid ? 'border-negative' : 'border-line-strong'),
          )}
        />
      </div>

      {showEcho && parsed?.ok && (
        <p className="mt-1.5 text-xs text-ink-3 fade-in">
          Reads as {formatMoney(parsed.minor, currency)}
        </p>
      )}
      {touched && text.trim() && parsed && !parsed.ok && (
        <p className="mt-1.5 text-xs text-negative" role="alert">
          {parsed.error}
        </p>
      )}
    </div>
  );
}

function currencySymbol(code: string): string {
  const symbols: Record<string, string> = {
    PKR: 'Rs.', USD: '$', EUR: '€', GBP: '£', INR: '₹', JPY: '¥',
  };
  return symbols[code] ?? code;
}

// ---------------------------------------------------------------------------
// Date
// ---------------------------------------------------------------------------

export function DateInput({
  value,
  onChange,
  id: idProp,
  max,
  min,
  invalid,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  id?: string;
  max?: string;
  min?: string;
  invalid?: boolean;
  className?: string;
}) {
  const id = useControlId({ id: idProp });
  return (
    <input
      id={id}
      type="date"
      value={value}
      max={max}
      min={min}
      onChange={(e) => onChange(e.target.value)}
      aria-invalid={invalid || undefined}
      className={cn(
        CONTROL,
        'tnum h-11',
        invalid ? 'border-negative' : 'border-line-strong',
        className,
      )}
    />
  );
}

// ---------------------------------------------------------------------------
// Toggle
// ---------------------------------------------------------------------------

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
  id,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
  id?: string;
}) {
  // Without an id the `for` dangles and the row stops being clickable, leaving
  // only the 40x24 switch to hit.
  const uid = React.useId();
  const controlId = id ?? uid;

  return (
    <label
      htmlFor={controlId}
      className={cn(
        'flex cursor-pointer items-start justify-between gap-4 py-1',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ink">{label}</span>
        {description && (
          <span className="mt-0.5 block text-xs leading-relaxed text-ink-3">{description}</span>
        )}
      </span>
      <button
        id={controlId}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors duration-200',
          checked ? 'bg-accent-fill' : 'bg-line-strong',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 size-5 rounded-full bg-white shadow-sm transition-[left] duration-200',
            checked ? 'left-[1.375rem]' : 'left-0.5',
          )}
        />
      </button>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

export function TagInput({
  value,
  onChange,
  suggestions = [],
  id: idProp,
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  suggestions?: string[];
  id?: string;
}) {
  const id = useControlId({ id: idProp });
  const [draft, setDraft] = React.useState('');

  function commit(raw: string) {
    const next = normaliseTags([...value, raw]);
    onChange(next);
    setDraft('');
  }

  const unused = suggestions.filter(
    (s) => !value.some((v) => v.toLowerCase() === s.toLowerCase()),
  );

  return (
    <div>
      <div
        className={cn(
          'flex min-h-11 flex-wrap items-center gap-1.5 rounded-[11px] border border-line-strong bg-surface px-2 py-1.5',
          'focus-within:border-accent focus-within:ring-[3px] focus-within:ring-[color-mix(in_srgb,var(--accent)_18%,transparent)]',
        )}
      >
        {value.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent"
          >
            #{tag}
            <button
              type="button"
              onClick={() => onChange(value.filter((t) => t !== tag))}
              className="opacity-60 hover:opacity-100"
              aria-label={`Remove tag ${tag}`}
            >
              ×
            </button>
          </span>
        ))}
        <input
          id={id}
          value={draft}
          placeholder={value.length === 0 ? 'Add a tag' : ''}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if ((e.key === 'Enter' || e.key === ',') && draft.trim()) {
              e.preventDefault();
              commit(draft);
            } else if (e.key === 'Backspace' && !draft && value.length) {
              onChange(value.slice(0, -1));
            }
          }}
          onBlur={() => draft.trim() && commit(draft)}
          className="min-w-[7rem] flex-1 bg-transparent px-1 text-sm text-ink placeholder:text-ink-4 focus:outline-none"
        />
      </div>

      {unused.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {unused.slice(0, 8).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => commit(s)}
              className="rounded-full border border-line px-2 py-0.5 text-xs text-ink-3 transition-colors hover:border-accent hover:text-accent"
            >
              #{s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Choice chips — faster than a select on mobile
// ---------------------------------------------------------------------------

export function ChipGroup<T extends string>({
  options,
  value,
  onChange,
  columns,
}: {
  options: Array<{ value: T; label: string; icon?: React.ReactNode; color?: string | null }>;
  value: T | null;
  onChange: (v: T) => void;
  columns?: number;
}) {
  return (
    <div
      className={cn('grid gap-1.5', columns ? '' : 'grid-cols-2 sm:grid-cols-3')}
      style={columns ? { gridTemplateColumns: `repeat(${columns}, minmax(0,1fr))` } : undefined}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn(
              'flex items-center gap-2 rounded-[11px] border px-3 py-2.5 text-left text-[0.8125rem] font-medium transition-all',
              active
                ? 'border-accent bg-accent-soft text-accent'
                : 'border-line bg-surface text-ink-2 hover:border-line-strong hover:text-ink',
            )}
          >
            {opt.color && (
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ background: opt.color }}
                aria-hidden="true"
              />
            )}
            {opt.icon}
            <span className="truncate">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export { useFieldLabelId };
