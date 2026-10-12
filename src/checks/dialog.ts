import type { Page } from '@playwright/test';
import { installHelpers } from '../core/browser';
import type { RawFinding } from '../core/findings';
import { coverage, finding, type CheckOutcome } from './rules';

export interface DialogSelectors {
  /** Outermost element of the dialog; may be a custom element with a shadow root. */
  host: string;
  /** The element carrying role="dialog", looked up inside the host (shadow root included). */
  dialog: string;
  close: string;
}

export interface DialogResult {
  name: string;
  focusMovedIn: boolean;
  focusContained: boolean;
  closesOnEscape: boolean;
  closeButtonName: string;
}

const GENERIC_NAME = /^(modal|dialog|popup|pop-up|window|overlay|modal dialog|modal window|dialog window)?$/i;
const TAB_PRESSES = 10;

/**
 * Checks the keyboard contract of a modal dialog that is already open: focus moves in, stays in,
 * and Escape closes it. Leaves the dialog closed.
 */
export async function checkModalDialog(page: Page, selectors: DialogSelectors): Promise<CheckOutcome & { result: DialogResult }> {
  await installHelpers(page);

  /** Reads the dialog and whether focus is currently inside it, crossing shadow boundaries. */
  const read = () =>
    page.evaluate(({ host, dialog }) => {
      const h = window.__a11y;
      const hostEl = document.querySelector(host);
      if (!hostEl) return null;
      const dialogEl = hostEl.shadowRoot?.querySelector(dialog) ?? hostEl.querySelector(dialog) ?? hostEl;
      let active: Element | null = document.activeElement;
      while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
      const inside = Boolean(active && active !== document.body && h.ancestors(active).includes(dialogEl));
      return { target: h.target(dialogEl), html: h.snippet(dialogEl).slice(0, 200), name: h.name(dialogEl).source === 'content' ? '' : h.name(dialogEl).name, inside, open: h.visible(hostEl) && h.visible(dialogEl) };
    }, selectors);

  const initial = await read();
  if (!initial) throw new Error(`Dialog host not found: ${selectors.host}`);
  const ref = { target: initial.target, html: initial.html };

  let focusContained = true;
  for (let i = 0; i < TAB_PRESSES; i++) {
    await page.keyboard.press('Tab');
    await page.waitForTimeout(90);
    const now = await read();
    if (now && now.open && !now.inside) {
      focusContained = false;
      break;
    }
  }

  const closeButton = page.locator(selectors.host).locator(selectors.close).first();
  const closeButtonName = (await closeButton.getAttribute('aria-label').catch(() => null)) ?? (await closeButton.innerText().catch(() => '')) ?? '';

  await page.keyboard.press('Escape');
  await page.waitForTimeout(700);
  const afterEscape = await read();
  const closesOnEscape = !afterEscape || !afterEscape.open;
  if (!closesOnEscape) await closeButton.click({ timeout: 5000 }).catch(() => {});

  const result: DialogResult = { name: initial.name, focusMovedIn: initial.inside, focusContained, closesOnEscape, closeButtonName: closeButtonName.trim() };

  const raw: RawFinding[] = [];
  if (!result.focusMovedIn) raw.push(finding('dialog-focus-not-moved', ref, 'The dialog opened but keyboard focus was not moved inside it.'));
  if (!result.focusContained) raw.push(finding('dialog-focus-not-contained', ref, `Within ${TAB_PRESSES} Tab presses focus left the dialog while it was still open.`));
  if (!result.closesOnEscape) raw.push(finding('dialog-no-escape', ref, `Pressing Escape did not close the dialog; it can only be dismissed with its "${result.closeButtonName || 'close'}" button.`));
  if (GENERIC_NAME.test(result.name.trim())) raw.push(finding('dialog-name-generic', ref, result.name ? `The dialog's accessible name is "${result.name}", which does not describe its purpose.` : 'The dialog has no accessible name.'));

  return {
    result,
    raw,
    coverage: [
      coverage('dialog-focus-not-moved', 1, result.focusMovedIn ? 0 : 1),
      coverage('dialog-focus-not-contained', 1, result.focusContained ? 0 : 1),
      coverage('dialog-no-escape', 1, result.closesOnEscape ? 0 : 1),
      coverage('dialog-name-generic', 1, GENERIC_NAME.test(result.name.trim()) ? 1 : 0),
    ],
  };
}
