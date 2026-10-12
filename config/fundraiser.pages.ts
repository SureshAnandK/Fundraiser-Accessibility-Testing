import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Page } from '@playwright/test';
import type { PageUnderTest } from './pages';

/**
 * University of Andhra Fundraiser, the demo app published at
 * https://claude.ai/artifact/W23vVBQYz3mzXN6Rk2guFe.
 *
 * The suite audits the copy in demo/fundraiser/index.html, not that link. On claude.ai the app
 * runs inside a cross-origin frame of Claude's own page, the frame cannot be opened by itself,
 * and an automated browser is served a bot check instead. The copy is the document that frame
 * serves; save it again whenever the artifact is republished.
 *
 * The app is a single page that routes in memory: the address never changes, so every view is
 * reached the way a user reaches it, by following links from the home view.
 */
const url = pathToFileURL(path.resolve(__dirname, '../demo/fundraiser/index.html')).href;

/** The project the detail, donation and thank-you views are opened for. */
const PROJECT = '50101';

/** The header links collapse behind a Menu button on narrow viewports. */
async function followHeaderLink(page: Page, href: string): Promise<void> {
  const menu = page.locator('.nav-toggle');
  if (await menu.isVisible()) await menu.click();
  await page.locator(`#site-nav a[href="${href}"]`).click();
}

async function openDonationForm(page: Page): Promise<void> {
  await page.locator(`.project-tile__give-btn[href="/project/${PROJECT}/donate"]`).click();
  await page.locator('#donate-form').waitFor({ state: 'visible' });
}

/** The gift is recorded in the page's memory only; the app has no server and takes no payment. */
async function giveSampleGift(page: Page): Promise<void> {
  await openDonationForm(page);
  await page.locator('#email').fill('test.donor@example.com');
  await page.locator('#firstName').fill('Test');
  await page.locator('#lastName').fill('Donor');
  await page.locator('#address1').fill('1 Example Street');
  await page.locator('#city').fill('Visakhapatnam');
  await page.locator('#zip').fill('530003');
  await page.locator('input[name="affiliation"]').first().check();
  await page.locator('.js-donate-button').click();
}

export const fundraiserPages: PageUnderTest[] = [
  {
    id: 'fundraiser-home',
    name: 'Fundraiser: Projects (home)',
    url,
    type: 'generic',
    ready: ['#project-grid .project-tile'],
  },
  {
    id: 'fundraiser-project',
    name: 'Fundraiser: Project detail',
    url,
    type: 'generic',
    ready: ['#tab-panel'],
    enter: (page) => page.locator(`.project-tile__title a[href="/project/${PROJECT}"]`).click(),
  },
  {
    id: 'fundraiser-donate',
    name: 'Fundraiser: Donation form',
    url,
    type: 'generic',
    ready: ['#donate-form'],
    enter: openDonationForm,
  },
  {
    id: 'fundraiser-thanks',
    name: 'Fundraiser: Thank-you receipt',
    url,
    type: 'generic',
    ready: ['.thanks .receipt'],
    enter: giveSampleGift,
  },
  {
    id: 'fundraiser-about',
    name: 'Fundraiser: About',
    url,
    type: 'generic',
    ready: ['.feature-grid'],
    enter: (page) => followHeaderLink(page, '/about'),
  },
  {
    id: 'fundraiser-faq',
    name: 'Fundraiser: FAQ',
    url,
    type: 'generic',
    ready: ['#app details'],
    enter: (page) => followHeaderLink(page, '/faq'),
  },
];
