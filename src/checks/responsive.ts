import type { Page } from '@playwright/test';
import { installHelpers } from '../core/browser';
import { coverage, finding, type CheckOutcome, type ElementRef, type RuleId } from './rules';

export interface OverflowMeasure {
  viewportWidth: number;
  contentWidth: number;
  /** Pixels of horizontal scroll. 0 means the page fits. */
  overflow: number;
  /** The page hides horizontal overflow instead of scrolling. */
  clipsOverflow: boolean;
}

interface Offender extends ElementRef {
  right: number;
  width: number;
}

/**
 * Measures horizontal overflow at the current viewport. If the page scrolls sideways it names
 * the elements responsible; if it hides the overflow instead, it names what is being cut off.
 */
async function measureOverflow(page: Page): Promise<OverflowMeasure & { offenders: Offender[] }> {
  await installHelpers(page);
  return page.evaluate(() => {
    const h = window.__a11y;
    const root = document.documentElement;
    const viewportWidth = root.clientWidth;
    const contentWidth = Math.max(root.scrollWidth, document.body.scrollWidth);
    const hides = (el: Element) => ['hidden', 'clip'].includes(getComputedStyle(el).overflowX);
    const managesOwnScroll = (el: Element) => ['hidden', 'clip', 'auto', 'scroll'].includes(getComputedStyle(el).overflowX);

    const sticksOut = (el: Element) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.right > viewportWidth + 1 && r.left < viewportWidth && h.visible(el);
    };
    // Carousels and scrollable tables overflow on purpose inside their own container.
    const insideScroller = (el: Element) => h.ancestors(el).slice(1).some((a) => a !== document.body && a !== root && managesOwnScroll(a));

    const offenders = Array.from(document.querySelectorAll('body *'))
      .filter((el) => sticksOut(el) && !insideScroller(el) && !Array.from(el.children).some(sticksOut))
      .slice(0, 8)
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { target: h.target(el), html: h.snippet(el), right: Math.round(r.right), width: Math.round(r.width) };
      });

    return {
      viewportWidth,
      contentWidth,
      overflow: Math.max(0, contentWidth - viewportWidth),
      clipsOverflow: hides(root) || hides(document.body),
      offenders,
    };
  });
}

/**
 * WCAG 1.4.10 Reflow: at 320 CSS px wide, content must be usable without scrolling in two
 * directions. The caller sets the viewport before loading the page.
 */
export async function checkReflow(page: Page): Promise<CheckOutcome & { measure: OverflowMeasure }> {
  const { offenders, ...measure } = await measureOverflow(page);
  const scrolls = measure.overflow > 1;

  return {
    measure,
    raw: scrolls
      ? (offenders.length ? offenders : [{ target: ['body'], html: '<body>', right: measure.contentWidth, width: measure.contentWidth }]).map((o) =>
          finding('reflow-horizontal-scroll', o, `Page is ${measure.contentWidth}px wide in a ${measure.viewportWidth}px viewport. This element extends to ${o.right}px.`),
        )
      : offenders.map((o) => finding('reflow-clipped-content', o, `Element extends to ${o.right}px in a ${measure.viewportWidth}px viewport and the page does not scroll sideways, so the part past the edge cannot be reached.`)),
    coverage: [coverage('reflow-horizontal-scroll', 1, scrolls ? 1 : 0), coverage('reflow-clipped-content', 1, !scrolls && offenders.length ? 1 : 0)],
  };
}

/** WCAG 1.4.4 Resize Text: the same measurement at a viewport equivalent to 200% zoom. */
export async function checkZoom(page: Page): Promise<CheckOutcome & { measure: OverflowMeasure }> {
  const { offenders, ...measure } = await measureOverflow(page);
  const rule: RuleId = 'zoom-200-overflow';
  const problem = measure.overflow > 1 || offenders.length > 0;
  const fallback = [{ target: ['body'] as string[], html: '<body>', right: measure.contentWidth, width: measure.contentWidth }];
  return {
    measure,
    raw: problem
      ? (offenders.length ? offenders : fallback).map((o) =>
          finding(rule, o, `At 200% zoom the page is ${measure.contentWidth}px wide in a ${measure.viewportWidth}px viewport; this element extends to ${o.right}px.`),
        )
      : [],
    coverage: [coverage(rule, 1, problem ? 1 : 0)],
  };
}

/**
 * WCAG 1.4.12 Text Spacing: applies the spacing values users are entitled to set and reports
 * text containers that start clipping their content as a result.
 */
export async function checkTextSpacing(page: Page): Promise<CheckOutcome & { examined: number; overflowAfter: number }> {
  await installHelpers(page);

  const result = await page.evaluate(async () => {
    const h = window.__a11y;
    // Text is cut off by whichever ancestor hides its overflow, so those containers are what to
    // measure. Boxes of a few pixels are screen-reader-only text, which is clipped on purpose.
    const cuts = (el: Element) => {
      const cs = getComputedStyle(el);
      return ['hidden', 'clip'].includes(cs.overflowY) || ['hidden', 'clip'].includes(cs.overflowX);
    };
    const candidates = Array.from(document.querySelectorAll<HTMLElement>('body *')).filter(
      (el) => el.clientHeight > 4 && el.clientWidth > 4 && cuts(el) && h.visible(el) && (el.innerText ?? '').trim().length > 1,
    );

    const clipped = (el: HTMLElement) => {
      const cs = getComputedStyle(el);
      const cutsY = ['hidden', 'clip'].includes(cs.overflowY) && el.scrollHeight > el.clientHeight + 2;
      const cutsX = ['hidden', 'clip'].includes(cs.overflowX) && el.scrollWidth > el.clientWidth + 2 && cs.textOverflow !== 'ellipsis';
      return cutsY || cutsX;
    };
    const before = new Set(candidates.filter(clipped));

    const style = document.createElement('style');
    style.id = '__a11y_text_spacing';
    style.textContent = '* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }';
    document.head.appendChild(style);
    await new Promise((resolve) => setTimeout(resolve, 400));

    const newlyClipped = candidates.filter((el) => !before.has(el) && clipped(el));
    const overflowAfter = Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const out = newlyClipped.slice(0, 12).map((el) => ({
      target: h.target(el),
      html: h.snippet(el),
      text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60),
      box: `${el.clientWidth}×${el.clientHeight}`,
      content: `${el.scrollWidth}×${el.scrollHeight}`,
    }));

    style.remove();
    return { examined: candidates.length, overflowAfter, clipped: out, total: newlyClipped.length };
  });

  return {
    examined: result.examined,
    overflowAfter: result.overflowAfter,
    raw: result.clipped.map((c) => finding('text-spacing-clipped', c, `"${c.text}" needs ${c.content}px with WCAG text spacing but its box is ${c.box}px and hides the overflow.`)),
    coverage: [coverage('text-spacing-clipped', result.examined, result.total)],
  };
}
