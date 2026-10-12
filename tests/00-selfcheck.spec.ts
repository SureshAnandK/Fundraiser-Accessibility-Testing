import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { checkErrorMessages } from '../src/checks/forms';
import { checkSkipLinks, findUnreachableControls, tabWalk } from '../src/checks/keyboard';
import { checkReflow, checkTextSpacing } from '../src/checks/responsive';
import { inspectStructure } from '../src/checks/structure';
import { runAxe } from '../src/core/axeScanner';
import type { RawFinding } from '../src/core/findings';

/**
 * Tests the tests. A clean accessibility result is only worth something if the checks would
 * have caught a defect had there been one. These two fixture pages prove both directions:
 * every planted defect is reported, and an accessible page reports nothing.
 */
const fixture = (name: string) => pathToFileURL(path.join(__dirname, 'fixtures', name)).href;

/** Rule that must fire for each defect planted in known-bad.html. */
const PLANTED: Record<string, string> = {
  'image-alt': 'image with no alt attribute',
  label: 'input with no label',
  'color-contrast': 'text below 4.5:1 contrast',
  'button-name': 'button with no accessible name',
  'html-has-lang': 'missing page language',
  'kbd-focus-trap': 'input that swallows the Tab key',
  'kbd-focus-not-visible': 'link with its focus ring removed',
  'kbd-mouse-only': 'clickable div that is not a control',
  'kbd-not-focusable': 'role="button" outside the tab order',
  'kbd-skip-link-broken': 'skip link pointing at a missing target',
  'img-alt-filename': 'alt text that is a file name',
  'heading-visual-only': 'bold paragraph used as a heading',
  'tab-selected-state': 'active tab with aria-selected="false"',
  'error-not-associated': 'error message not tied to its field',
  'text-spacing-clipped': 'text clipped under WCAG text spacing',
  'reflow-horizontal-scroll': 'fixed-width block wider than 320px',
};

async function runEverything(page: Page): Promise<{ findings: RawFinding[]; walkCompleted: boolean }> {
  const walk = await tabWalk(page);
  const findings = [
    ...(await runAxe(page)).raw,
    ...walk.raw,
    ...(await findUnreachableControls(page)).raw,
    ...(await checkSkipLinks(page, walk.stops)).raw,
    ...(await inspectStructure(page)).raw,
    ...(await checkErrorMessages(page, 'body')).raw,
    ...(await checkTextSpacing(page)).raw,
  ];
  await page.setViewportSize({ width: 320, height: 800 });
  findings.push(...(await checkReflow(page)).raw);
  return { findings, walkCompleted: walk.completed };
}

test.describe('Detector self-check', () => {
  test('every planted defect is reported', async ({ page }) => {
    await page.goto(fixture('known-bad.html'));
    const { findings } = await runEverything(page);
    const reported = new Set(findings.map((f) => f.ruleId));

    for (const [ruleId, defect] of Object.entries(PLANTED)) {
      expect.soft(reported.has(ruleId), `planted defect not detected: ${defect} (rule ${ruleId})`).toBe(true);
    }
  });

  test('an accessible page reports nothing', async ({ page }) => {
    await page.goto(fixture('known-good.html'));
    const { findings, walkCompleted } = await runEverything(page);

    const summary = findings.map((f) => `${f.status} ${f.ruleId}: ${f.failureSummary}`);
    expect.soft(summary, 'no finding of any kind on the accessible fixture').toEqual([]);
    expect.soft(walkCompleted, 'the tab walk goes all the way round the page').toBe(true);
  });
});
