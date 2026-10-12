import type { Page } from '@playwright/test';
import { a11yConfig } from '../../config/a11y.config';
import { installHelpers } from '../core/browser';
import { selectorText, type RawFinding, type Target } from '../core/findings';
import { coverage, finding, type CheckOutcome, type ElementRef } from './rules';

export interface TabStop extends ElementRef {
  index: number;
  tag: string;
  role: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  visible: boolean;
  inViewport: boolean;
  /** What the position and focus check were measured on when the element's own box is not what is drawn. */
  measuredOn: 'element' | 'label' | 'content';
  scrollX: number;
  scrollY: number;
  /**
   * Whether anything on screen changes when the element takes focus. Decided by comparing
   * screenshots; `unknown` when the element could not be photographed (hidden, off-screen, frame).
   */
  indicator: 'yes' | 'no' | 'unknown';
  /** Which CSS properties changed, e.g. "outline, box-shadow". Explanatory only. */
  indicatorDetail: string;
  obscuredBy: string | null;
  isFrame: boolean;
  /** Tab presses spent here. Frames legitimately absorb several. */
  presses: number;
}

export interface TabWalk extends CheckOutcome {
  stops: TabStop[];
  /** The walk returned to the start (or left the document) rather than hitting the limit. */
  completed: boolean;
  trappedAt: TabStop | null;
  /**
   * The walk finished inside an embedded frame that is the last focusable thing on the page.
   * Automation has no browser toolbar for focus to move on to, so leaving that frame cannot be
   * observed; it is recorded, not reported as a trap.
   */
  endedInFrame: TabStop | null;
}

export interface TabWalkOptions {
  /** Called once per tab stop while it still has focus, after its focused photo is taken. */
  onStop?: (stop: TabStop) => Promise<void>;
  /** Overrides `keyboard.maxTabStops`. */
  maxStops?: number;
}

/** Tab presses a frame may absorb before the walk gives up on it. */
const FRAME_PATIENCE = 25;

/** Is there anything focusable in the top document after this frame? */
async function hasFocusableAfter(page: Page, frame: TabStop): Promise<boolean> {
  const first = frame.target[0];
  if (Array.isArray(first)) return true;
  return page.evaluate((selector) => {
    const frameEl = document.querySelector(selector);
    if (!frameEl) return true;
    return Array.from(document.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, summary, iframe, [tabindex]')).some(
      (el) => Boolean(frameEl.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) && el.tabIndex >= 0 && !(el as HTMLInputElement).disabled && window.__a11y.visible(el),
    );
  }, first);
}

type Snapshot = Omit<TabStop, 'index' | 'presses'>;

declare global {
  interface Window {
    __a11yFocusBaseline?: Map<Element, { own: Record<string, string>; parent: Record<string, string> | null }>;
  }
}

/** Records every focusable element's style before anything is focused. */
async function recordUnfocusedStyles(page: Page): Promise<void> {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    window.scrollTo(0, 0);
    const h = window.__a11y;
    const baseline = new Map<Element, { own: Record<string, string>; parent: Record<string, string> | null }>();
    for (const el of document.querySelectorAll('a[href], button, input, select, textarea, summary, [tabindex], [contenteditable]')) {
      baseline.set(el, { own: h.focusStyle(el), parent: el.parentElement ? h.focusStyle(el.parentElement) : null });
    }
    window.__a11yFocusBaseline = baseline;
  });
}

/** Describes whatever currently has focus. Returns null when focus is on the body. */
async function describeFocus(page: Page): Promise<Snapshot | null> {
  return page.evaluate((): Snapshot | null => {
    const h = window.__a11y;
    let el: Element | null = document.activeElement;
    if (!el || el === document.body || el === document.documentElement) return null;
    while (el.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;

    const tag = el.tagName.toLowerCase();
    const isFrame = tag === 'iframe' || tag === 'frame';
    const opacity = h.opacity(el);
    const hasArea = (r: DOMRect) => r.width > 1 && r.height > 1;

    // Where the element is actually drawn. Its own box is not always the answer:
    //  - a custom checkbox hides the real input and draws on its label;
    //  - an icon link can have a zero-height box while its glyph or child still paints.
    let rect = el.getBoundingClientRect();
    let measuredOn: 'element' | 'label' | 'content' = 'element';
    if (!isFrame && (!hasArea(rect) || opacity <= 0.05)) {
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) {
        const label = (el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null) ?? el.closest('label');
        if (label && h.visible(label) && h.opacity(label) > 0.05 && hasArea(label.getBoundingClientRect())) {
          rect = label.getBoundingClientRect();
          measuredOn = 'label';
        }
      }
      if (measuredOn === 'element' && opacity > 0.05) {
        let left = Infinity;
        let top = Infinity;
        let right = -Infinity;
        let bottom = -Infinity;
        const grow = (l: number, t: number, w: number, hgt: number) => {
          left = Math.min(left, l);
          top = Math.min(top, t);
          right = Math.max(right, l + w);
          bottom = Math.max(bottom, t + hgt);
        };
        for (const child of el.querySelectorAll('*')) {
          const r = child.getBoundingClientRect();
          if (hasArea(r) && h.visible(child)) grow(r.left, r.top, r.width, r.height);
        }
        // Text or a generated icon in a collapsed line box still paints at roughly its font size.
        const fontSize = parseFloat(getComputedStyle(el).fontSize) || 0;
        const hasText = (el.textContent ?? '').trim().length > 0 && fontSize > 1;
        const glyph = ['::before', '::after']
          .map((pseudo) => getComputedStyle(el, pseudo))
          .filter((cs) => !['none', 'normal', '""'].includes(cs.content))
          .map((cs) => Math.max(parseFloat(cs.fontSize) || 0, parseFloat(cs.height) || 0))
          .reduce((a, b) => Math.max(a, b), 0);
        const painted = Math.max(glyph, hasText ? fontSize : 0);
        if (painted > 1 && rect.width + rect.height > 1) {
          const w = Math.max(rect.width, painted);
          const hgt = Math.max(rect.height, painted);
          grow(rect.left, rect.top - (hgt - rect.height) / 2, w, hgt);
        }
        if (right > left && bottom > top) {
          rect = new DOMRect(left, top, right - left, bottom - top);
          measuredOn = 'content';
        }
      }
    }

    const visible = hasArea(rect) && (measuredOn === 'label' || (h.visible(el) || measuredOn === 'content') && opacity > 0.05);
    const inViewport = rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth;

    // ---- which focus styles changed, compared with the style recorded before focus ----
    let indicatorDetail = '';
    const base = window.__a11yFocusBaseline?.get(el);
    if (base && !isFrame) {
      const changed = new Set<string>();
      const diff = (before: Record<string, string> | null, now: Record<string, string>, prefix: string) => {
        if (!before) return;
        for (const key of Object.keys(now)) if (before[key] !== now[key]) changed.add(prefix + key);
      };
      diff(base.own, h.focusStyle(el), '');
      if (el.parentElement) diff(base.parent, h.focusStyle(el.parentElement), 'parent ');
      indicatorDetail = [...changed].join(', ');
    }

    // ---- obscured: is every sample point covered by fixed/sticky content? ----
    let obscuredBy: string | null = null;
    if (visible && inViewport && !isFrame) {
      const chain = h.ancestors(el);
      const points = [[0.5, 0.5], [0.2, 0.2], [0.8, 0.2], [0.2, 0.8], [0.8, 0.8]]
        .map(([fx, fy]) => [rect.left + rect.width * fx, rect.top + rect.height * fy])
        .filter(([x, y]) => x >= 0 && y >= 0 && x < window.innerWidth && y < window.innerHeight);
      let covered = 0;
      let cover: Element | null = null;
      for (const [x, y] of points) {
        const top = document.elementFromPoint(x, y);
        if (!top || chain.includes(top) || el.contains(top)) continue;
        covered++;
        cover = top;
      }
      if (cover && points.length > 0 && covered === points.length) {
        // Pinned content the element itself lives in (a control inside a sticky header) does not count.
        const pinned = h.ancestors(cover).find((n) => !chain.includes(n) && ['fixed', 'sticky'].includes(getComputedStyle(n).position));
        if (pinned) {
          const t = h.target(pinned)[0];
          obscuredBy = `${Array.isArray(t) ? t.join(' >> ') : t} (position: ${getComputedStyle(pinned).position})`;
        }
      }
    }

    const implicit: Record<string, string> = { a: 'link', button: 'button', select: 'combobox', textarea: 'textbox', summary: 'button', iframe: 'frame' };
    const inputRole = tag === 'input' ? ({ checkbox: 'checkbox', radio: 'radio', submit: 'button', button: 'button', range: 'slider', number: 'spinbutton', search: 'searchbox' }[(el as HTMLInputElement).type] ?? 'textbox') : '';

    return {
      target: h.target(el),
      html: h.snippet(el),
      tag,
      role: el.getAttribute('role') || inputRole || implicit[tag] || '',
      name: isFrame ? el.getAttribute('title') || '(untitled frame)' : h.name(el).name,
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      opacity: Math.round(opacity * 100) / 100,
      visible,
      inViewport,
      measuredOn,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      indicator: 'unknown' as const,
      indicatorDetail,
      obscuredBy,
      isFrame,
    };
  });
}

/**
 * Walks the page the way a keyboard user does: press Tab, see where focus goes, repeat.
 * Produces the tab order plus findings for traps, invisible focus, missing focus indicators
 * and focus hidden behind pinned content.
 */
export async function tabWalk(page: Page, options: TabWalkOptions = {}): Promise<TabWalk> {
  await installHelpers(page);
  await recordUnfocusedStyles(page);

  const { settleMs } = a11yConfig.keyboard;
  const maxTabStops = options.maxStops ?? a11yConfig.keyboard.maxTabStops;
  const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
  const stops: TabStop[] = [];
  const lostAfter: TabStop[] = [];
  const photos: { stop: TabStop; clip: { x: number; y: number; width: number; height: number }; focused: Buffer }[] = [];
  let trappedAt: TabStop | null = null;
  let stuckInFrame: TabStop | null = null;
  let endedInFrame: TabStop | null = null;
  let completed = false;
  /** Consecutive presses that left focus on <body>. */
  let onBody = 0;

  for (let press = 0; press < maxTabStops * 2 && stops.length < maxTabStops; press++) {
    await page.keyboard.press('Tab');
    await page.waitForTimeout(settleMs);
    const snapshot = await describeFocus(page);

    if (!snapshot) {
      // Focus on <body>. One press like this is either the wrap-around at the end of the page or
      // focus being dropped mid-page; the next stop tells which. Several in a row means it is gone.
      if (++onBody >= 3) break;
      continue;
    }

    const key = selectorText(snapshot.target);
    if (stops.length > 1 && selectorText(stops[0].target) === key) {
      completed = true;
      break;
    }

    const last = stops[stops.length - 1];
    if (last && selectorText(last.target) === key) {
      onBody = 0;
      last.presses++;
      if (!last.isFrame && last.presses >= 3) {
        trappedAt = last;
        break;
      }
      if (last.isFrame && last.presses >= FRAME_PATIENCE) {
        // The inside of a frame is not visible from here, so this is never called a trap outright.
        if (await hasFocusableAfter(page, last)) stuckInFrame = last;
        else {
          endedInFrame = last;
          completed = true;
        }
        break;
      }
      continue;
    }

    if (onBody > 0 && last) lostAfter.push(last);
    onBody = 0;

    const stop: TabStop = { ...snapshot, index: stops.length + 1, presses: 1 };
    stops.push(stop);

    if (stop.visible && stop.inViewport && !stop.isFrame) {
      const x = Math.max(0, stop.x - 6);
      const y = Math.max(0, stop.y - 6);
      const clip = { x, y, width: Math.min(viewport.width, stop.x + stop.width + 6) - x, height: Math.min(viewport.height, stop.y + stop.height + 6) - y };
      if (clip.width > 2 && clip.height > 2) {
        const focused = await page.screenshot({ clip }).catch(() => null);
        if (focused) photos.push({ stop, clip, focused });
      }
    }

    await options.onStop?.(stop);
  }

  // Photograph the same spots again with nothing focused. If not one pixel differs, there is no
  // focus indicator. Any difference at all (including unrelated motion) counts as "has one", so
  // this can miss a failure but cannot invent one.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  for (const photo of photos) {
    await page.evaluate(([left, top]) => window.scrollTo({ left, top, behavior: 'instant' }), [photo.stop.scrollX, photo.stop.scrollY]);
    await page.waitForTimeout(60);
    const unfocused = await page.screenshot({ clip: photo.clip }).catch(() => null);
    if (!unfocused) continue;
    const same = unfocused.equals(photo.focused);
    photo.stop.indicator = same ? 'no' : 'yes';
    if (!same && !photo.stop.indicatorDetail) photo.stop.indicatorDetail = 'visual change';
  }
  await page.evaluate(() => window.scrollTo({ left: 0, top: 0, behavior: 'instant' }));

  const elements = stops.filter((s) => !s.isFrame);
  const raw: RawFinding[] = [];
  if (trappedAt) raw.push(finding('kbd-focus-trap', trappedAt, `Focus stayed on tab stop ${trappedAt.index} for ${trappedAt.presses} consecutive Tab presses.`));
  if (stuckInFrame) raw.push(finding('kbd-frame-not-exited', stuckInFrame, `Focus entered the frame "${stuckInFrame.name}" at tab stop ${stuckInFrame.index} and had not left after ${stuckInFrame.presses} Tab presses, with more controls after it on the page.`));
  for (const stop of lostAfter) raw.push(finding('kbd-focus-lost', stop, `Pressing Tab on stop ${stop.index} "${stop.name}" left focus on the page body; the next press continued to stop ${stop.index + 1}.`));

  let hidden = 0;
  let noIndicator = 0;
  let obscured = 0;
  let unnamed = 0;
  for (const stop of elements) {
    if (!stop.visible || !stop.inViewport) {
      hidden++;
      const why = !stop.visible
        ? `is not rendered visibly (${stop.width}×${stop.height}px, opacity ${stop.opacity})`
        : `is outside the viewport (x ${stop.x}, y ${stop.y})`;
      raw.push(finding('kbd-focus-hidden-element', stop, `Tab stop ${stop.index} "${stop.name}" ${why}.`));
    } else if (stop.indicator === 'no') {
      noIndicator++;
      const where = stop.measuredOn === 'label' ? ' The real input is visually hidden, so this was measured on its label.' : '';
      raw.push(finding('kbd-focus-not-visible', stop, `Tab stop ${stop.index} "${stop.name.slice(0, 70)}" looks exactly the same focused and unfocused (pixel-identical screenshots).${where}`));
    }
    if (stop.obscuredBy) {
      obscured++;
      raw.push(finding('kbd-focus-obscured', stop, `Tab stop ${stop.index} "${stop.name}" is fully covered by ${stop.obscuredBy}.`));
    }
    if (!stop.name.trim()) {
      unnamed++;
      raw.push(finding('kbd-stop-unnamed', stop, `Tab stop ${stop.index} is a <${stop.tag}>${stop.role ? ` with role="${stop.role}"` : ' with no role'} and no accessible name.`));
    }
  }

  const measurable = elements.filter((s) => s.visible && s.inViewport);
  return {
    stops,
    completed,
    trappedAt,
    endedInFrame,
    raw,
    coverage: [
      coverage('kbd-focus-trap', elements.length, trappedAt ? 1 : 0),
      coverage('kbd-frame-not-exited', stops.length - elements.length, stuckInFrame ? 1 : 0),
      coverage('kbd-focus-lost', stops.length, lostAfter.length),
      coverage('kbd-focus-hidden-element', elements.length, hidden),
      coverage('kbd-focus-not-visible', measurable.filter((s) => s.indicator !== 'unknown').length, noIndicator),
      coverage('kbd-focus-obscured', measurable.length, obscured),
      coverage('kbd-stop-unnamed', elements.length, unnamed),
    ],
  };
}

/**
 * Finds controls a mouse can use but a keyboard cannot: elements with an interactive ARIA role
 * that are not in the tab order, and pointer-cursor elements that are not controls at all.
 */
export async function findUnreachableControls(page: Page): Promise<CheckOutcome> {
  await installHelpers(page);
  const result = await page.evaluate(() => {
    const h = window.__a11y;
    const LIMIT = 25;
    // Roles that must be focusable on their own. Tabs, menu items and options are left out:
    // composite widgets manage those with a roving tabindex.
    const standalone = ['button', 'link', 'checkbox', 'switch', 'slider', 'textbox', 'searchbox', 'combobox', 'spinbutton'];
    const control =
      'a[href], button, input, select, textarea, summary, label, option, area, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="option"], [role="checkbox"], [role="switch"], [role="radio"], [tabindex]:not([tabindex="-1"])';

    const roleCandidates = Array.from(document.querySelectorAll<HTMLElement>('[role]')).filter(
      (el) => standalone.includes((el.getAttribute('role') ?? '').trim()) && h.visible(el) && !el.closest('[aria-hidden="true"]'),
    );
    const notFocusable = roleCandidates.filter(
      (el) => el.tabIndex < 0 && el.getAttribute('aria-disabled') !== 'true' && !(el as HTMLInputElement).disabled,
    );

    const pointerCandidates = Array.from(document.querySelectorAll<HTMLElement>('body *')).filter((el) => {
      if (getComputedStyle(el).cursor !== 'pointer') return false;
      // Only the outermost element that sets the pointer cursor, not everything inheriting it.
      if (el.parentElement && getComputedStyle(el.parentElement).cursor === 'pointer') return false;
      const r = el.getBoundingClientRect();
      return r.width >= 10 && r.height >= 10 && h.visible(el);
    });
    const mouseOnly = pointerCandidates.filter((el) => !el.matches(control) && !el.closest(control) && !el.querySelector(control) && el.tabIndex < 0);

    const ref = (el: Element) => ({ target: h.target(el), html: h.snippet(el), role: el.getAttribute('role') ?? '', text: h.name(el).name.slice(0, 60) });
    return {
      rolesExamined: roleCandidates.length,
      pointersExamined: pointerCandidates.length,
      notFocusable: notFocusable.slice(0, LIMIT).map(ref),
      mouseOnly: mouseOnly.slice(0, LIMIT).map(ref),
    };
  });

  return {
    raw: [
      ...result.notFocusable.map((el) => finding('kbd-not-focusable', el, `Element has role="${el.role}" ("${el.text}") but cannot receive keyboard focus (no tabindex).`)),
      ...result.mouseOnly.map((el) => finding('kbd-mouse-only', el, `"${el.text || el.html.slice(0, 60)}" shows a pointer cursor but is not a link or button, has no role and is not focusable.`)),
    ],
    coverage: [
      coverage('kbd-not-focusable', result.rolesExamined, result.notFocusable.length),
      coverage('kbd-mouse-only', result.pointersExamined, result.mouseOnly.length),
    ],
  };
}

export interface SkipLinkResult {
  text: string;
  href: string;
  /** Position in the tab order, or null if the walk never reached it. */
  tabPosition: number | null;
  visibleOnFocus: boolean;
  outcome: 'focus moved to target' | 'next Tab continues after target' | 'target missing' | 'focus did not move';
}

const css = (target: Target) => {
  const last = target[target.length - 1];
  return Array.isArray(last) ? last.join(' >> ') : last;
};

/** Activates each skip link and checks that keyboard focus really ends up at its target. */
export async function checkSkipLinks(page: Page, stops: TabStop[]): Promise<CheckOutcome & { links: SkipLinkResult[] }> {
  await installHelpers(page);
  const found = await page.evaluate(() => {
    const h = window.__a11y;
    return Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href^="#"]'))
      .filter((a) => /skip|jump to (main|content)/i.test(a.textContent ?? ''))
      .slice(0, 4)
      .map((a) => ({ target: h.target(a), html: h.snippet(a), text: (a.textContent ?? '').replace(/\s+/g, ' ').trim(), href: a.getAttribute('href') ?? '' }));
  });

  if (found.length === 0) {
    return {
      links: [],
      raw: [finding('kbd-skip-link-missing', { target: ['body'], html: '<body>' }, 'No link containing "skip" that points to an in-page anchor was found.')],
      coverage: [coverage('kbd-skip-link-missing', 1, 1)],
    };
  }

  const raw: RawFinding[] = [];
  const links: SkipLinkResult[] = [];
  let broken = 0;

  for (const link of found) {
    const locator = page.locator(css(link.target)).first();
    await page.evaluate(() => window.scrollTo(0, 0));
    await locator.focus();
    await page.waitForTimeout(200);
    const visibleOnFocus = await locator.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return window.__a11y.visible(el) && window.__a11y.opacity(el) > 0.05 && r.width > 1 && r.height > 1 && r.bottom > 0 && r.right > 0 && r.top < window.innerHeight && r.left < window.innerWidth;
    });

    await page.keyboard.press('Enter');
    await page.waitForTimeout(250);
    const id = decodeURIComponent(link.href.slice(1));
    let outcome: SkipLinkResult['outcome'] = await page.evaluate((targetId) => {
      const target = document.getElementById(targetId);
      if (!target) return 'target missing' as const;
      const active = document.activeElement;
      return active && (active === target || target.contains(active)) ? ('focus moved to target' as const) : ('focus did not move' as const);
    }, id);

    if (outcome === 'focus did not move') {
      // Browsers may move only the "focus navigation starting point". The next Tab proves it.
      await page.keyboard.press('Tab');
      await page.waitForTimeout(150);
      const continues = await page.evaluate((targetId) => {
        const target = document.getElementById(targetId);
        const active = document.activeElement;
        if (!target || !active || active === document.body) return false;
        const position = target.compareDocumentPosition(active);
        return Boolean(position & Node.DOCUMENT_POSITION_FOLLOWING) || Boolean(position & Node.DOCUMENT_POSITION_CONTAINED_BY);
      }, id);
      if (continues) outcome = 'next Tab continues after target';
    }

    const position = stops.find((s) => selectorText(s.target) === selectorText(link.target))?.index ?? null;
    links.push({ text: link.text, href: link.href, tabPosition: position, visibleOnFocus, outcome });

    if (outcome === 'target missing' || outcome === 'focus did not move') {
      broken++;
      raw.push(finding('kbd-skip-link-broken', link, `"${link.text}" (${link.href}): ${outcome}.`));
    }
    if (!visibleOnFocus) raw.push(finding('kbd-focus-hidden-element', link, `Skip link "${link.text}" stays invisible when it receives focus.`));
  }

  const first = links[0];
  const lateBy = first.tabPosition !== null ? first.tabPosition - 1 : 0;
  if (lateBy > 0) raw.push(finding('kbd-skip-link-not-first', found[0], `"${first.text}" is tab stop ${first.tabPosition}; ${lateBy} focusable element(s) come before it.`));

  await page.evaluate(() => window.scrollTo(0, 0));
  return {
    links,
    raw,
    coverage: [coverage('kbd-skip-link-broken', found.length, broken), coverage('kbd-skip-link-not-first', 1, lateBy > 0 ? 1 : 0)],
  };
}

/** Checks whether a hover-opened submenu can also be opened from the keyboard. */
export async function checkSubmenuKeyboard(page: Page, parentItem: string, submenu: string): Promise<CheckOutcome & { openedWith: string | null }> {
  await installHelpers(page);
  const parent = page.locator(parentItem).first();
  const isOpen = () => page.locator(submenu).first().isVisible();

  let openedWith: string | null = null;
  for (const key of ['ArrowDown', 'ArrowRight', 'Space']) {
    await page.mouse.move(0, 0);
    await parent.focus();
    await page.keyboard.press(key);
    await page.waitForTimeout(450);
    if (await isOpen()) {
      openedWith = key;
      await page.keyboard.press('Escape');
      break;
    }
  }

  const ref = await parent.evaluate((el) => ({ target: window.__a11y.target(el), html: window.__a11y.snippet(el) }));
  return {
    openedWith,
    raw: openedWith ? [] : [finding('kbd-submenu-not-openable', ref, 'The submenu opens on mouse hover, but Arrow Down, Arrow Right and Space did not open it while this item had focus.')],
    coverage: [coverage('kbd-submenu-not-openable', 1, openedWith ? 0 : 1)],
  };
}
