import type { Page } from '@playwright/test';
import { fundraiserPages } from './fundraiser.pages';

/** Selects which interaction states apply (see src/states). */
export type PageType = 'generic';

export interface PageUnderTest {
  /** Stable id used in fingerprints and file names. */
  id: string;
  name: string;
  url: string;
  type: PageType;
  /** Selectors that must be visible before the page is considered ready to audit. */
  ready: string[];
  /**
   * For a view with no address of its own (a single-page app that routes in memory): the steps
   * a user takes to reach it from `url`. Runs once `url` has loaded, before `ready` is awaited.
   */
  enter?: (page: Page) => Promise<void>;
}

const registry: PageUnderTest[] = [...fundraiserPages];

/** A11Y_URLS="https://a,https://b" audits ad-hoc pages with the generic checks only. */
function adHocPages(): PageUnderTest[] {
  const raw = process.env.A11Y_URLS;
  if (!raw) return [];
  return raw
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean)
    .map((url, i) => ({
      id: `adhoc-${i + 1}-${new URL(url).pathname.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 40) || 'home'}`,
      name: url,
      url,
      type: 'generic' as const,
      ready: ['body'],
    }));
}

export const pages: PageUnderTest[] = process.env.A11Y_URLS ? adHocPages() : registry;
