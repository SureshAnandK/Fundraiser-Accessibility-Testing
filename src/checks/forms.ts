import type { Page } from '@playwright/test';
import { installHelpers } from '../core/browser';
import { coverage, finding, type CheckOutcome } from './rules';

export interface ErrorMessageResult {
  message: string;
  field: string;
  associated: boolean;
  announced: boolean;
  how: string;
}

/**
 * Inspects the validation messages currently displayed inside `scope`. Call it straight after
 * triggering validation: whether a message is "announced" depends on where focus is right then.
 *
 * Associated = the field is aria-invalid and points at the message with aria-describedby.
 * Announced  = focus is on that field (so the description is read) or the message is in a live region.
 */
export async function checkErrorMessages(page: Page, scope: string): Promise<CheckOutcome & { messages: ErrorMessageResult[] }> {
  await installHelpers(page);

  const found = await page.evaluate((scopeSelector) => {
    const h = window.__a11y;
    const root = document.querySelector(scopeSelector);
    if (!root) return [];
    const isField = (el: Element) => /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName);
    const messages = Array.from(root.querySelectorAll<HTMLElement>('.mage-error, .field-error, .error-message, [id$="-error"], [role="alert"]')).filter(
      (el) => !isField(el) && h.visible(el) && (el.innerText ?? '').trim().length > 0,
    );

    // After a submit the browser is put on the first invalid field; the user then meets the other
    // errors field by field. So focus on any invalid field here counts for every message in scope.
    const active = document.activeElement;
    const focusOnInvalidField = Boolean(active && root.contains(active) && active.getAttribute('aria-invalid') === 'true');

    return messages.map((message) => {
      const describedBy = message.id
        ? Array.from(root.querySelectorAll<HTMLElement>('[aria-describedby]')).find((f) => (f.getAttribute('aria-describedby') ?? '').split(/\s+/).includes(message.id))
        : undefined;
      // If nothing references the message, the field it sits next to is the one it is about.
      const nearby = message.closest('.control, .field, .form-group, label')?.querySelector<HTMLElement>('input, select, textarea') ?? undefined;
      const field = describedBy ?? nearby;
      const invalid = field?.getAttribute('aria-invalid') === 'true';
      const live = message.closest('[role="alert"], [role="status"], [aria-live="assertive"], [aria-live="polite"]');
      return {
        target: h.target(message),
        html: h.snippet(message),
        message: (message.innerText ?? '').replace(/\s+/g, ' ').trim(),
        field: (field ? h.name(field).name || field.id || field.getAttribute('name') || field.tagName.toLowerCase() : '(no field found)').slice(0, 60),
        associated: Boolean(describedBy && invalid),
        announced: Boolean(live) || focusOnInvalidField,
        how: live ? 'live region' : focusOnInvalidField ? 'focus moved to an invalid field' : 'not announced',
      };
    });
  }, scope);

  const unassociated = found.filter((m) => !m.associated);
  const silent = found.filter((m) => m.associated && !m.announced);

  return {
    messages: found.map(({ message, field, associated, announced, how }) => ({ message, field, associated, announced, how })),
    raw: [
      ...unassociated.map((m) => finding('error-not-associated', m, `"${m.message}" is shown for "${m.field}", but the field is not aria-invalid with aria-describedby pointing at the message.`)),
      ...silent.map((m) => finding('error-not-announced', m, `"${m.message}" appeared for "${m.field}" while focus was elsewhere, and the message is not in a live region.`)),
    ],
    coverage: [coverage('error-not-associated', found.length, unassociated.length), coverage('error-not-announced', found.length, silent.length)],
  };
}
