import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FullConfig, Reporter, Suite } from '@playwright/test/reporter';
import { EVIDENCE_DIR, REPORT_DIR } from '../core/evidence';
import { ATTACH_INFO, ATTACH_SCAN, csvCell, type InfoRecord, type ScanRecord } from '../core/findings';
import { renderHtml } from './htmlTemplate';
import { buildModel, type ReportModel, type TestOutcome } from './model';

const ANSI = /\u001b\[[0-9;]*m/g;
const A11Y_GATE = /accessibility violation\(s\)/;

function toCsv(model: ReportModel): string {
  const header = ['bucket', 'severity', 'level', 'wcag', 'rule', 'title', 'owner', 'region', 'selector', 'html', 'why', 'seen_in', 'help', 'page', 'url'];
  const rows = [header.join(',')];
  for (const bucket of ['violation', 'review', 'advisory'] as const) {
    for (const group of model.groups[bucket]) {
      for (const issue of group.issues) {
        const f = issue.finding;
        rows.push(
          [
            bucket,
            f.severity,
            f.level,
            f.wcag.join(' '),
            f.ruleId,
            f.title,
            f.owner,
            f.region,
            f.selector,
            f.html,
            f.failureSummary,
            issue.seenIn.map((s) => `${s.viewport}:${s.state}`).join(' | '),
            f.helpUrl,
            f.context.pageName,
            f.context.url,
          ]
            .map(csvCell)
            .join(','),
        );
      }
    }
  }
  return rows.join('\n');
}

/**
 * Collects the scan and info records every test attached, de-duplicates them into one model,
 * and writes the accessibility report (JSON, CSV, HTML) next to Playwright's own report.
 */
class A11yReporter implements Reporter {
  private suite!: Suite;

  onBegin(_config: FullConfig, suite: Suite): void {
    this.suite = suite;
    rmSync(EVIDENCE_DIR, { recursive: true, force: true });
    mkdirSync(REPORT_DIR, { recursive: true });
  }

  async onEnd(): Promise<void> {
    const scans: ScanRecord[] = [];
    const info: InfoRecord[] = [];
    const tests: TestOutcome[] = [];

    for (const test of this.suite.allTests()) {
      // The last attempt is the one that counts when retries are enabled.
      const result = test.results[test.results.length - 1];
      if (!result) continue;

      const messages = result.errors.map((e) => (e.message ?? '').replace(ANSI, ''));
      const failed = result.status === 'failed' || result.status === 'timedOut' || result.status === 'interrupted';
      tests.push({
        file: path.basename(test.location.file),
        title: test.title,
        project: test.parent.project()?.name ?? '',
        status: result.status,
        kind: result.status === 'skipped' ? 'skipped' : !failed ? 'passed' : messages.length > 0 && messages.every((m) => A11Y_GATE.test(m)) ? 'a11y' : 'error',
        durationMs: result.duration,
        message: messages.join('\n').slice(0, 1500),
      });

      for (const attachment of result.attachments) {
        if (attachment.name !== ATTACH_SCAN && attachment.name !== ATTACH_INFO) continue;
        const body = attachment.body ?? (attachment.path ? readFileSync(attachment.path) : undefined);
        if (!body) continue;
        const record = JSON.parse(body.toString('utf8')) as ScanRecord | InfoRecord;
        if (record.kind === 'scan') scans.push(record);
        else info.push(record);
      }
    }

    if (scans.length === 0 && info.length === 0) return;

    const model = buildModel(scans, info, tests);
    this.write('a11y-results.json', JSON.stringify(model, null, 2));
    // BOM so Excel reads the file as UTF-8.
    this.write('a11y-violations.csv', `﻿${toCsv(model)}`);
    this.write('a11y-report.html', renderHtml(model));

    this.printSummary(model);
  }

  /** A file left open elsewhere (the CSV in Excel, on Windows) is locked; the others are still written. */
  private write(name: string, content: string): void {
    try {
      writeFileSync(path.join(REPORT_DIR, name), content, 'utf8');
    } catch (error) {
      console.warn(`\nCould not write reports/${name}, so it is out of date: ${(error as Error).message}`);
    }
  }

  private printSummary(model: ReportModel): void {
    const t = model.totals;
    const errors = model.tests.filter((x) => x.kind === 'error');
    const lines = [
      '',
      '──────────── Accessibility audit ────────────',
      `Standard        ${model.standard}  (fails on: ${model.failOn})`,
      `Verdict         ${model.verdict === 'fail' ? 'FAILS — blocking violations found' : model.verdict === 'review' ? 'No blocking violations; items need review' : 'No issues detected by automation'}`,
      `Violations      ${t.violationTotal} elements  (critical ${t.violations.critical}, serious ${t.violations.serious}, moderate ${t.violations.moderate}, minor ${t.violations.minor})`,
      `Needs review    ${t.review} elements`,
      `Advisory        ${t.advisory} elements`,
      `Examined        ${t.rulesApplicable} of ${t.rulesRun} rules applied, ${t.elementChecks} element checks, ${t.scans} scans`,
      `Suite health    ${model.tests.length} tests, ${errors.length} suite error(s)`,
      `Report          ${path.join(REPORT_DIR, 'a11y-report.html')}`,
      '──────────────────────────────────────────────',
      '',
    ];
    console.log(lines.join('\n'));
  }
}

export default A11yReporter;
