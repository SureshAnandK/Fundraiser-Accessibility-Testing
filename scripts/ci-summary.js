// Writes a short markdown summary of a run to the GitHub Actions job summary (stdout when run locally).
// Usage: node scripts/ci-summary.js audit|narration   (after the tests have written reports/)
const { appendFileSync, existsSync, readFileSync, readdirSync } = require('node:fs');
const path = require('node:path');

const reports = path.resolve(__dirname, '../reports');
const out = [];

const cell = (text) => String(text).replace(/\|/g, '\\|');
const table = (header, rows) => [`| ${header.join(' | ')} |`, `|${header.map(() => '---').join('|')}|`, ...rows.map((row) => `| ${row.map(cell).join(' | ')} |`)].join('\n');
const minutes = (ms) => `${Math.floor(ms / 60_000)}:${String(Math.floor((ms / 1000) % 60)).padStart(2, '0')}`;

function audit() {
  out.push('## Accessibility audit');
  const file = path.join(reports, 'a11y-results.json');
  if (!existsSync(file)) {
    out.push('No report was produced: the suite stopped before the audit finished. See the test log.');
    return;
  }
  const model = JSON.parse(readFileSync(file, 'utf8'));
  const t = model.totals;
  const verdict = { fail: 'Fails: blocking violations found', review: 'No blocking violations; items need review', pass: 'No issues detected by automation' }[model.verdict];
  const errors = model.tests.filter((x) => x.kind === 'error').length;
  out.push(
    `**${verdict}**`,
    '',
    `${model.standard}, failing on \`${model.failOn}\` and above. ${t.violationTotal} violating element(s) ` +
      `(critical ${t.violations.critical}, serious ${t.violations.serious}, moderate ${t.violations.moderate}, minor ${t.violations.minor}), ` +
      `${t.review} to review, ${t.advisory} advisory. ${model.tests.length} tests, ${errors} suite error(s).`,
    '',
    table(['Page', 'Violations', 'Needs review', 'Advisory'], model.byPage.map((p) => [p.name, p.violation, p.review, p.advisory])),
    '',
    'The full report is in the `accessibility-report` artifact: open `a11y-report.html`.',
  );
}

function narration() {
  out.push('## Narrated keyboard walk');
  // Dot folders hold the audio cache and Playwright output; selfcheck-* are the fixtures that prove the narration.
  const dirs = existsSync(path.join(reports, 'narration'))
    ? readdirSync(path.join(reports, 'narration'), { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('.') && !d.name.startsWith('selfcheck-'))
    : [];
  const rows = [];
  for (const dir of dirs) {
    const file = path.join(reports, 'narration', dir.name, 'transcript.json');
    if (!existsSync(file)) continue;
    const t = JSON.parse(readFileSync(file, 'utf8'));
    const last = t.rows.length ? t.rows[t.rows.length - 1].endMs : 0;
    rows.push([t.page, t.stops, t.silentStops, minutes(last), t.completed ? 'yes' : 'no']);
  }
  if (!rows.length) {
    out.push('No video was produced. See the test log.');
    return;
  }
  out.push(
    table(['Page', 'Tab stops', 'Nothing to announce', 'Length', 'Full walk'], rows),
    '',
    `Voice: ${JSON.parse(readFileSync(path.join(reports, 'narration', dirs[0].name, 'transcript.json'), 'utf8')).voice}. The videos are in the \`narration-videos\` artifact.`,
  );
}

const mode = process.argv[2];
if (mode === 'audit') audit();
else if (mode === 'narration') narration();
else {
  console.error('Usage: node scripts/ci-summary.js audit|narration');
  process.exit(2);
}

const text = `${out.join('\n')}\n`;
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
else process.stdout.write(text);
