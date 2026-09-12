import * as React from 'react';

/**
 * The wiring between a `Field`'s label and whatever control sits inside it.
 *
 * Call sites kept forgetting to pair `htmlFor` with an `id`, which is invisible
 * on screen and total for a screen reader: an unbound `<label>` leaves the field
 * announced as bare "combo box". So the `Field` offers an id and the control
 * takes it, whether or not anyone remembered.
 *
 * Two ids, because not everything inside a field is a form control. A `<select>`
 * takes `controlId` and gets a real `for`/`id` pair. A segmented control is a
 * tablist, which `<label for>` cannot address at all, so it points
 * `aria-labelledby` at `labelId` instead. The label only grows a `for`
 * attribute once something has actually claimed the id — a dangling `for` is
 * worse than none.
 */
export interface FieldBinding {
  controlId: string;
  labelId: string;
  claim(): void;
}

export const FieldContext = React.createContext<FieldBinding | undefined>(undefined);

/**
 * The id a control inside a `Field` should carry, or undefined when it already
 * names itself.
 */
export function useControlId(props: {
  id?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
}): string | undefined {
  const field = React.useContext(FieldContext);
  const explicit = props.id;
  const named = !!(props['aria-label'] || props['aria-labelledby']);
  const take = !explicit && !named && !!field;

  React.useEffect(() => {
    if (take) field!.claim();
  }, [take, field]);

  if (explicit) return explicit;
  if (named) return undefined;
  return field?.controlId;
}

/** The id of the enclosing `Field`'s label, for controls `<label for>` cannot bind. */
export function useFieldLabelId(): string | undefined {
  return React.useContext(FieldContext)?.labelId;
}
