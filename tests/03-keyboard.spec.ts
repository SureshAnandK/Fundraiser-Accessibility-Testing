import { pages } from '../config/pages';
import { checkSkipLinks, findUnreachableControls, tabWalk } from '../src/checks/keyboard';
import { test } from '../src/fixtures/a11y.fixture';

/**
 * Layer 3 — behaviour. Uses the page the way a keyboard-only user does. None of this is visible
 * to a rules engine: it has to be done with real key presses in a real browser.
 */
for (const put of pages) {
  test.describe(`${put.name} — keyboard`, () => {
    test('keyboard: tab order, focus visibility, traps, skip links', async ({ audit, page }) => {
      await audit.open(put);

      const walk = await test.step('walk the page with Tab', () => tabWalk(page));
      await audit.record('initial', walk, 'keyboard: every tab stop');
      await audit.info('tab-order', 'initial', {
        completed: walk.completed,
        trapped: walk.trappedAt ? walk.trappedAt.index : null,
        endedInFrame: walk.endedInFrame ? walk.endedInFrame.name : null,
        stops: walk.stops.map((s) => ({
          index: s.index,
          role: s.role || s.tag,
          name: s.name.slice(0, 80),
          indicator: s.indicator,
          indicatorDetail: s.indicatorDetail,
          measuredOn: s.measuredOn,
          visible: s.visible && s.inViewport,
          obscuredBy: s.obscuredBy,
          isFrame: s.isFrame,
          presses: s.presses,
        })),
      });

      const unreachable = await test.step('look for mouse-only controls', () => findUnreachableControls(page));
      await audit.record('initial', unreachable, 'keyboard: controls outside the tab order');

      const skip = await test.step('activate the skip links', () => checkSkipLinks(page, walk.stops));
      await audit.record('initial', skip, 'keyboard: skip links');
      await audit.info('skip-links', 'initial', skip.links);
    });
  });
}
