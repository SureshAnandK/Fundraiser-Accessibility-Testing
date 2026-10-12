import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import type { NodeResult, Result } from 'axe-core';
import { a11yConfig, type Severity } from '../../config/a11y.config';
import { truncate, type RawFinding, type RuleCoverage, type Status, type Target } from './findings';
import { criteriaFromTags, levelFromTags } from './wcag';

export interface AxeOptions {
  /** Limit the scan to these subtrees. Selectors that match nothing are dropped. */
  include?: string[];
  exclude?: string[];
}

export interface AxeOutcome {
  engine: string;
  scope: string;
  raw: RawFinding[];
  coverage: RuleCoverage[];
}

function whyItFails(node: NodeResult): string {
  if (node.failureSummary) return node.failureSummary;
  return [...node.any, ...node.all, ...node.none].map((check) => check.message).filter(Boolean).join(' ');
}

function toFinding(rule: Result, node: NodeResult, status: Status): RawFinding {
  return {
    source: 'axe',
    ruleId: rule.id,
    status,
    severity: (node.impact ?? rule.impact ?? 'moderate') as Severity,
    level: levelFromTags(rule.tags),
    wcag: criteriaFromTags(rule.tags),
    title: rule.help,
    description: rule.description,
    helpUrl: rule.helpUrl,
    target: node.target as Target,
    html: truncate(node.html, 400),
    failureSummary: truncate(whyItFails(node), 600),
  };
}

/**
 * Runs the axe-core rules engine against the page's current DOM state.
 * Violations become `violation` findings; axe's "incomplete" results (it could not decide)
 * become `needs-review`. Passes and inapplicable rules are kept as coverage.
 */
export async function runAxe(page: Page, options: AxeOptions = {}): Promise<AxeOutcome> {
  let builder = new AxeBuilder({ page }).withTags([...a11yConfig.wcagTags, ...a11yConfig.advisoryTags]);

  let scope = 'whole page';
  if (options.include?.length) {
    const present: string[] = [];
    for (const selector of options.include) if ((await page.locator(selector).count()) > 0) present.push(selector);
    if (present.length === 0) throw new Error(`axe scope matched nothing: ${options.include.join(', ')}`);
    for (const selector of present) builder = builder.include(selector);
    scope = present.join(', ');
  }
  for (const selector of options.exclude ?? []) builder = builder.exclude(selector);

  const results = await builder.analyze();

  const raw: RawFinding[] = [];
  for (const rule of results.violations) for (const node of rule.nodes) raw.push(toFinding(rule, node, 'violation'));
  for (const rule of results.incomplete) for (const node of rule.nodes) raw.push(toFinding(rule, node, 'needs-review'));

  const coverage = new Map<string, RuleCoverage>();
  const entry = (rule: Result): RuleCoverage => {
    let item = coverage.get(rule.id);
    if (!item) {
      item = {
        source: 'axe',
        ruleId: rule.id,
        title: rule.help,
        wcag: criteriaFromTags(rule.tags),
        level: levelFromTags(rule.tags),
        passed: 0,
        failed: 0,
        review: 0,
        inapplicable: false,
      };
      coverage.set(rule.id, item);
    }
    return item;
  };
  for (const rule of results.passes) entry(rule).passed += rule.nodes.length;
  for (const rule of results.violations) entry(rule).failed += rule.nodes.length;
  for (const rule of results.incomplete) entry(rule).review += rule.nodes.length;
  for (const rule of results.inapplicable) entry(rule).inapplicable = true;

  return {
    engine: `axe-core ${results.testEngine.version}`,
    scope,
    raw,
    coverage: [...coverage.values()],
  };
}
