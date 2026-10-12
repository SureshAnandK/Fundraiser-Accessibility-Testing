import type { Page } from '@playwright/test';
import { installHelpers } from '../core/browser';
import type { RawFinding } from '../core/findings';
import { coverage, finding, type CheckOutcome, type ElementRef } from './rules';

interface HeadingInfo extends ElementRef {
  level: number;
  text: string;
}
interface LandmarkInfo extends ElementRef {
  role: string;
  label: string;
}
interface ImageInfo extends ElementRef {
  alt: string | null;
  decorative: boolean;
  src: string;
  width: number;
  height: number;
  inLink: boolean;
  linkHasText: boolean;
}
interface FieldInfo extends ElementRef {
  type: string;
  name: string;
  nameSource: string;
  autocomplete: string;
  idOrName: string;
}
interface LinkInfo extends ElementRef {
  text: string;
  href: string;
  newWindow: boolean;
  announcesNewWindow: boolean;
}
interface TabInfo extends ElementRef {
  name: string;
  selected: string | null;
  panelVisible: boolean;
}
interface VisualHeading extends ElementRef {
  text: string;
}

/** The page's structure as assistive technology would discover it. */
export interface StructureOutline {
  title: string;
  lang: string;
  headings: { level: number; text: string }[];
  landmarks: { role: string; label: string }[];
  images: { alt: string | null; decorative: boolean; src: string; size: string }[];
  fields: { type: string; name: string; nameSource: string; autocomplete: string }[];
  linkCount: number;
}

const FILE_LIKE = /\.(jpe?g|png|gif|webp|svg|avif|bmp)$/i;
const ID_LIKE = /^[\w-]*\d{3,}[\w-]*$/;
const PLACEHOLDER_ALT = /^(image|img|photo|picture|graphic|banner|icon|placeholder|thumbnail|(main )?product (image|photo|picture)|main (image|photo)|main product photo)\d*$/i;
const GENERIC_LINK = /^(click here|here|more|read more|learn more|see more|view more|view all|see all|shop now|details|link|go|continue|this)$/i;
const PERSONAL_FIELD = /e-?mail|phone|telephone|(^|[_-])tel|first.?name|last.?name|full.?name|street|address|zip|postal|city/i;
const LIMIT = 25;

/**
 * Reads the page's semantic structure and applies the checks a rules engine cannot make with
 * confidence: is this alt text meaningful, is this bold line really a heading, is this link
 * text unambiguous. Those are reported for human review rather than as hard failures.
 */
export async function inspectStructure(page: Page): Promise<CheckOutcome & { outline: StructureOutline }> {
  await installHelpers(page);

  const dom = await page.evaluate(() => {
    const h = window.__a11y;
    const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
    const ref = (el: Element) => ({ target: h.target(el), html: h.snippet(el) });
    const all = <T extends Element>(selector: string) => Array.from(document.querySelectorAll<T>(selector));

    const headings = all<HTMLElement>('h1, h2, h3, h4, h5, h6, [role="heading"]')
      .filter((el) => h.visible(el))
      .map((el) => ({ ...ref(el), level: Number(el.getAttribute('aria-level') ?? el.tagName.slice(1)) || 2, text: clean(el.innerText) }));

    const implicitRole: Record<string, string> = { header: 'banner', nav: 'navigation', main: 'main', footer: 'contentinfo', aside: 'complementary', form: 'form', section: 'region' };
    const landmarks = all<HTMLElement>('header, nav, main, footer, aside, [role="banner"], [role="navigation"], [role="main"], [role="contentinfo"], [role="complementary"], [role="search"], [role="region"], [role="form"]')
      .filter((el) => h.visible(el))
      .map((el) => ({
        ...ref(el),
        role: el.getAttribute('role') ?? implicitRole[el.tagName.toLowerCase()] ?? '',
        label: clean(el.getAttribute('aria-label')) || clean(el.getAttribute('aria-labelledby')?.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ')),
      }));

    const images = all<HTMLImageElement>('img')
      .filter((el) => h.visible(el))
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const link = el.closest('a');
        return {
          ...ref(el),
          alt: el.getAttribute('alt'),
          decorative: el.getAttribute('alt') === '' || ['presentation', 'none'].includes(el.getAttribute('role') ?? '') || el.getAttribute('aria-hidden') === 'true',
          src: (el.currentSrc || el.src).split('?')[0].split('/').slice(-1)[0].slice(0, 60),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          inLink: Boolean(link),
          linkHasText: Boolean(link && (clean(link.innerText) || clean(link.getAttribute('aria-label')))),
        };
      });

    const fields = all<HTMLInputElement>('input, select, textarea')
      .filter((el) => !['hidden', 'submit', 'button', 'reset', 'image'].includes(el.type) && h.visible(el))
      .map((el) => {
        const named = h.name(el);
        return { ...ref(el), type: el.tagName === 'INPUT' ? el.type : el.tagName.toLowerCase(), name: named.name.slice(0, 120), nameSource: named.source, autocomplete: el.getAttribute('autocomplete') ?? '', idOrName: `${el.id} ${el.getAttribute('name') ?? ''}` };
      });

    const links = all<HTMLAnchorElement>('a[href]')
      .filter((el) => h.visible(el))
      .map((el) => {
        const named = h.name(el).name;
        const said = `${named} ${el.getAttribute('title') ?? ''}`;
        return { ...ref(el), text: named, href: el.href.split('#')[0].replace(/\/$/, ''), newWindow: el.target === '_blank', announcesNewWindow: /new (window|tab)|opens in|external/i.test(said) };
      });

    const tabs = all<HTMLElement>('[role="tab"]')
      .filter((el) => h.visible(el))
      .map((el) => {
        const panel = document.getElementById(el.getAttribute('aria-controls') ?? '');
        return { ...ref(el), name: h.name(el).name.slice(0, 60), selected: el.getAttribute('aria-selected'), panelVisible: Boolean(panel && h.visible(panel)) };
      });

    // A paragraph whose whole text is bold, sitting directly above a block of body text.
    const scope = document.querySelector('main') ?? document.body;
    const visualHeadings = Array.from(scope.querySelectorAll<HTMLElement>('p, div'))
      .filter((el) => {
        const text = clean(el.textContent);
        if (text.length < 4 || text.length > 90) return false;
        const bold = el.querySelector('strong, b');
        if (!bold || clean(bold.textContent) !== text) return false;
        if (el.closest('h1, h2, h3, h4, h5, h6, [role="heading"], a, button, label, li, th, td, dt, nav, form')) return false;
        if (el.tagName === 'DIV' && el.querySelector('p, div')) return false;
        const next = el.nextElementSibling;
        return Boolean(next && /^(P|UL|OL|DIV)$/.test(next.tagName) && clean(next.textContent).length >= 80 && h.visible(el));
      })
      .map((el) => ({ ...ref(el), text: clean(el.textContent) }));

    return { title: document.title, lang: document.documentElement.lang, headings, landmarks, images, fields, links, tabs, visualHeadings };
  });

  const raw: RawFinding[] = [];
  const capped = <T>(items: T[]) => items.slice(0, LIMIT);
  const headings = dom.headings as HeadingInfo[];
  const landmarks = dom.landmarks as LandmarkInfo[];
  const images = dom.images as ImageInfo[];
  const fields = dom.fields as FieldInfo[];
  const links = dom.links as LinkInfo[];
  const tabs = dom.tabs as TabInfo[];
  const visualHeadings = dom.visualHeadings as VisualHeading[];

  // ---- images ----
  const described = images.filter((i) => !i.decorative && i.alt);
  const fileLike = described.filter((i) => FILE_LIKE.test(i.alt!) || (ID_LIKE.test(i.alt!) && !/\s/.test(i.alt!)));
  const placeholder = described.filter((i) => !fileLike.includes(i) && PLACEHOLDER_ALT.test(i.alt!.trim()));
  const decorativeLarge = images.filter((i) => i.decorative && ((i.width >= 200 && i.height >= 100) || (i.inLink && !i.linkHasText)));
  for (const i of capped(fileLike)) raw.push(finding('img-alt-filename', i, `alt="${i.alt}" on ${i.src} (${i.width}×${i.height}px) reads as a file name or ID, not a description.`));
  for (const i of capped(placeholder)) raw.push(finding('img-alt-placeholder', i, `alt="${i.alt}" on ${i.src} is a placeholder, not a description of the image.`));
  for (const i of capped(decorativeLarge)) {
    const why = i.inLink && !i.linkHasText ? 'is the only content of a link' : `is ${i.width}×${i.height}px`;
    raw.push(finding('img-decorative-large', i, `${i.src} has empty alt text but ${why}. Confirm it carries no information.`));
  }

  // ---- headings ----
  for (const v of capped(visualHeadings)) raw.push(finding('heading-visual-only', v, `"${v.text}" is bold text in a paragraph that introduces the content below it, but is not a heading element.`));

  // ---- links ----
  const byText = new Map<string, LinkInfo[]>();
  for (const link of links) {
    const key = link.text.toLowerCase();
    if (key) byText.set(key, [...(byText.get(key) ?? []), link]);
  }
  const ambiguous: { link: LinkInfo; why: string }[] = [];
  for (const [text, group] of byText) {
    const destinations = new Set(group.map((l) => l.href));
    if (GENERIC_LINK.test(text)) for (const link of group) ambiguous.push({ link, why: `Link text "${link.text}" does not say where it goes.` });
    else if (destinations.size > 1) for (const link of group.slice(0, 4)) ambiguous.push({ link, why: `${group.length} links share the text "${link.text}" but lead to ${destinations.size} different destinations.` });
  }
  for (const a of capped(ambiguous)) raw.push(finding('link-ambiguous-text', a.link, a.why));

  const silentNewWindow = links.filter((l) => l.newWindow && !l.announcesNewWindow);
  for (const l of capped(silentNewWindow)) raw.push(finding('link-new-window', l, `"${l.text || l.href}" opens in a new tab without saying so.`));

  // ---- tabs ----
  const wrongTabs = tabs.filter((t) => t.panelVisible && t.selected !== 'true');
  for (const t of wrongTabs) raw.push(finding('tab-selected-state', t, `Tab "${t.name}" has aria-selected="${t.selected ?? '(absent)'}" while its panel is displayed.`));

  // ---- form fields ----
  const weakName = fields.filter((f) => f.nameSource === 'placeholder' || f.nameSource === 'title');
  for (const f of capped(weakName)) raw.push(finding('field-name-weak', f, `${f.type} field is named "${f.name}" by its ${f.nameSource} only; it has no visible label.`));
  const personal = fields.filter((f) => ['email', 'tel'].includes(f.type) || PERSONAL_FIELD.test(f.idOrName));
  const noPurpose = personal.filter((f) => !f.autocomplete || f.autocomplete === 'off');
  for (const f of capped(noPurpose)) raw.push(finding('field-purpose-missing', f, `${f.type} field "${f.name}" collects personal data but has ${f.autocomplete ? 'autocomplete="off"' : 'no autocomplete attribute'}.`));

  return {
    outline: {
      title: dom.title,
      lang: dom.lang,
      headings: headings.map((x) => ({ level: x.level, text: x.text })),
      landmarks: landmarks.map((x) => ({ role: x.role, label: x.label })),
      images: images.map((x) => ({ alt: x.alt, decorative: x.decorative, src: x.src, size: `${x.width}×${x.height}` })),
      fields: fields.map((x) => ({ type: x.type, name: x.name, nameSource: x.nameSource, autocomplete: x.autocomplete })),
      linkCount: links.length,
    },
    raw,
    coverage: [
      coverage('img-alt-filename', described.length, fileLike.length),
      coverage('img-alt-placeholder', described.length, placeholder.length),
      coverage('img-decorative-large', images.filter((i) => i.decorative).length, decorativeLarge.length),
      coverage('heading-visual-only', headings.length + visualHeadings.length, visualHeadings.length),
      coverage('link-ambiguous-text', links.length, ambiguous.length),
      coverage('link-new-window', links.filter((l) => l.newWindow).length, silentNewWindow.length),
      coverage('tab-selected-state', tabs.length, wrongTabs.length),
      coverage('field-name-weak', fields.length, weakName.length),
      coverage('field-purpose-missing', personal.length, noPurpose.length),
    ],
  };
}
