import { createHash } from 'node:crypto';
import type { Severity } from '../../config/a11y.config';
import type { Level } from './wcag';

/**
 * violation    = deterministic rule with an objective pass/fail condition.
 * needs-review = heuristic or context-dependent; a person has to confirm it.
 */
export type Status = 'violation' | 'needs-review';

export type Source = 'axe' | 'keyboard' | 'structure' | 'forms' | 'responsive' | 'dialog';

/** Same shape axe uses: one entry per frame hop; a nested array is a shadow-DOM path. */
export type Target = (string | string[])[];

export interface ScanContext {
  pageId: string;
  pageName: string;
  url: string;
  /** UI state the page was in, e.g. `initial`. */
  state: string;
  /** Playwright project name. */
  viewport: string;
}

/** What a check produces, before it is tied to a scan. */
export interface RawFinding {
  source: Source;
  ruleId: string;
  status: Status;
  severity: Severity;
  level: Level;
  /** Success criteria numbers, e.g. ['1.4.3']. */
  wcag: string[];
  title: string;
  description: string;
  helpUrl: string;
  target: Target;
  html: string;
  failureSummary: string;
}

export interface Finding extends RawFinding {
  selector: string;
  owner: string;
  region: string;
  /** Path relative to the reports folder. */
  screenshot?: string;
  /** Identity of the issue across states and viewports. */
  fingerprint: string;
  context: ScanContext;
}

export interface RuleCoverage {
  source: Source;
  ruleId: string;
  title: string;
  wcag: string[];
  level: Level;
  /** Elements that satisfied the rule. */
  passed: number;
  /** Elements that violated the rule. */
  failed: number;
  /** Elements a person has to judge. */
  review: number;
  /** The rule ran but nothing on the page matched it. */
  inapplicable: boolean;
}

export interface ScanRecord {
  kind: 'scan';
  context: ScanContext;
  engine: string;
  /** What part of the page was examined. */
  scope: string;
  timestamp: string;
  coverage: RuleCoverage[];
  findings: Finding[];
}

/** Non-finding evidence for the report: tab order, outlines, structure outline. */
export interface InfoRecord {
  kind: 'info';
  topic: string;
  context: ScanContext;
  data: unknown;
}

export const ATTACH_SCAN = 'a11y-scan';
export const ATTACH_INFO = 'a11y-info';

/** `>>` steps into a shadow root, `>>>` steps into an iframe. */
export function selectorText(target: Target): string {
  return target.map((t) => (Array.isArray(t) ? t.join(' >> ') : t)).join(' >>> ');
}

/**
 * Generated tokens (random iframe names, timestamped classes, per-load ids) change on every
 * page load. They are masked so the same issue keeps the same identity across scans.
 */
function stable(selector: string): string {
  // Embedded third-party frames often get a random name on every load.
  return selector.replace(/iframe\[name="[^"]*"\]/g, 'iframe[name]').replace(/[A-Za-z0-9]{6,}/g, (token) => {
    const digits = token.replace(/\D/g, '').length;
    const letters = token.length - digits;
    if (letters === 0) return '*';
    return token.length >= 8 && digits >= 2 && letters >= 2 ? '*' : token;
  });
}

export function fingerprint(pageId: string, ruleId: string, selector: string): string {
  return createHash('sha1').update(`${pageId}|${ruleId}|${stable(selector)}`).digest('hex').slice(0, 12);
}

export function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

export function csvCell(value: string | number): string {
  const text = String(value).replace(/\s+/g, ' ').trim();
  return /[",]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
