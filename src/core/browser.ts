import type { Page } from '@playwright/test';
import type { Target } from './findings';

/** Helpers that run inside the page. Installed once per document as `window.__a11y`. */
export interface A11yHelpers {
  visible(el: Element): boolean;
  /** Rendered opacity including ancestors. */
  opacity(el: Element): number;
  target(el: Element): Target;
  snippet(el: Element): string;
  /** Simplified accessible-name computation; good enough for inventories, not a spec implementation. */
  name(el: Element): { name: string; source: string };
  /** Element plus its ancestors, crossing shadow-root boundaries. */
  ancestors(el: Element): Element[];
  /** The visual properties a focus indicator is normally drawn with, including ::before/::after. */
  focusStyle(el: Element): Record<string, string>;
}

declare global {
  interface Window {
    __a11y: A11yHelpers;
  }
}

export async function installHelpers(page: Page): Promise<void> {
  await page.evaluate(() => {
    if (window.__a11y) return;

    const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

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

    const visible = (el: Element): boolean => {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      const cs = getComputedStyle(el);
      return cs.visibility !== 'hidden' && cs.visibility !== 'collapse' && cs.display !== 'none';
    };

    const opacity = (el: Element): number => ancestors(el).reduce((acc, n) => acc * Number(getComputedStyle(n).opacity || 1), 1);

    // Classes that come and go with UI state, or carry generated numbers, make poor anchors.
    const UNSTABLE_CLASS = /^(active|open|opened|selected|current|show|shown|hidden|disabled|focus|hover|loading|loaded|mage-error|_.*|-.*|is-.*|has-.*|ui-state-.*|.*\d{4,}.*)$/;

    /**
     * Path that is unique within the element's own tree (document or shadow root). It is anchored
     * on the nearest ancestor with a unique id or unique class combination, so the same element
     * keeps the same path when something is inserted elsewhere in the page.
     */
    const pathWithin = (el: Element): string => {
      const root = el.getRootNode() as Document | ShadowRoot;
      const uniqueId = (n: Element) => n.id && root.querySelectorAll(`#${CSS.escape(n.id)}`).length === 1;
      const uniqueClasses = (n: Element): string | null => {
        const classes = Array.from(n.classList).filter((c) => !UNSTABLE_CLASS.test(c)).slice(0, 3);
        if (classes.length === 0) return null;
        const selector = `${n.tagName.toLowerCase()}${classes.map((c) => `.${CSS.escape(c)}`).join('')}`;
        return root.querySelectorAll(selector).length === 1 ? selector : null;
      };
      const parts: string[] = [];
      let node: Element | null = el;
      while (node && node !== document.documentElement) {
        if (uniqueId(node)) {
          parts.unshift(`#${CSS.escape(node.id)}`);
          break;
        }
        const byClass = node === document.body ? null : uniqueClasses(node);
        if (byClass) {
          parts.unshift(byClass);
          break;
        }
        if (node === document.body) {
          parts.unshift('body');
          break;
        }
        const tag = node.tagName.toLowerCase();
        const parent: Element | null = node.parentElement;
        if (!parent) {
          parts.unshift(tag);
          break;
        }
        const current: Element = node;
        const same = Array.from(parent.children).filter((c) => c.tagName === current.tagName);
        parts.unshift(same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(current) + 1})` : tag);
        node = parent;
      }
      return parts.join(' > ') || 'html';
    };

    const target = (el: Element): Target => {
      const root = el.getRootNode();
      if (!(root instanceof ShadowRoot)) return [pathWithin(el)];
      const hostPath = target(root.host)[0];
      return [[...(Array.isArray(hostPath) ? hostPath : [hostPath]), pathWithin(el)]];
    };

    const snippet = (el: Element): string => {
      const html = el.outerHTML.replace(/\s+/g, ' ').trim();
      return html.length > 320 ? `${html.slice(0, 320)}…` : html;
    };

    const name = (el: Element): { name: string; source: string } => {
      const labelledby = el.getAttribute('aria-labelledby');
      if (labelledby) {
        const text = clean(labelledby.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' '));
        if (text) return { name: text, source: 'aria-labelledby' };
      }
      const ariaLabel = clean(el.getAttribute('aria-label'));
      if (ariaLabel) return { name: ariaLabel, source: 'aria-label' };

      const tag = el.tagName.toLowerCase();
      if (tag === 'img' || tag === 'area' || (tag === 'input' && (el as HTMLInputElement).type === 'image')) {
        if (el.hasAttribute('alt')) {
          const alt = clean(el.getAttribute('alt'));
          return { name: alt, source: alt ? 'alt' : 'alt (empty)' };
        }
        return { name: clean(el.getAttribute('title')), source: el.getAttribute('title') ? 'title' : 'none' };
      }

      if (tag === 'input' || tag === 'select' || tag === 'textarea') {
        const input = el as HTMLInputElement;
        if (input.id) {
          const label = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
          if (label && clean(label.textContent)) return { name: clean(label.textContent), source: 'label[for]' };
        }
        const wrapping = el.closest('label');
        if (wrapping && clean(wrapping.textContent)) return { name: clean(wrapping.textContent), source: 'wrapping label' };
        if (tag === 'input' && ['submit', 'button', 'reset'].includes(input.type) && input.value) return { name: clean(input.value), source: 'value' };
        const title = clean(el.getAttribute('title'));
        if (title) return { name: title, source: 'title' };
        const placeholder = clean(el.getAttribute('placeholder'));
        if (placeholder) return { name: placeholder, source: 'placeholder' };
        return { name: '', source: 'none' };
      }

      const content = clean((el as HTMLElement).innerText || el.textContent);
      if (content) return { name: content.slice(0, 140), source: 'content' };
      const imgAlt = clean(Array.from(el.querySelectorAll('img[alt]')).map((i) => i.getAttribute('alt')).join(' '));
      if (imgAlt) return { name: imgAlt, source: 'image alt' };
      const title = clean(el.getAttribute('title'));
      if (title) return { name: title, source: 'title' };
      return { name: '', source: 'none' };
    };

    const focusStyle = (el: Element): Record<string, string> => {
      const read = (pseudo?: string) => {
        const cs = getComputedStyle(el, pseudo);
        const v = (prop: string) => cs.getPropertyValue(prop);
        // An outline or border with no width or style paints nothing, whatever its colour says.
        const outline = v('outline-style') === 'none' || parseFloat(v('outline-width')) === 0 ? 'none' : `${v('outline-style')} ${v('outline-width')} ${v('outline-color')} ${v('outline-offset')}`;
        const border = ['top', 'right', 'bottom', 'left']
          .map((side) => (v(`border-${side}-style`) === 'none' || parseFloat(v(`border-${side}-width`)) === 0 ? 'none' : `${v(`border-${side}-width`)} ${v(`border-${side}-style`)} ${v(`border-${side}-color`)}`))
          .join(' / ');
        return {
          outline,
          'box-shadow': v('box-shadow'),
          border,
          background: `${v('background-color')} ${v('background-image')}`,
          color: v('color'),
          'text-decoration': `${v('text-decoration-line')} ${v('text-decoration-color')}`,
          'font-weight': v('font-weight'),
          opacity: v('opacity'),
        };
      };
      const own = read();
      const before = read('::before');
      const after = read('::after');
      const out: Record<string, string> = { ...own };
      for (const [key, value] of Object.entries(before)) out[`::before ${key}`] = value;
      for (const [key, value] of Object.entries(after)) out[`::after ${key}`] = value;
      return out;
    };

    window.__a11y = { visible, opacity, target, snippet, name, ancestors, focusStyle };
  });
}
