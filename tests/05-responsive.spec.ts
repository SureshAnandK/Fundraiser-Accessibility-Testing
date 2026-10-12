import { pages } from '../config/pages';
import { checkReflow, checkTextSpacing, checkZoom } from '../src/checks/responsive';
import { evidencePath } from '../src/core/evidence';
import { test } from '../src/fixtures/a11y.fixture';

/**
 * Layer 3 — low-vision adaptations. People enlarge pages and loosen text spacing; the layout has
 * to survive it. Each test sets its own viewport, so this file runs in the desktop project only.
 */
for (const put of pages) {
  test.describe(`${put.name} — reflow, zoom, text spacing`, () => {
    test('reflow: no horizontal scrolling at 320 CSS px (400% zoom)', async ({ audit, page }, testInfo) => {
      await page.setViewportSize({ width: 320, height: 800 });
      await audit.open(put);
      const reflow = await checkReflow(page);
      const shot = evidencePath(testInfo.project.name, `${put.id}-reflow-320.png`);
      await page.screenshot({ path: shot.absolute, fullPage: true });
      await audit.record('reflow-320', reflow, 'responsive: 320px viewport');
      await audit.info('responsive', 'reflow-320', { ...reflow.measure, screenshot: shot.relative });
    });

    test('zoom: page stays within the viewport at 200%', async ({ audit, page }) => {
      // 200% zoom on a 1366×768 screen leaves a 683×384 CSS-pixel viewport.
      await page.setViewportSize({ width: 683, height: 384 });
      await audit.open(put);
      const zoom = await checkZoom(page);
      await audit.record('zoom-200', zoom, 'responsive: 200% zoom');
      await audit.info('responsive', 'zoom-200', zoom.measure);
    });

    test('text spacing: nothing is clipped with WCAG spacing applied', async ({ audit, page }) => {
      await audit.open(put);
      const spacing = await checkTextSpacing(page);
      await audit.record('text-spacing', spacing, 'responsive: WCAG text spacing');
      await audit.info('responsive', 'text-spacing', { textContainersExamined: spacing.examined, horizontalOverflowAfter: spacing.overflowAfter });
    });
  });
}
