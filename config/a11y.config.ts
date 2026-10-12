export type Severity = 'critical' | 'serious' | 'moderate' | 'minor';

export const SEVERITY_ORDER: Severity[] = ['minor', 'moderate', 'serious', 'critical'];

export interface OwnerRule {
  owner: string;
  /** CSS matched against the element and each ancestor (shadow hosts included). */
  css?: string;
  /** Regex source matched against ancestor tag names, for custom elements with generated suffixes. */
  tag?: string;
  /** Regex source matched against the selector text when the element can no longer be resolved. */
  hint: string;
}

export interface RegionRule {
  name: string;
  css: string;
}

const failOn = (process.env.A11Y_FAIL_ON ?? 'serious').toLowerCase();

export const a11yConfig = {
  standard: 'WCAG 2.2 Level AA',

  /** axe-core rule tags that count toward conformance. */
  wcagTags: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
  /** Reported as advisory; never fail the run. */
  advisoryTags: ['best-practice'],

  /** Lowest severity that fails a test. `none` = audit only (report is still written). */
  failOn: failOn as Severity | 'none',

  firstPartyOwner: 'First-party',
  /**
   * Third-party content embedded in the audited pages, so a finding inside it is reported as
   * "raise with the vendor" rather than "fix in our code". The pages audited today embed none;
   * add one entry per vendor, e.g.
   * `{ owner: 'Acme chat', css: '[id^="acme-"], iframe[src*="acme"]', hint: 'acme' }`.
   */
  owners: [] as OwnerRule[],

  /** Nearest matching ancestor wins; within one ancestor, the first rule listed wins. */
  regions: [
    { name: 'Breadcrumbs', css: '.breadcrumbs, nav[aria-label*="readcrumb"]' },
    { name: 'Header', css: 'header, [role="banner"]' },
    { name: 'Footer', css: 'footer, [role="contentinfo"]' },
    { name: 'Main content', css: 'main, [role="main"]' },
  ] as RegionRule[],

  evidence: {
    /** Element screenshots captured per rule, per scan. */
    maxPerRule: 3,
  },

  keyboard: {
    maxTabStops: 160,
    /** Pause after each Tab so focus-driven animations finish before measuring. */
    settleMs: 110,
  },

  narration: {
    /** An installed Windows voice, e.g. `Microsoft David Desktop`. */
    voice: process.env.A11Y_VOICE ?? 'Microsoft Zira Desktop',
    /** Speaking rate, -10 (slowest) to 10. */
    rate: Math.max(-10, Math.min(10, Math.round(Number(process.env.A11Y_VOICE_RATE ?? 0)) || 0)),
    /** Silence between one announcement and the next Tab press. */
    gapMs: 450,
    /** Stop after this many tab stops. Unset walks up to `keyboard.maxTabStops`. */
    maxStops: Number(process.env.A11Y_NARRATE_MAX) || undefined,
  },
};

export function meetsThreshold(severity: Severity): boolean {
  if (a11yConfig.failOn === 'none') return false;
  return SEVERITY_ORDER.indexOf(severity) >= SEVERITY_ORDER.indexOf(a11yConfig.failOn);
}
