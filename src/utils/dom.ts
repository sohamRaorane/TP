/** true when keyboard/clipboard events should be left to a text field */
export const isEditableTarget = (t: EventTarget | null): boolean => {
  if (!t || typeof (t as Element).tagName !== 'string') return false;
  const el = t as HTMLElement;
  const tag = el.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if (el.isContentEditable) return true;
  const ce = el.getAttribute?.('contenteditable');
  return ce !== null && ce !== undefined && ce !== 'false';
};

export const isJsdom = () => typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent);
