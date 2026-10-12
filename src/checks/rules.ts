import type { Severity } from '../../config/a11y.config';
import type { RawFinding, RuleCoverage, Source, Status, Target } from '../core/findings';
import { understandingUrl, type Level } from '../core/wcag';

interface CustomRule {
  source: Source;
  title: string;
  description: string;
  wcag: string[];
  level: Level;
  severity: Severity;
  status: Status;
}

/**
 * Checks axe-core cannot perform because they need real interaction or judgement.
 * `violation` rules have an objective pass/fail condition; `needs-review` rules are heuristics.
 */
export const RULES = {
  // ---- keyboard ----
  'kbd-focus-trap': {
    source: 'keyboard',
    title: 'Keyboard focus must not get trapped',
    description: 'Pressing Tab repeatedly must always move focus on. Focus that stays on one element locks keyboard users out of the rest of the page.',
    wcag: ['2.1.2'], level: 'A', severity: 'critical', status: 'violation',
  },
  'kbd-focus-not-visible': {
    source: 'keyboard',
    title: 'Focused element must show a visible focus indicator',
    description: 'Screenshots of the element taken with and without keyboard focus are pixel-identical: nothing on screen shows a sighted keyboard user where focus is (WCAG failure F78).',
    wcag: ['2.4.7'], level: 'AA', severity: 'serious', status: 'violation',
  },
  'kbd-frame-not-exited': {
    source: 'keyboard',
    title: 'Keyboard focus should be able to leave an embedded frame',
    description: 'Focus entered an embedded frame and did not come back out after many Tab presses, although more controls follow it on the page. The frame\'s contents cannot be inspected from outside, so this needs a manual check.',
    wcag: ['2.1.2'], level: 'A', severity: 'serious', status: 'needs-review',
  },
  'kbd-focus-lost': {
    source: 'keyboard',
    title: 'Tab should always move focus to the next control',
    description: 'Pressing Tab from this element left focus on the page body instead of the next control, so for one key press nothing is focused.',
    wcag: ['2.4.3'], level: 'A', severity: 'moderate', status: 'needs-review',
  },
  'kbd-stop-unnamed': {
    source: 'keyboard',
    title: 'Every tab stop should have an accessible name',
    description: 'Focus lands on an element with no accessible name, so a screen reader announces nothing useful and the user cannot tell what it is.',
    wcag: ['4.1.2'], level: 'A', severity: 'serious', status: 'needs-review',
  },
  'kbd-focus-hidden-element': {
    source: 'keyboard',
    title: 'Focus should not land on an element that is not visible',
    description: 'Tab moved focus to an element that is zero-sized, fully transparent, or outside the viewport, so focus appears to vanish.',
    wcag: ['2.4.7', '2.4.3'], level: 'AA', severity: 'serious', status: 'needs-review',
  },
  'kbd-focus-obscured': {
    source: 'keyboard',
    title: 'Focused element should not be hidden behind fixed content',
    description: 'The focused element is entirely covered by fixed or sticky content such as a pinned header or floating tab.',
    wcag: ['2.4.11'], level: 'AA', severity: 'moderate', status: 'needs-review',
  },
  'kbd-not-focusable': {
    source: 'keyboard',
    title: 'Interactive controls should be reachable with the keyboard',
    description: 'The element has an interactive ARIA role but is not in the tab order, so it may only be operable with a mouse.',
    wcag: ['2.1.1'], level: 'A', severity: 'serious', status: 'needs-review',
  },
  'kbd-mouse-only': {
    source: 'keyboard',
    title: 'Clickable elements should be real controls',
    description: 'The element shows a pointer cursor but is not a link or button, has no role, and cannot receive focus. If it does something on click, keyboard and screen-reader users cannot use it.',
    wcag: ['2.1.1', '4.1.2'], level: 'A', severity: 'serious', status: 'needs-review',
  },
  'kbd-submenu-not-openable': {
    source: 'keyboard',
    title: 'Hover menus should also open from the keyboard',
    description: 'The submenu appears on mouse hover but did not open with Arrow Down, Arrow Right or Space while its parent item had keyboard focus.',
    wcag: ['2.1.1'], level: 'A', severity: 'serious', status: 'needs-review',
  },
  'kbd-skip-link-broken': {
    source: 'keyboard',
    title: 'Skip link must move focus to its target',
    description: 'Activating the skip link did not move keyboard focus to, or past, the content it points at.',
    wcag: ['2.4.1'], level: 'A', severity: 'serious', status: 'violation',
  },
  'kbd-skip-link-not-first': {
    source: 'keyboard',
    title: 'Skip link should be the first thing keyboard users reach',
    description: 'Other focusable elements come before the skip link, so users must tab through them before they can skip anything.',
    wcag: ['2.4.1'], level: 'A', severity: 'minor', status: 'needs-review',
  },
  'kbd-skip-link-missing': {
    source: 'keyboard',
    title: 'Page should offer a way to skip repeated blocks',
    description: 'No "skip to content" link was found near the start of the page.',
    wcag: ['2.4.1'], level: 'A', severity: 'moderate', status: 'needs-review',
  },

  // ---- structure ----
  'img-alt-filename': {
    source: 'structure',
    title: 'Image alt text looks like a file name or ID',
    description: 'The alt attribute is present but reads as a file name or numeric ID, which tells a screen-reader user nothing (WCAG failure F30).',
    wcag: ['1.1.1'], level: 'A', severity: 'serious', status: 'needs-review',
  },
  'img-alt-placeholder': {
    source: 'structure',
    title: 'Image alt text is a generic placeholder',
    description: 'The alt attribute is a placeholder such as "image" or "product photo" rather than a description of this image (WCAG failure F30).',
    wcag: ['1.1.1'], level: 'A', severity: 'moderate', status: 'needs-review',
  },
  'img-decorative-large': {
    source: 'structure',
    title: 'Large or linked image is marked decorative',
    description: 'The image has empty alt text, which hides it from screen readers. That is right for decoration, wrong if the image carries information such as promotional text.',
    wcag: ['1.1.1'], level: 'A', severity: 'moderate', status: 'needs-review',
  },
  'heading-visual-only': {
    source: 'structure',
    title: 'Text styled as a heading should be marked up as a heading',
    description: 'A short bold line introduces a block of text but is a plain paragraph, so screen-reader users cannot navigate to it or see the section structure.',
    wcag: ['1.3.1', '2.4.6'], level: 'A', severity: 'moderate', status: 'needs-review',
  },
  'link-ambiguous-text': {
    source: 'structure',
    title: 'Link text should identify its destination',
    description: 'The link text is generic, or the same text leads to different destinations, so the purpose is unclear when links are listed out of context.',
    wcag: ['2.4.4'], level: 'A', severity: 'moderate', status: 'needs-review',
  },
  'link-new-window': {
    source: 'structure',
    title: 'Links that open a new window should say so',
    description: 'The link opens a new tab or window without warning the user in its text or accessible name.',
    wcag: [], level: 'best-practice', severity: 'minor', status: 'needs-review',
  },
  'tab-selected-state': {
    source: 'structure',
    title: 'The active tab must be exposed as selected',
    description: 'The tab whose panel is displayed has aria-selected="false", so assistive technology announces the visible tab as not selected.',
    wcag: ['4.1.2'], level: 'A', severity: 'moderate', status: 'violation',
  },
  'field-name-weak': {
    source: 'structure',
    title: 'Form field is named only by placeholder or title',
    description: 'The field has no visible label. A placeholder disappears on input and a title only shows on hover, so the instruction is lost for many users.',
    wcag: ['3.3.2', '2.5.3'], level: 'A', severity: 'moderate', status: 'needs-review',
  },
  'field-purpose-missing': {
    source: 'structure',
    title: 'Personal-data field should declare its purpose',
    description: 'A field collecting information about the user has no autocomplete token, so browsers and assistive technology cannot identify or fill it.',
    wcag: ['1.3.5'], level: 'AA', severity: 'moderate', status: 'needs-review',
  },
  'combobox-expanded-state': {
    source: 'structure',
    title: 'Combobox must report that its popup is open',
    description: 'Suggestions are displayed but the input still reports aria-expanded="false", so screen-reader users are not told results are available.',
    wcag: ['4.1.2'], level: 'A', severity: 'moderate', status: 'violation',
  },

  // ---- forms ----
  'error-not-associated': {
    source: 'forms',
    title: 'Error message must be tied to its field',
    description: 'A validation message is displayed but the field is not marked aria-invalid or does not reference the message with aria-describedby.',
    wcag: ['3.3.1', '4.1.2'], level: 'A', severity: 'serious', status: 'violation',
  },
  'error-not-announced': {
    source: 'forms',
    title: 'Error message should be announced when it appears',
    description: 'The message appears without moving focus to the field and is not in a live region, so a screen-reader user may never learn the input was rejected.',
    wcag: ['4.1.3'], level: 'AA', severity: 'moderate', status: 'needs-review',
  },

  // ---- responsive ----
  'reflow-horizontal-scroll': {
    source: 'responsive',
    title: 'Page must reflow at 320 CSS pixels without horizontal scrolling',
    description: 'At a 320px-wide viewport (equivalent to 400% zoom on a 1280px display) the page scrolls horizontally.',
    wcag: ['1.4.10'], level: 'AA', severity: 'serious', status: 'violation',
  },
  'reflow-clipped-content': {
    source: 'responsive',
    title: 'Content should not be cut off at 320 CSS pixels',
    description: 'The element extends past the viewport edge and the page hides the overflow, so part of it may be unreachable.',
    wcag: ['1.4.10'], level: 'AA', severity: 'moderate', status: 'needs-review',
  },
  'text-spacing-clipped': {
    source: 'responsive',
    title: 'Text should not be clipped when spacing is increased',
    description: 'With WCAG text-spacing values applied (line height 1.5, letter spacing 0.12em, word spacing 0.16em) the text no longer fits its container and is cut off.',
    wcag: ['1.4.12'], level: 'AA', severity: 'moderate', status: 'needs-review',
  },
  'zoom-200-overflow': {
    source: 'responsive',
    title: 'Page should stay usable at 200% zoom',
    description: 'At a viewport equivalent to 200% zoom the page scrolls horizontally or clips content.',
    wcag: ['1.4.4'], level: 'AA', severity: 'moderate', status: 'needs-review',
  },

  // ---- dialogs ----
  'dialog-focus-not-moved': {
    source: 'dialog',
    title: 'Opening a modal dialog should move focus into it',
    description: 'A modal dialog appeared but keyboard focus stayed on the page behind it.',
    wcag: ['2.4.3'], level: 'A', severity: 'serious', status: 'needs-review',
  },
  'dialog-focus-not-contained': {
    source: 'dialog',
    title: 'Focus should stay inside an open modal dialog',
    description: 'Tabbing moved focus out of the modal dialog to the page behind it while the dialog was still open.',
    wcag: ['2.4.3'], level: 'A', severity: 'moderate', status: 'needs-review',
  },
  'dialog-no-escape': {
    source: 'dialog',
    title: 'Modal dialog should close with the Escape key',
    description: 'Pressing Escape did not dismiss the dialog. Keyboard users expect Escape to close a modal.',
    wcag: [], level: 'best-practice', severity: 'moderate', status: 'needs-review',
  },
  'dialog-name-generic': {
    source: 'dialog',
    title: 'Dialog should have a meaningful accessible name',
    description: 'The dialog is announced with a generic name that does not say what it is for.',
    wcag: ['4.1.2'], level: 'A', severity: 'moderate', status: 'needs-review',
  },
} satisfies Record<string, CustomRule>;

export type RuleId = keyof typeof RULES;

export interface ElementRef {
  target: Target;
  html: string;
}

export function finding(ruleId: RuleId, element: ElementRef, failureSummary: string): RawFinding {
  const rule: CustomRule = RULES[ruleId];
  return {
    source: rule.source,
    ruleId,
    status: rule.status,
    severity: rule.severity,
    level: rule.level,
    wcag: rule.wcag,
    title: rule.title,
    description: rule.description,
    helpUrl: understandingUrl(rule.wcag[0] ?? ''),
    target: element.target,
    html: element.html,
    failureSummary,
  };
}

/** `checked` elements were examined, `flagged` of them produced a finding. */
export function coverage(ruleId: RuleId, checked: number, flagged: number): RuleCoverage {
  const rule: CustomRule = RULES[ruleId];
  const isViolation = rule.status === 'violation';
  return {
    source: rule.source,
    ruleId,
    title: rule.title,
    wcag: rule.wcag,
    level: rule.level,
    passed: Math.max(0, checked - flagged),
    failed: isViolation ? flagged : 0,
    review: isViolation ? 0 : flagged,
    inapplicable: checked === 0,
  };
}

export interface CheckOutcome {
  raw: RawFinding[];
  coverage: RuleCoverage[];
}
