/** true when keyboard/clipboard events should be left to a text field */
// focused sliders, checkboxes and buttons must not swallow canvas shortcuts (undo, delete, …)
const NON_TEXT_INPUTS = new Set(['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'color', 'file', 'image']);

/** a slider keeps its own arrow keys */
export const isRangeTarget = (t: EventTarget | null) =>
  !!t && (t as HTMLElement).tagName === 'INPUT' && (t as HTMLInputElement).type === 'range';

export const isEditableTarget = (t: EventTarget | null): boolean => {
  if (!t || typeof (t as Element).tagName !== 'string') return false;
  const el = t as HTMLElement;
  const tag = el.tagName.toLowerCase();
  if (tag === 'textarea' || tag === 'select') return true;
  if (tag === 'input') return !NON_TEXT_INPUTS.has(((el as HTMLInputElement).type || 'text').toLowerCase());
  if (el.isContentEditable) return true;
  const ce = el.getAttribute?.('contenteditable');
  return ce !== null && ce !== undefined && ce !== 'false';
};

export const isJsdom = () => typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent);
