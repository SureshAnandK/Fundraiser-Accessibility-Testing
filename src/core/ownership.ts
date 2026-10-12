import type { Page } from '@playwright/test';
import { a11yConfig } from '../../config/a11y.config';
import { selectorText, type Target } from './findings';

export interface Placement {
  /** Who can fix it: the site, or a third-party vendor. */
  owner: string;
  /** Which part of the page it sits in. */
  region: string;
}

/**
 * Resolves each target back to its element and walks up the tree to find who owns it and
 * where it sits. Elements inside an iframe are attributed by the iframe element itself.
 */
export async function annotate(page: Page, targets: Target[]): Promise<Placement[]> {
  if (targets.length === 0) return [];

  const resolved = await page
    .evaluate(
      ({ targets, owners, regions }) => {
        const ancestors = (el: Element): Element[] => {
          const out: Element[] = [];
          let node: Element | null = el;
          while (node) {
            out.push(node);
            if (node.parentElement) node = node.parentElement;
            else {
              const root = node.getRootNode();
              node = root instanceof ShadowRoot ? root.host : null;
            }
          }
          return out;
        };
        const matches = (el: Element, css: string) => {
          try {
            return el.matches(css);
          } catch {
            return false;
          }
        };
        const resolve = (target: (string | string[])[]): Element | null => {
          const first = target[0];
          try {
            if (!Array.isArray(first)) return document.querySelector(first);
            let root: Document | ShadowRoot | Element = document;
            let el: Element | null = null;
            for (const step of first) {
              el = root.querySelector(step);
              if (!el) return null;
              root = el.shadowRoot ?? el;
            }
            return el;
          } catch {
            return null;
          }
        };

        return targets.map((target) => {
          const el = resolve(target);
          if (!el) return null;
          const chain = ancestors(el);
          let owner: string | null = null;
          let region: string | null = null;
          for (const node of chain) {
            if (!owner) {
              const hit = owners.find((o) => (o.css && matches(node, o.css)) || (o.tag && new RegExp(o.tag, 'i').test(node.tagName)));
              if (hit) owner = hit.owner;
            }
            if (!region) {
              const hit = regions.find((r) => matches(node, r.css));
              if (hit) region = hit.name;
            }
            if (owner && region) break;
          }
          return { owner, region };
        });
      },
      { targets, owners: a11yConfig.owners, regions: a11yConfig.regions },
    )
    .catch(() => targets.map(() => null));

  return targets.map((target, i) => {
    const hit = resolved[i];
    if (hit) return { owner: hit.owner ?? a11yConfig.firstPartyOwner, region: hit.region ?? 'Outside landmarks' };
    // The element is gone (state changed since the scan), so fall back to the selector text.
    const text = selectorText(target);
    const hinted = a11yConfig.owners.find((o) => new RegExp(o.hint, 'i').test(text))?.owner;
    return { owner: hinted ?? a11yConfig.firstPartyOwner, region: 'Unresolved' };
  });
}
