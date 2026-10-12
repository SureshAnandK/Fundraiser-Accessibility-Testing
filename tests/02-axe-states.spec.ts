import { pages } from '../config/pages';
import type { CheckOutcome } from '../src/checks/rules';
import { evidencePath } from '../src/core/evidence';
import { test } from '../src/fixtures/a11y.fixture';
import { statesFor } from '../src/states/states';

/**
 * Layer 2 — interaction states. A rules engine only sees the DOM in front of it, so each test
 * drives the page into one state (menu open, errors shown) and scans what appeared.
 */
for (const put of pages) {
  const states = statesFor(put.type);
  if (states.length === 0) continue;

  test.describe(`${put.name} — interaction states`, () => {
    for (const state of states) {
      test(`axe-core scan: ${state.title}`, async ({ audit, page, isMobile }, testInfo) => {
        const ctx = { isMobile };
        await audit.open(put);
        test.skip(!(await state.available(page, ctx)), `"${state.id}" is not present on this page at this viewport`);

        await state.activate(page, ctx);

        // Evidence of exactly what was on screen when this state was scanned.
        const shot = evidencePath(testInfo.project.name, `${put.id}-state-${state.id}.png`);
        await page.screenshot({ path: shot.absolute });
        await audit.info('state', state.id, {
          title: state.title,
          screenshot: shot.relative,
          detail: state.describe ? await state.describe(page) : '',
        });

        const outcomes: CheckOutcome[] = [];
        if (state.inspect) outcomes.push(await state.inspect(page, ctx));
        await audit.scan(state.id, { include: state.scope });
        if (state.probe) outcomes.push(await state.probe(page, ctx));

        if (outcomes.length > 0) {
          await audit.record(
            state.id,
            { raw: outcomes.flatMap((o) => o.raw), coverage: outcomes.flatMap((o) => o.coverage) },
            `state checks: ${state.title}`,
          );
        }
      });
    }
  });
}
