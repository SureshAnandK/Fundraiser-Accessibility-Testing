// An accessibility report has to be accessible itself. Scans reports/a11y-report.html with
// axe-core in light and dark colour schemes, with every collapsible section expanded.
// Usage: npm run check:report   (after a test run has produced the report)
const path = require('node:path');
const { existsSync } = require('node:fs');
const { pathToFileURL } = require('node:url');
const { chromium } = require('@playwright/test');
const { default: AxeBuilder } = require('@axe-core/playwright');

const report = path.resolve(__dirname, '../reports/a11y-report.html');

(async () => {
  if (!existsSync(report)) {
    console.error(`No report at ${report}. Run "npm test" first.`);
    process.exit(2);
  }

  const browser = await chromium.launch();
  let failures = 0;

  for (const colorScheme of ['light', 'dark']) {
    const context = await browser.newContext({ colorScheme, viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await page.goto(pathToFileURL(report).href);
    // Content inside a closed <details> is not rendered, so axe would skip it.
    await page.evaluate(() => document.querySelectorAll('details').forEach((d) => (d.open = true)));

    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']).analyze();
    const checked = results.passes.reduce((sum, rule) => sum + rule.nodes.length, 0);
    console.log(`\n${colorScheme}: ${results.violations.length} rule(s) violated, ${results.passes.length} rules passed on ${checked} element checks`);
    for (const rule of results.violations) {
      failures += rule.nodes.length;
      console.log(`  [${rule.impact}] ${rule.id} x${rule.nodes.length}: ${rule.help}`);
      for (const node of rule.nodes.slice(0, 3)) console.log(`      ${node.target.join(' ')}\n      ${(node.failureSummary || '').replace(/\s+/g, ' ').slice(0, 220)}`);
    }
    await context.close();
  }

  await browser.close();
  console.log(failures ? `\nReport has ${failures} accessibility failure(s).` : '\nReport is clean in both colour schemes.');
  process.exit(failures ? 1 : 0);
})();
