import { a11yConfig, meetsThreshold, SEVERITY_ORDER, type Severity } from '../../config/a11y.config';
import type { Finding, InfoRecord, ScanRecord, Source } from '../core/findings';
import { compareCriteria, criterionLevel, criterionName, type Level } from '../core/wcag';

/**
 * violation = fails the conformance target (WCAG A/AA).
 * review    = a person has to confirm it (WCAG A/AA).
 * advisory  = best practice or AAA; never fails the run.
 */
export type Bucket = 'violation' | 'review' | 'advisory';

export interface Sighting {
  state: string;
  viewport: string;
}

/** One element failing one rule, de-duplicated across states and viewports. */
export interface Issue {
  fingerprint: string;
  finding: Finding;
  bucket: Bucket;
  seenIn: Sighting[];
}

export interface RuleGroup {
  ruleId: string;
  title: string;
  description: string;
  helpUrl: string;
  source: Source;
  bucket: Bucket;
  level: Level;
  wcag: string[];
  severity: Severity;
  issues: Issue[];
}

export interface CoverageRow {
  source: Source;
  ruleId: string;
  title: string;
  wcag: string[];
  level: Level;
  /** Elements examined in the largest single scan. */
  checked: number;
  passed: number;
  /** Unique failing elements across all scans. */
  failed: number;
  review: number;
  /** Scans in which the rule had something to examine. */
  scans: number;
  inapplicable: boolean;
}

export interface TestOutcome {
  file: string;
  title: string;
  project: string;
  status: string;
  /** a11y = failed on an accessibility gate; error = the suite itself broke. */
  kind: 'passed' | 'a11y' | 'error' | 'skipped';
  durationMs: number;
  message: string;
}

export interface ReportModel {
  generatedAt: string;
  standard: string;
  failOn: string;
  engines: string[];
  pages: { id: string; name: string; url: string }[];
  viewports: string[];
  states: string[];
  verdict: 'fail' | 'review' | 'pass';
  totals: {
    blocking: number;
    violations: Record<Severity, number>;
    violationTotal: number;
    review: number;
    advisory: number;
    rulesRun: number;
    rulesApplicable: number;
    elementChecks: number;
    scans: number;
  };
  groups: Record<Bucket, RuleGroup[]>;
  byCriterion: { sc: string; name: string; level: Level; rules: number; elements: number; worst: Severity }[];
  byOwner: { owner: string; violation: number; review: number; advisory: number }[];
  byRegion: { region: string; violation: number; review: number }[];
  /** In the order the pages were audited. */
  byPage: { id: string; name: string; violation: number; review: number; advisory: number }[];
  coverage: CoverageRow[];
  info: InfoRecord[];
  scans: { context: ScanRecord['context']; engine: string; scope: string; findings: number }[];
  tests: TestOutcome[];
}

function bucketOf(finding: Finding): Bucket {
  if (finding.level !== 'A' && finding.level !== 'AA') return 'advisory';
  return finding.status === 'violation' ? 'violation' : 'review';
}

const rank = (severity: Severity) => SEVERITY_ORDER.indexOf(severity);

function group(issues: Issue[]): RuleGroup[] {
  const groups = new Map<string, RuleGroup>();
  for (const issue of issues) {
    const f = issue.finding;
    const key = `${issue.bucket}|${f.ruleId}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        ruleId: f.ruleId,
        title: f.title,
        description: f.description,
        helpUrl: f.helpUrl,
        source: f.source,
        bucket: issue.bucket,
        level: f.level,
        wcag: f.wcag,
        severity: f.severity,
        issues: [],
      };
      groups.set(key, g);
    }
    if (rank(f.severity) > rank(g.severity)) g.severity = f.severity;
    g.issues.push(issue);
  }
  return [...groups.values()].sort((a, b) => rank(b.severity) - rank(a.severity) || b.issues.length - a.issues.length);
}

export function buildModel(scans: ScanRecord[], info: InfoRecord[], tests: TestOutcome[]): ReportModel {
  // ---- de-duplicate findings into issues ----
  const issues = new Map<string, Issue>();
  for (const scan of scans) {
    for (const finding of scan.findings) {
      const sighting: Sighting = { state: finding.context.state, viewport: finding.context.viewport };
      const existing = issues.get(finding.fingerprint);
      if (!existing) {
        issues.set(finding.fingerprint, {
          fingerprint: finding.fingerprint,
          finding,
          bucket: bucketOf(finding),
          seenIn: [sighting],
        });
        continue;
      }
      if (!existing.seenIn.some((s) => s.state === sighting.state && s.viewport === sighting.viewport)) {
        existing.seenIn.push(sighting);
      }
      // A definite violation outranks an "uncertain" sighting of the same element.
      if (finding.status === 'violation' && existing.finding.status !== 'violation') {
        existing.finding = { ...finding, screenshot: finding.screenshot ?? existing.finding.screenshot };
        existing.bucket = bucketOf(finding);
      } else if (!existing.finding.screenshot && finding.screenshot) {
        existing.finding.screenshot = finding.screenshot;
      }
    }
  }

  const all = [...issues.values()];
  const inBucket = (bucket: Bucket) => all.filter((i) => i.bucket === bucket);

  // ---- totals ----
  const violations: Record<Severity, number> = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  for (const issue of inBucket('violation')) violations[issue.finding.severity]++;
  const blocking = inBucket('violation').filter((i) => meetsThreshold(i.finding.severity)).length;

  // ---- by WCAG criterion (violations only) ----
  const criteria = new Map<string, { rules: Set<string>; elements: number; worst: Severity }>();
  for (const issue of inBucket('violation')) {
    for (const sc of issue.finding.wcag) {
      const entry = criteria.get(sc) ?? { rules: new Set<string>(), elements: 0, worst: 'minor' as Severity };
      entry.rules.add(issue.finding.ruleId);
      entry.elements++;
      if (rank(issue.finding.severity) > rank(entry.worst)) entry.worst = issue.finding.severity;
      criteria.set(sc, entry);
    }
  }

  // ---- by owner / region ----
  const owners = new Map<string, { violation: number; review: number; advisory: number }>();
  const regions = new Map<string, { violation: number; review: number }>();
  for (const issue of all) {
    const o = owners.get(issue.finding.owner) ?? { violation: 0, review: 0, advisory: 0 };
    o[issue.bucket]++;
    owners.set(issue.finding.owner, o);
    if (issue.bucket !== 'advisory') {
      const r = regions.get(issue.finding.region) ?? { violation: 0, review: 0 };
      r[issue.bucket]++;
      regions.set(issue.finding.region, r);
    }
  }

  // ---- coverage: what each rule examined ----
  const coverage = new Map<string, CoverageRow>();
  for (const scan of scans) {
    for (const entry of scan.coverage) {
      const checked = entry.passed + entry.failed + entry.review;
      let row = coverage.get(entry.ruleId);
      if (!row) {
        row = { source: entry.source, ruleId: entry.ruleId, title: entry.title, wcag: entry.wcag, level: entry.level, checked: 0, passed: 0, failed: 0, review: 0, scans: 0, inapplicable: true };
        coverage.set(entry.ruleId, row);
      }
      if (checked > 0) {
        row.scans++;
        row.inapplicable = false;
      }
      if (checked > row.checked) {
        row.checked = checked;
        row.passed = entry.passed;
      }
    }
  }
  for (const issue of all) {
    const row = coverage.get(issue.finding.ruleId);
    if (!row) continue;
    if (issue.finding.status === 'violation') row.failed++;
    else row.review++;
  }
  const coverageRows = [...coverage.values()].sort(
    (a, b) => Number(a.inapplicable) - Number(b.inapplicable) || b.failed - a.failed || b.review - a.review || b.checked - a.checked || a.ruleId.localeCompare(b.ruleId),
  );

  const unique = <T>(values: T[]) => [...new Set(values)];
  const pageMap = new Map(scans.map((s) => [s.context.pageId, { id: s.context.pageId, name: s.context.pageName, url: s.context.url }]));
  const byPage = [...pageMap.values()].map(({ id, name }) => {
    const count = (bucket: Bucket) => all.filter((i) => i.bucket === bucket && i.finding.context.pageId === id).length;
    return { id, name, violation: count('violation'), review: count('review'), advisory: count('advisory') };
  });
  const violationTotal = inBucket('violation').length;

  return {
    generatedAt: new Date().toISOString(),
    standard: a11yConfig.standard,
    failOn: a11yConfig.failOn,
    engines: unique(scans.map((s) => s.engine)).filter((e) => e.startsWith('axe')),
    pages: [...pageMap.values()],
    viewports: unique(scans.map((s) => s.context.viewport)),
    states: unique(scans.map((s) => s.context.state)),
    verdict: blocking > 0 ? 'fail' : violationTotal + inBucket('review').length > 0 ? 'review' : 'pass',
    totals: {
      blocking,
      violations,
      violationTotal,
      review: inBucket('review').length,
      advisory: inBucket('advisory').length,
      rulesRun: coverageRows.length,
      rulesApplicable: coverageRows.filter((r) => !r.inapplicable).length,
      elementChecks: coverageRows.reduce((sum, r) => sum + r.checked, 0),
      scans: scans.length,
    },
    groups: {
      violation: group(inBucket('violation')),
      review: group(inBucket('review')),
      advisory: group(inBucket('advisory')),
    },
    byCriterion: [...criteria.entries()]
      .map(([sc, v]) => ({ sc, name: criterionName(sc), level: criterionLevel(sc), rules: v.rules.size, elements: v.elements, worst: v.worst }))
      .sort((a, b) => compareCriteria(a.sc, b.sc)),
    byOwner: [...owners.entries()].map(([owner, v]) => ({ owner, ...v })).sort((a, b) => b.violation - a.violation || b.review - a.review),
    byRegion: [...regions.entries()].map(([region, v]) => ({ region, ...v })).sort((a, b) => b.violation - a.violation || b.review - a.review),
    byPage,
    coverage: coverageRows,
    info,
    scans: scans.map((s) => ({ context: s.context, engine: s.engine, scope: s.scope, findings: s.findings.length })),
    tests,
  };
}
