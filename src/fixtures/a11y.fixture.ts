import { test as base, expect, type Page, type TestInfo } from '@playwright/test';
import { a11yConfig, meetsThreshold } from '../../config/a11y.config';
import type { PageUnderTest } from '../../config/pages';
import { runAxe } from '../core/axeScanner';
import { captureEvidence } from '../core/evidence';
import {
  ATTACH_INFO,
  ATTACH_SCAN,
  fingerprint,
  selectorText,
  type Finding,
  type InfoRecord,
  type RawFinding,
  type RuleCoverage,
  type ScanContext,
  type ScanRecord,
} from '../core/findings';
import { annotate } from '../core/ownership';
import { openPage, type OpenOptions } from '../core/pageReady';
import type { CheckOutcome } from '../checks/rules';

interface PublishOptions {
  /** Fail the test when blocking violations are present. Default true. */
  gate?: boolean;
  /** Capture element screenshots for violations. Default true. */
  evidence?: boolean;
}

/**
 * One audit session for one page in one test. Wraps the checks so every result is tagged with
 * its context, attributed to an owner, evidenced, sent to the reporter, and gated.
 */
export class Audit {
  put!: PageUnderTest;
  /** Write requests the read-only guard stopped. */
  blockedWrites: string[] = [];

  constructor(
    readonly page: Page,
    private readonly testInfo: TestInfo,
  ) {}

  async open(put: PageUnderTest, options: OpenOptions = {}): Promise<void> {
    this.put = put;
    this.blockedWrites = await openPage(this.page, put, options);
  }

  context(state: string): ScanContext {
    return {
      pageId: this.put.id,
      pageName: this.put.name,
      url: this.put.url,
      state,
      viewport: this.testInfo.project.name,
    };
  }

  /** Runs axe-core against the page as it is right now. `include` narrows it to a subtree. */
  async scan(state: string, options: PublishOptions & { include?: string[] } = {}): Promise<ScanRecord> {
    const outcome = await runAxe(this.page, { include: options.include });
    return this.publish(state, outcome.raw, outcome.coverage, outcome.engine, outcome.scope, options);
  }

  /** Publishes the results of a custom (non-axe) check. */
  async record(state: string, outcome: CheckOutcome, scope: string, options: PublishOptions = {}): Promise<ScanRecord> {
    return this.publish(state, outcome.raw, outcome.coverage, 'custom checks', scope, options);
  }

  /** Sends non-finding evidence (tab order, outlines, comparisons) to the report. */
  async info(topic: string, state: string, data: unknown): Promise<void> {
    const record: InfoRecord = { kind: 'info', topic, context: this.context(state), data };
    await this.testInfo.attach(ATTACH_INFO, { body: JSON.stringify(record), contentType: 'application/json' });
  }

  private async publish(
    state: string,
    raw: RawFinding[],
    coverage: RuleCoverage[],
    engine: string,
    scope: string,
    options: PublishOptions,
  ): Promise<ScanRecord> {
    const context = this.context(state);
    const placements = await annotate(this.page, raw.map((r) => r.target));
    const findings: Finding[] = raw.map((r, i) => {
      const selector = selectorText(r.target);
      return { ...r, selector, ...placements[i], fingerprint: fingerprint(context.pageId, r.ruleId, selector), context };
    });

    if (options.evidence ?? true) await captureEvidence(this.page, findings, context.viewport);

    const record: ScanRecord = { kind: 'scan', context, engine, scope, timestamp: new Date().toISOString(), coverage, findings };
    await this.testInfo.attach(ATTACH_SCAN, { body: JSON.stringify(record), contentType: 'application/json' });

    if (options.gate ?? true) this.gate(findings, state);
    return record;
  }

  /** Soft assertion, so the remaining checks in the test still run and report. */
  private gate(findings: Finding[], state: string): void {
    const blocking = blockingFindings(findings);
    if (blocking.length === 0) return;

    const byRule = new Map<string, Finding[]>();
    for (const f of blocking) byRule.set(f.ruleId, [...(byRule.get(f.ruleId) ?? []), f]);
    const lines = [...byRule.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([ruleId, items]) => `  - ${ruleId} ×${items.length} [${items[0].severity}] WCAG ${items[0].wcag.join(', ') || 'n/a'} — ${items[0].title}`);

    expect
      .soft(
        blocking.length,
        `[${state}] ${blocking.length} accessibility violation(s) at or above "${a11yConfig.failOn}" (${a11yConfig.standard}):\n${lines.join('\n')}\n`,
      )
      .toBe(0);
  }
}

/** Violations of the conformance target at or above the configured severity. */
export function blockingFindings(findings: Finding[]): Finding[] {
  return findings.filter((f) => f.status === 'violation' && (f.level === 'A' || f.level === 'AA') && meetsThreshold(f.severity));
}

export const test = base.extend<{ audit: Audit }>({
  audit: async ({ page }, use, testInfo) => {
    await use(new Audit(page, testInfo));
  },
});

export { expect };
