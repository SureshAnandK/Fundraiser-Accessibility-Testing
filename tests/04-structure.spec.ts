import { pages } from '../config/pages';
import { inspectStructure } from '../src/checks/structure';
import { test } from '../src/fixtures/a11y.fixture';

/**
 * Layer 3 — structure and meaning. Exports what a screen-reader user navigates by (headings,
 * landmarks, field names, image descriptions) and flags the cases only a person can settle.
 */
for (const put of pages) {
  test.describe(`${put.name} — structure`, () => {
    test('structure: headings, landmarks, images, links, form fields', async ({ audit, page }) => {
      await audit.open(put);
      const structure = await inspectStructure(page);
      await audit.record('initial', structure, 'structure: semantics and naming');
      await audit.info('structure-outline', 'initial', structure.outline);
    });
  });
}
