import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import type { FrameLocator, Locator, Page } from '@playwright/test';
import { a11yConfig } from '../../config/a11y.config';
import type { Finding, Target } from './findings';

export const REPORT_DIR = path.resolve(__dirname, '../../reports');
export const EVIDENCE_DIR = path.join(REPORT_DIR, 'evidence');

const PADDING = 56;

function locate(page: Page, target: Target): Locator {
  const css = (part: string | string[]) => (Array.isArray(part) ? part.join(' >> ') : part);
  let scope: Page | FrameLocator = page;
  for (const hop of target.slice(0, -1)) scope = scope.frameLocator(css(hop));
  return scope.locator(css(target[target.length - 1])).first();
}

export function evidencePath(viewport: string, name: string): { absolute: string; relative: string } {
  const dir = path.join(EVIDENCE_DIR, viewport);
  mkdirSync(dir, { recursive: true });
  return { absolute: path.join(dir, name), relative: `evidence/${viewport}/${name}` };
}

/** Screenshot of the element with surrounding context and a highlight box around it. */
async function shoot(page: Page, target: Target, file: string): Promise<boolean> {
  const locator = locate(page, target);
  await locator.scrollIntoViewIfNeeded({ timeout: 1500 });
  const box = await locator.boundingBox({ timeout: 1500 });
  const viewport = page.viewportSize();
  if (!box || !viewport || box.width < 1 || box.height < 1) return false;

  const x = Math.max(0, box.x - PADDING);
  const y = Math.max(0, box.y - PADDING);
  const clip = {
    x,
    y,
    width: Math.min(viewport.width, box.x + box.width + PADDING) - x,
    height: Math.min(viewport.height, box.y + box.height + PADDING) - y,
  };
  if (clip.width < 4 || clip.height < 4) return false;

  await page.evaluate(([left, top, width, height]) => {
    const marker = document.createElement('div');
    marker.id = '__a11y_highlight';
    marker.style.cssText = `position:fixed;left:${left - 3}px;top:${top - 3}px;width:${width}px;height:${height}px;border:3px solid #d6006c;box-shadow:0 0 0 2px #fff;z-index:2147483647;pointer-events:none;box-sizing:content-box;`;
    document.documentElement.appendChild(marker);
  }, [box.x, box.y, box.width, box.height]);
  try {
    await page.screenshot({ path: file, clip, timeout: 5000 });
  } finally {
    await page.evaluate(() => document.getElementById('__a11y_highlight')?.remove());
  }
  return true;
}

/**
 * Captures a screenshot for the first few violating elements of each rule. Files are named by
 * fingerprint, so an issue already captured at this viewport by an earlier scan is reused.
 */
export async function captureEvidence(page: Page, findings: Finding[], viewport: string): Promise<void> {
  const max = a11yConfig.evidence.maxPerRule;
  const perRule = new Map<string, { captured: number; attempts: number }>();
  let moved = false;

  for (const finding of findings) {
    if (finding.status !== 'violation') continue;
    const file = evidencePath(viewport, `${finding.fingerprint}.png`);
    if (existsSync(file.absolute)) {
      finding.screenshot = file.relative;
      continue;
    }
    // Hidden elements cannot be photographed; cap the attempts so they do not stall the run.
    const tally = perRule.get(finding.ruleId) ?? { captured: 0, attempts: 0 };
    perRule.set(finding.ruleId, tally);
    if (tally.captured >= max || tally.attempts >= max * 2) continue;
    tally.attempts++;

    moved = true;
    const captured = await shoot(page, finding.target, file.absolute).catch(() => false);
    if (captured) {
      tally.captured++;
      finding.screenshot = file.relative;
    }
  }

  if (moved) await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
}
