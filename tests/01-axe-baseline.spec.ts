import { writeFileSync } from 'node:fs';
import { pages } from '../config/pages';
import { evidencePath } from '../src/core/evidence';
import { test } from '../src/fixtures/a11y.fixture';

/**
 * Layer 1 — the rules engine. Scans the whole page exactly as it first renders.
 */
for (const put of pages) {
  test.describe(put.name, () => {
    test('axe-core scan of the whole page in its initial state', async ({ audit, page }, testInfo) => {
      await audit.open(put);

      const viewport = testInfo.project.name;
      const screenshot = evidencePath(viewport, `${put.id}-initial.png`);
      await page.screenshot({ path: screenshot.absolute, fullPage: true });

      // What assistive technology is given: the accessibility tree, as roles and names.
      const ariaTree = await page.locator('body').ariaSnapshot();
      const ariaFile = evidencePath(viewport, `${put.id}-accessibility-tree.yml`);
      writeFileSync(ariaFile.absolute, ariaTree, 'utf8');

      await audit.info('page-overview', 'initial', {
        title: await page.title(),
        lang: await page.locator('html').getAttribute('lang'),
        screenshot: screenshot.relative,
        accessibilityTree: ariaFile.relative,
        accessibilityTreeLines: ariaTree.split('\n').length,
        accessibilityTreePreview: ariaTree.split('\n').slice(0, 60).join('\n'),
        blockedWrites: audit.blockedWrites,
      });

      await audit.scan('initial');
    });
  });
}
