import type { KeyboardEvent } from 'react';

/** Keep Tab in the dialog even when the browser would move to its chrome. */
export function wrapDialogFocus(event: KeyboardEvent<HTMLDialogElement>): void {
  if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return;
  const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]'))
    .filter(element => !element.matches(':disabled, [tabindex="-1"]') && element.getClientRects().length > 0);
  if (!items.length) { event.preventDefault(); event.currentTarget.focus(); return; }
  const first = items[0], last = items.at(-1)!;
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}
