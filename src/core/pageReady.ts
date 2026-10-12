import type { Page } from '@playwright/test';
import type { PageUnderTest } from '../../config/pages';
import { installHelpers } from './browser';

export interface OpenOptions {
  /** Extra selectors to wait for, on top of the page's own readiness signals. */
  waitFor?: string[];
}

const READ_ONLY_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** example.com from www.example.com. Good enough for single-label TLDs. */
function siteDomain(url: string): string {
  return new URL(url).hostname.split('.').slice(-2).join('.');
}

/**
 * The suite audits a live site, so it must never change anything there. Every non-GET request
 * to the site's own domain is aborted; the list of what was stopped is returned for the record.
 */
async function guardWrites(page: Page, url: string, blocked: string[]): Promise<void> {
  const domain = siteDomain(url);
  await page.route('**/*', (route) => {
    const request = route.request();
    if (!READ_ONLY_METHODS.has(request.method())) {
      const host = new URL(request.url()).hostname;
      if (host === domain || host.endsWith(`.${domain}`)) {
        blocked.push(`${request.method()} ${request.url().split('?')[0]}`);
        return route.abort('blockedbyclient');
      }
    }
    return route.fallback();
  });
}

/** Scrolls through the page once so lazy-loaded images and widgets are present for the scan. */
async function loadLazyContent(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const step = Math.max(400, Math.floor(window.innerHeight * 0.8));
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    window.scrollTo(0, 0);
  });
}

/**
 * Getting to a view leaves the pointer and keyboard focus on whatever was clicked last, and Tab
 * would carry on from there. Both go back to where they are on a freshly loaded page.
 */
async function startFromTheTop(page: Page): Promise<void> {
  await page.mouse.move(0, 0);
  // Chromium keeps its place where a focused node used to be, so the next Tab starts at the top.
  await page.evaluate(() => {
    const top = document.createElement('span');
    top.tabIndex = -1;
    document.body.prepend(top);
    top.focus({ preventScroll: true });
    top.remove();
  });
}

export async function openPage(page: Page, put: PageUnderTest, options: OpenOptions = {}): Promise<string[]> {
  const blockedWrites: string[] = [];
  // A test may open the page more than once; each load starts from a fresh set of routes.
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await guardWrites(page, put.url, blockedWrites);

  const response = await page.goto(put.url, { waitUntil: 'domcontentloaded' });
  if (!response || response.status() >= 400) {
    throw new Error(`Could not open ${put.url}: HTTP ${response?.status() ?? 'no response'}`);
  }

  await put.enter?.(page);

  for (const selector of [...put.ready, ...(options.waitFor ?? [])]) {
    await page.locator(selector).first().waitFor({ state: 'visible', timeout: 45_000 });
  }

  await loadLazyContent(page);
  await page.evaluate(() => document.fonts.ready.then(() => true)).catch(() => {});
  // Trackers can keep the network busy indefinitely, so this is a bounded settle, not a requirement.
  await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});
  await page.evaluate(() => window.scrollTo(0, 0));
  if (put.enter) await startFromTheTop(page);
  await installHelpers(page);
  return blockedWrites;
}
