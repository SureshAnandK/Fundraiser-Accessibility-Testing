import type { Page } from '@playwright/test';
import type { PageType } from '../../config/pages';
import type { CheckOutcome } from '../checks/rules';

export interface StateContext {
  isMobile: boolean;
}

/**
 * A UI state the rules engine cannot see until something opens it. Each state says how to get
 * there, what part of the page to scan once there, and any checks specific to that state.
 */
export interface PageState {
  id: string;
  title: string;
  /** Subtrees to scan with axe-core while the state is active. */
  scope: string[];
  /** False when the page or viewport does not have this state; the test is then skipped. */
  available(page: Page, ctx: StateContext): Promise<boolean>;
  activate(page: Page, ctx: StateContext): Promise<void>;
  /** Read-only checks that need the state still active. Runs before the scan. */
  inspect?(page: Page, ctx: StateContext): Promise<CheckOutcome>;
  /** Checks that drive the page further and may leave the state. Runs after the scan. */
  probe?(page: Page, ctx: StateContext): Promise<CheckOutcome>;
  /** A short description of what is on screen, for states whose content is not fixed. */
  describe?(page: Page): Promise<string>;
}

/** The Fundraiser pages define no interaction states yet; add a set per page type here. */
const STATES: Record<PageType, () => PageState[]> = {
  generic: () => [],
};

export function statesFor(type: PageType): PageState[] {
  return STATES[type]();
}
