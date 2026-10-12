import type { Severity } from '../../config/a11y.config';
import type { InfoRecord } from '../core/findings';
import { criterionName, understandingUrl } from '../core/wcag';
import type { Bucket, CoverageRow, Issue, ReportModel, RuleGroup } from './model';

export const esc = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const num = (n: number) => n.toLocaleString('en-US');
const plural = (n: number, one: string, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`;

/** Severity is always a shape plus a word; the colour only reinforces it. */
const SEVERITY_ICON: Record<Severity, string> = {
  critical: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 1h6l4 4v6l-4 4H5l-4-4V5z" fill="var(--critical)"/></svg>',
  serious: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5 15 14H1z" fill="var(--serious)"/></svg>',
  moderate: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.5" fill="var(--warning)"/></svg>',
  minor: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5" fill="none" stroke="var(--minor)" stroke-width="2"/></svg>',
};
const severity = (s: Severity) => `<span class="sev">${SEVERITY_ICON[s]}${s}</span>`;

const SOURCE_LABEL: Record<string, string> = {
  axe: 'axe-core rules engine',
  keyboard: 'keyboard check',
  structure: 'structure check',
  forms: 'form error check',
  responsive: 'reflow / zoom check',
  dialog: 'dialog check',
};

const wcagLinks = (criteria: string[]) =>
  criteria.length ? criteria.map((sc) => `<a href="${esc(understandingUrl(sc))}">${esc(sc)} ${esc(criterionName(sc))}</a>`).join(', ') : 'Best practice (not a WCAG requirement)';

const table = (caption: string, head: string[], rows: string[][], label = caption) => `
<div class="scroll" role="region" tabindex="0" aria-label="${esc(label)}">
<table>
  <caption>${esc(caption)}</caption>
  <thead><tr>${head.map((c) => `<th scope="col">${esc(c)}</th>`).join('')}</tr></thead>
  <tbody>${rows.map((r) => `<tr>${r.map((c, i) => (i === 0 ? `<th scope="row">${c}</th>` : `<td>${c}</td>`)).join('')}</tr>`).join('\n')}</tbody>
</table>
</div>`;

/** A report on one page reads as it always did; pages are only named when there are several. */
const several = (model: ReportModel) => model.pages.length > 1;

type Context = InfoRecord['context'];
const samePage = (a: Context, b: Context) => a.pageId === b.pageId && a.viewport === b.viewport;
const where = (model: ReportModel, context: Context) => (several(model) ? `${context.pageName} · ${context.viewport}` : context.viewport);
const pageCell = (model: ReportModel, context: Context) => (several(model) ? [esc(context.pageName)] : []);
const pageHead = (model: ReportModel) => (several(model) ? ['Page'] : []);

/** Records of one topic, page by page in the order the pages were audited. */
const infoOf = <T>(model: ReportModel, topic: string): (InfoRecord & { data: T })[] => {
  const position = new Map(model.pages.map((p, i) => [p.id, i]));
  const records = model.info.filter((i) => i.topic === topic) as (InfoRecord & { data: T })[];
  return records.sort((a, b) => (position.get(a.context.pageId) ?? 0) - (position.get(b.context.pageId) ?? 0));
};

// ───────────────────────── findings ─────────────────────────

function issueBlock(issue: Issue, group: RuleGroup, showPage: boolean): string {
  const f = issue.finding;
  const seen = issue.seenIn.map((s) => `${s.viewport} · ${s.state}`);
  return `
<li class="issue" data-owner="${esc(f.owner)}" data-page="${esc(f.context.pageId)}">
  <p class="where">${showPage ? `<span class="tag">${esc(f.context.pageName)}</span>` : ''}<span class="tag">${esc(f.region)}</span><span class="tag">${esc(f.owner)}</span></p>
  <p class="why">${esc(f.failureSummary)}</p>
  <dl class="facts">
    <dt>Element</dt><dd><code>${esc(f.selector)}</code></dd>
    <dt>Markup</dt><dd><code>${esc(f.html)}</code></dd>
    <dt>Seen in</dt><dd>${seen.map(esc).join('<br>')}</dd>
  </dl>
  ${f.screenshot ? `<a class="shot" href="${esc(f.screenshot)}"><img loading="lazy" src="${esc(f.screenshot)}" alt="Screenshot with the failing element outlined: ${esc(group.title)}"></a>` : ''}
</li>`;
}

function ruleBlock(group: RuleGroup, showPage: boolean): string {
  return `
<details class="rule">
  <summary>
    <h3>${esc(group.title)}</h3>
    <span class="meta">${severity(group.severity)} <span><span class="count">${group.issues.length}</span> ${group.issues.length === 1 ? 'element' : 'elements'}</span> <span>${esc(group.wcag.length ? `WCAG ${group.wcag.join(', ')} (Level ${group.level})` : 'Best practice')}</span></span>
  </summary>
  <div class="rule-body">
    <p>${esc(group.description)}</p>
    <p class="small">Standard: ${wcagLinks(group.wcag)}. Found by: ${esc(SOURCE_LABEL[group.source] ?? group.source)} (rule <code>${esc(group.ruleId)}</code>). <a href="${esc(group.helpUrl)}">How to fix this</a>.</p>
    <ul class="issues">${group.issues.map((i) => issueBlock(i, group, showPage)).join('')}</ul>
  </div>
</details>`;
}

const BUCKET_COPY: Record<Bucket, { id: string; title: string; intro: string; empty: string }> = {
  violation: {
    id: 'violations',
    title: 'Violations',
    intro: 'Each of these has an objective pass/fail condition and failed it. They are grouped by rule; open a rule to see every affected element, why it fails, and where it was seen.',
    empty: 'No violations were detected by the automated checks.',
  },
  review: {
    id: 'review',
    title: 'Needs review',
    intro: 'The checks flagged these but cannot decide them alone: either the rules engine could not measure the element (for example text over an image), or the check is a heuristic. A person needs to confirm each one.',
    empty: 'Nothing was flagged for manual review.',
  },
  advisory: {
    id: 'advisory',
    title: 'Advisory',
    intro: 'Best-practice findings. They are not WCAG A/AA requirements and never fail the run, but fixing them improves the experience for assistive-technology users.',
    empty: 'No advisory findings.',
  },
};

function bucketSection(model: ReportModel, bucket: Bucket): string {
  const copy = BUCKET_COPY[bucket];
  const groups = model.groups[bucket];
  const elements = groups.reduce((sum, g) => sum + g.issues.length, 0);
  return `
<section id="${copy.id}" aria-labelledby="${copy.id}-h">
  <h2 id="${copy.id}-h">${copy.title} <span class="h-count">${plural(elements, 'element')} · ${plural(groups.length, 'rule')}</span></h2>
  <p>${copy.intro}</p>
  ${groups.length ? groups.map((g) => ruleBlock(g, several(model))).join('') : `<p class="empty">${copy.empty}</p>`}
</section>`;
}

// ───────────────────────── overview ─────────────────────────

function overview(model: ReportModel): string {
  const t = model.totals;
  const verdict =
    model.verdict === 'fail'
      ? { cls: 'fail', icon: SEVERITY_ICON.critical, head: `Does not meet ${model.standard}`, body: `${plural(t.blocking, 'element')} fail at "${model.failOn}" severity or above. ${plural(t.violationTotal, 'violation')} in total, plus ${plural(t.review, 'item')} that need a person to review.` }
      : model.verdict === 'review'
        ? { cls: 'warn', icon: SEVERITY_ICON.moderate, head: 'No blocking violations, but not a clean result', body: `${plural(t.violationTotal, 'lower-severity violation')} and ${plural(t.review, 'item')} awaiting review. Automated checks cover only part of ${model.standard}.` }
        : { cls: 'ok', icon: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="var(--good)"/></svg>', head: 'No issues detected by automation', body: `This is not a statement of conformance: automated checks cover only part of ${model.standard}. See the manual checklist.` };

  const tile = (label: string, value: number, extra = '') => `<div class="tile"><dt>${label}</dt><dd>${num(value)}${extra}</dd></div>`;

  return `
<section id="summary" aria-labelledby="summary-h">
  <h2 id="summary-h">Summary</h2>
  <div class="verdict ${verdict.cls}">${verdict.icon}<div><p class="verdict-head">${esc(verdict.head)}</p><p>${esc(verdict.body)}</p></div></div>

  <dl class="tiles">
    <div class="tile hero"><dt>Violations (unique elements)</dt><dd>${num(t.violationTotal)}</dd></div>
    ${(['critical', 'serious', 'moderate', 'minor'] as Severity[]).map((s) => `<div class="tile"><dt>${severity(s)}</dt><dd>${num(t.violations[s])}</dd></div>`).join('')}
    ${tile('Needs review', t.review)}
    ${tile('Advisory', t.advisory)}
  </dl>
  <dl class="tiles quiet">
    ${tile('Rules that applied', t.rulesApplicable, `<span class="of"> of ${num(t.rulesRun)}</span>`)}
    ${tile('Element checks performed', t.elementChecks)}
    ${tile('Scans', t.scans)}
    ${tile('Viewports', model.viewports.length)}
    ${tile('Page states', model.states.length)}
  </dl>
  <p class="small">Counts are unique elements. The same element failing the same rule in several states or viewports is counted once.${several(model) ? ' An element that several pages share, such as one in the site header, is counted on each page it appears on.' : ''}</p>

  ${several(model) ? table('Findings by page', ['Page', 'Violations', 'Needs review', 'Advisory'], model.byPage.map((p) => [esc(p.name), num(p.violation), num(p.review), num(p.advisory)])) : ''}
  ${model.byCriterion.length ? table('Violations by WCAG success criterion', ['Success criterion', 'Level', 'Worst severity', 'Rules failing', 'Elements'], model.byCriterion.map((c) => [`<a href="${esc(understandingUrl(c.sc))}">${esc(c.sc)} ${esc(c.name)}</a>`, esc(c.level), severity(c.worst), num(c.rules), num(c.elements)])) : ''}

  <div class="cols">
    ${table('Findings by owner — who can fix it', ['Owner', 'Violations', 'Needs review', 'Advisory'], model.byOwner.map((o) => [esc(o.owner), num(o.violation), num(o.review), num(o.advisory)]))}
    ${table('Findings by page region', ['Region', 'Violations', 'Needs review'], model.byRegion.map((r) => [esc(r.region), num(r.violation), num(r.review)]))}
  </div>
</section>`;
}

// ───────────────────────── coverage ─────────────────────────

function coverageSection(model: ReportModel): string {
  const applied = model.coverage.filter((r) => !r.inapplicable);
  const idle = model.coverage.filter((r) => r.inapplicable);
  const states = infoOf<{ title: string; screenshot: string; detail: string }>(model, 'state');
  const row = (r: CoverageRow) => [
    `${esc(r.title)}<br><code>${esc(r.ruleId)}</code>`,
    esc(SOURCE_LABEL[r.source] ?? r.source),
    esc(r.wcag.join(', ') || 'best practice'),
    num(r.checked),
    num(r.passed),
    r.failed ? `<strong>${num(r.failed)}</strong>` : '0',
    num(r.review),
    num(r.scans),
  ];
  return `
<section id="coverage" aria-labelledby="coverage-h">
  <h2 id="coverage-h">What was tested</h2>
  <p>Every rule that ran, and how many elements it examined. "Elements checked" is the count in the largest single scan; "Failed" and "Needs review" are unique elements across all scans. A rule with zero failures here did examine real elements and passed them.</p>
  ${table(`Rules that examined ${several(model) ? 'these pages' : 'this page'} (${applied.length})`, ['Rule', 'Checked by', 'WCAG', 'Elements checked', 'Passed', 'Failed', 'Needs review', 'Scans'], applied.map(row))}
  <details class="plain">
    <summary>Rules that ran but found nothing to examine (${idle.length})</summary>
    <p class="small">These rules target content ${several(model) ? 'these pages do' : 'this page does'} not have (for example video captions when there is no video). They are listed so it is clear they were not skipped.</p>
    <ul class="compact">${idle.map((r) => `<li>${esc(r.title)} <code>${esc(r.ruleId)}</code></li>`).join('')}</ul>
  </details>
  ${states.length ? `
  <h3>Interaction states audited</h3>
  <p>Each state was opened the way a user would, photographed, then scanned. The screenshot shows exactly what was examined.</p>
  ${table('Interaction states', [...pageHead(model), 'State', 'Viewport', 'What was on screen', 'Screenshot'], states.map((s) => [...pageCell(model, s.context), esc(s.data.title), esc(s.context.viewport), s.data.detail ? esc(s.data.detail) : '<em>fixed content</em>', `<a href="${esc(s.data.screenshot)}">View</a>`]))}` : ''}
  <details class="plain">
    <summary>Every scan performed (${model.scans.length})</summary>
    ${table('Scans performed', [...pageHead(model), 'Page state', 'Viewport', 'Scope', 'Engine', 'Findings'], model.scans.map((s) => [...pageCell(model, s.context), esc(s.context.state), esc(s.context.viewport), `<code>${esc(s.scope)}</code>`, esc(s.engine), num(s.findings)]))}
  </details>
</section>`;
}

// ───────────────────────── keyboard ─────────────────────────

interface TabOrderData {
  completed: boolean;
  trapped: number | null;
  endedInFrame: string | null;
  stops: { index: number; role: string; name: string; indicator: string; indicatorDetail: string; measuredOn: string; visible: boolean; obscuredBy: string | null; isFrame: boolean; presses: number }[];
}
interface SkipLinkData {
  text: string;
  href: string;
  tabPosition: number | null;
  visibleOnFocus: boolean;
  outcome: string;
}

function keyboardSection(model: ReportModel): string {
  const walks = infoOf<TabOrderData>(model, 'tab-order');
  const skips = infoOf<SkipLinkData[]>(model, 'skip-links');
  if (walks.length === 0) return '';

  const blocks = walks.map((walk) => {
    const d = walk.data;
    const tally = (v: string) => d.stops.filter((s) => s.indicator === v).length;
    const end = d.trapped
      ? `Focus was trapped at stop ${d.trapped}.`
      : d.endedInFrame
        ? `The walk ended inside the "${esc(d.endedInFrame)}" frame, the last focusable item on the page. Automation has no browser toolbar for focus to move on to, so leaving that frame could not be observed; check it by hand.`
        : d.completed
          ? 'Focus travelled the whole page and wrapped back to the start.'
          : 'The walk stopped at the configured limit before returning to the start.';
    const skip = skips.find((s) => samePage(s.context, walk.context));
    const label = where(model, walk.context);
    return `
  <h3>${esc(label)}: ${d.stops.length} tab stops</h3>
  <p>${end} Focus indicator: <strong>${tally('no')} with none</strong>, ${tally('yes')} visible, ${tally('unknown')} not measurable (hidden element or frame).</p>
  ${skip?.data.length ? table(`Skip links (${label})`, ['Link', 'Target', 'Tab position', 'Visible when focused', 'Result'], skip.data.map((s) => [esc(s.text), `<code>${esc(s.href)}</code>`, s.tabPosition === null ? 'not reached by Tab' : num(s.tabPosition), s.visibleOnFocus ? 'Yes' : 'No', esc(s.outcome)])) : ''}
  <details class="plain">
    <summary>Full tab order (${d.stops.length} stops)</summary>
    ${table(`Tab order, ${label}`, ['Stop', 'Role', 'Accessible name', 'Focus indicator', 'Notes'], d.stops.map((s) => [
      num(s.index),
      esc(s.role),
      s.name ? esc(s.name) : '<em>(no name)</em>',
      s.indicator === 'yes' ? `Yes: ${esc(s.indicatorDetail)}` : s.indicator === 'no' ? '<strong>None</strong>' : 'Not measurable',
      esc([!s.visible ? 'not visible' : '', s.measuredOn !== 'element' ? `measured on its ${s.measuredOn}` : '', s.obscuredBy ? `covered by ${s.obscuredBy}` : '', s.isFrame ? `embedded frame, absorbed ${s.presses} Tab presses` : ''].filter(Boolean).join('; ')),
    ]))}
  </details>`;
  });

  return `
<section id="keyboard" aria-labelledby="keyboard-h">
  <h2 id="keyboard-h">Keyboard walkthrough</h2>
  <p>The page was operated with the Tab key only, the way a keyboard or switch user would. For every stop the suite took a screenshot with focus on the element and another without. If the two are pixel-identical, nothing on screen shows where focus is.</p>
  ${blocks.join('')}
</section>`;
}

// ───────────────────────── structure ─────────────────────────

interface OutlineData {
  title: string;
  lang: string;
  headings: { level: number; text: string }[];
  landmarks: { role: string; label: string }[];
  images: { alt: string | null; decorative: boolean; src: string; size: string }[];
  fields: { type: string; name: string; nameSource: string; autocomplete: string }[];
  linkCount: number;
}
interface OverviewData {
  title: string;
  lang: string | null;
  screenshot: string;
  accessibilityTree: string;
  accessibilityTreeLines: number;
  accessibilityTreePreview: string;
  blockedWrites: string[];
}

function structureSection(model: ReportModel): string {
  const outlines = infoOf<OutlineData>(model, 'structure-outline');
  const overviews = infoOf<OverviewData>(model, 'page-overview');
  if (outlines.length === 0 && overviews.length === 0) return '';

  const blocks = outlines.map((o) => {
    const d = o.data;
    const tree = overviews.find((v) => samePage(v.context, o.context))?.data;
    const label = where(model, o.context);
    return `
  <h3>${esc(label)}</h3>
  <p>Page title: <strong>${esc(d.title)}</strong>. Language: <code>${esc(d.lang || '(not set)')}</code>. ${num(d.headings.length)} headings, ${num(d.landmarks.length)} landmarks, ${num(d.images.length)} visible images, ${num(d.fields.length)} form fields, ${num(d.linkCount)} links.</p>
  <details class="plain">
    <summary>Heading outline (${d.headings.length})</summary>
    <ul class="outline">${d.headings.map((x) => `<li style="margin-left:${(x.level - 1) * 1.25}rem"><span class="tag">h${x.level}</span> ${x.text ? esc(x.text) : '<em>(empty)</em>'}</li>`).join('')}</ul>
  </details>
  <details class="plain">
    <summary>Landmarks (${d.landmarks.length})</summary>
    <ul class="compact">${d.landmarks.map((x) => `<li><code>${esc(x.role)}</code> ${x.label ? esc(x.label) : '<em>(no label)</em>'}</li>`).join('')}</ul>
  </details>
  <details class="plain">
    <summary>Form fields and how each is named (${d.fields.length})</summary>
    ${table(`Form fields, ${label}`, ['Field type', 'Announced as', 'Name comes from', 'autocomplete'], d.fields.map((x) => [esc(x.type), x.name ? esc(x.name) : '<em>(no name)</em>', esc(x.nameSource), x.autocomplete ? `<code>${esc(x.autocomplete)}</code>` : '<em>(none)</em>']))}
  </details>
  <details class="plain">
    <summary>Images and their text alternatives (${d.images.length})</summary>
    ${table(`Images, ${label}`, ['File', 'Alt text', 'Size'], d.images.map((x) => [`<code>${esc(x.src)}</code>`, x.decorative ? '<em>(marked decorative)</em>' : x.alt === null ? '<strong>(no alt attribute)</strong>' : esc(x.alt), esc(x.size)]))}
  </details>
  ${tree ? `<details class="plain">
    <summary>Accessibility tree: what a screen reader is given (first 60 of ${num(tree.accessibilityTreeLines)} lines)</summary>
    <pre tabindex="0" role="region" aria-label="Accessibility tree preview, ${esc(label)}">${esc(tree.accessibilityTreePreview)}</pre>
    <p class="small"><a href="${esc(tree.accessibilityTree)}">Full accessibility tree</a> · <a href="${esc(tree.screenshot)}">Full-page screenshot</a></p>
  </details>` : ''}`;
  });

  return `
<section id="structure" aria-labelledby="structure-h">
  <h2 id="structure-h">Page structure</h2>
  <p>Screen-reader users do not scan a page visually; they jump between headings, landmarks and form fields. This is the structure the page actually exposes to them.</p>
  ${blocks.join('')}
</section>`;
}

// ───────────────────────── low vision ─────────────────────────

function responsiveSection(model: ReportModel): string {
  const items = infoOf<Record<string, unknown>>(model, 'responsive');
  if (items.length === 0) return '';
  const label: Record<string, string> = { 'reflow-320': 'Reflow at 320 CSS px (400% zoom) — WCAG 1.4.10', 'zoom-200': '200% zoom — WCAG 1.4.4', 'text-spacing': 'WCAG text spacing applied — WCAG 1.4.12' };
  const rows = items.map((i) => {
    const d = i.data;
    const measured =
      i.context.state === 'text-spacing'
        ? `${num(Number(d.textContainersExamined))} clipping containers examined; horizontal overflow afterwards ${d.horizontalOverflowAfter}px`
        : `Viewport ${d.viewportWidth}px, content ${d.contentWidth}px, horizontal overflow ${d.overflow}px`;
    const here = (g: RuleGroup) => g.issues.filter((x) => x.finding.context.pageId === i.context.pageId && x.seenIn.some((s) => s.state === i.context.state));
    const found = model.groups.violation.concat(model.groups.review).filter((g) => g.source === 'responsive' && here(g).length > 0);
    const result = found.length ? found.map((g) => `${esc(g.title)} (${here(g).length})`).join('<br>') : 'Passed';
    return [...pageCell(model, i.context), esc(label[i.context.state] ?? i.context.state), esc(measured), result, d.screenshot ? `<a href="${esc(d.screenshot)}">Screenshot</a>` : ''];
  });
  return `
<section id="low-vision" aria-labelledby="low-vision-h">
  <h2 id="low-vision-h">Zoom, reflow and text spacing</h2>
  <p>People with low vision enlarge the page or loosen the text spacing. The layout has to adapt without cutting content off or forcing sideways scrolling.</p>
  ${table('Low-vision adaptation checks', [...pageHead(model), 'Check', 'Measured', 'Result', 'Evidence'], rows)}
</section>`;
}

// ───────────────────────── method ─────────────────────────

function methodSection(model: ReportModel): string {
  const blocked = [...new Set(infoOf<OverviewData>(model, 'page-overview').flatMap((o) => o.data.blockedWrites))];
  const selfcheck = model.tests.filter((t) => t.file.startsWith('00-selfcheck'));
  const errors = model.tests.filter((t) => t.kind === 'error');
  return `
<section id="method" aria-labelledby="method-h">
  <h2 id="method-h">How this audit works</h2>
  <p>Accessibility means people can perceive and operate the page with a keyboard, a screen reader, magnification or high contrast. The standard is WCAG; each requirement is a numbered success criterion. No single technique covers it, so the suite works in three layers.</p>
  ${table('The three layers of the audit', ['Layer', 'What it does', 'What it examines'], [
    ['1. Rules engine (axe-core)', 'Runs about a hundred rules against the rendered page: its DOM, computed styles and accessibility tree.', 'Every image, link, button, form field, heading, landmark, ARIA attribute, table, frame, and the contrast of every piece of text.'],
    ['2. Interaction states', 'Drives the page into each state it defines, then runs layer 1 on what appeared.', 'Content that only exists once something is opened, such as a menu or a validation message. A rules engine cannot see these until something opens them.'],
    ['3. Behaviour', 'Uses the page like a keyboard user and a low-vision user would.', 'Tab order, focus visibility (by comparing screenshots), focus traps, skip links, mouse-only controls, reflow at 320px, 200% zoom, text spacing, and the meaning of alt text, headings and link text.'],  ])}
  <h3>How to read a finding</h3>
  <ul>
    <li><strong>Violation</strong>: a rule with an objective pass/fail condition failed. Reproducible; safe to raise as a defect.</li>
    <li><strong>Needs review</strong>: the engine could not measure the element, or the check is a heuristic. Likely a problem, but a person decides.</li>
    <li><strong>Advisory</strong>: best practice beyond WCAG A/AA. Never fails the run.</li>
    <li><strong>Severity</strong> follows axe-core's impact scale: critical blocks a task outright for some users; serious makes it very difficult; moderate and minor cause friction.</li>
    <li><strong>Owner</strong> says who can fix it: the site's own code, or third-party content embedded in the page.</li>
  </ul>

  <h3>What automation cannot tell you</h3>
  <p>Automated checks find a subset of WCAG issues and cannot establish conformance. This report shows what is certainly wrong; it does not show that everything else is right. Before claiming conformance, a person still needs to check:</p>
  <ul>
    <li>A full pass with a screen reader (NVDA or JAWS on Windows, VoiceOver on iOS, TalkBack on Android): is the donation flow understandable by ear alone?</li>
    <li>Whether each image's alt text conveys what the image is for, not just that it has one.</li>
    <li>Whether the reading and focus order makes sense, not just that it is unbroken.</li>
    <li>Colour used as the only signal (errors, funding progress, required fields) and contrast of text over images.</li>
    <li>Motion and timing: auto-rotating content, session timeouts.</li>
    <li>Captions and transcripts for any video or audio.</li>
    <li>Anything behind a sign-in or a real payment step, which this suite does not reach.</li>
    <li>Every item under "Needs review" above.</li>
  </ul>

  <h3>Run health</h3>
  <p>${num(model.tests.length)} tests ran. ${errors.length ? `<strong>${plural(errors.length, 'test')} hit a suite error</strong> (the test itself broke, so its results are missing):` : 'No test broke; every red result is an accessibility finding, not a tooling failure.'}</p>
  ${errors.length ? `<ul>${errors.map((e) => `<li>${esc(e.project)} · ${esc(e.title)}: <code>${esc(e.message.split('\n')[0])}</code></li>`).join('')}</ul>` : ''}
  <p>${selfcheck.length ? `Detector self-check: ${selfcheck.every((t) => t.kind === 'passed') ? 'passed. Every defect planted in a known-bad fixture page was reported, and a known-good page reported nothing, so a clean result from these checks is meaningful.' : '<strong>FAILED. The checks did not behave as expected on the fixture pages; treat this report with caution.</strong>'}` : 'Detector self-check was not part of this run.'}</p>
  <p>The audit is read-only. Requests that would change anything on the site (anything other than GET) are blocked before they leave the browser${blocked.length ? `; in this run that stopped: ${blocked.map((b) => `<code>${esc(b)}</code>`).join(', ')}` : ''}.</p>
  <details class="plain">
    <summary>All tests (${model.tests.length})</summary>
    ${table('Test outcomes', ['Test', 'Viewport', 'Outcome', 'Seconds'], model.tests.map((t) => [esc(t.title), esc(t.project), t.kind === 'a11y' ? 'Accessibility findings' : t.kind === 'error' ? '<strong>Suite error</strong>' : t.kind === 'skipped' ? 'Skipped (state not present)' : 'Passed', (t.durationMs / 1000).toFixed(1)]))}
  </details>
</section>`;
}

// ───────────────────────── page ─────────────────────────

const STYLE = `
:root{color-scheme:light;--plane:#f9f9f7;--surface:#fcfcfb;--ink:#0b0b0b;--ink-2:#52514e;--line:#e1e0d9;--line-2:#c3c2b7;--code:#f0efec;--link:#184f95;--critical:#d03b3b;--serious:#ec835a;--warning:#fab219;--good:#0ca30c;--minor:#898781;--fail-bg:#fbeaea;--warn-bg:#fdf3dc;--ok-bg:#e6f5e6}
@media (prefers-color-scheme:dark){:root{color-scheme:dark;--plane:#0d0d0d;--surface:#1a1a19;--ink:#fff;--ink-2:#c3c2b7;--line:#2c2c2a;--line-2:#383835;--code:#2c2c2a;--link:#9ec5f4;--fail-bg:#3a1a1a;--warn-bg:#3a2e10;--ok-bg:#12301a}}
*{box-sizing:border-box}
body{margin:0;background:var(--plane);color:var(--ink);font:16px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}
a{color:var(--link);text-decoration:underline}
:focus-visible{outline:3px solid var(--link);outline-offset:2px}
.skip{position:absolute;left:8px;top:-80px;background:var(--surface);padding:8px 12px;border:2px solid var(--link);z-index:5}
.skip:focus{top:8px}
header.top,main,footer.bottom{max-width:1180px;margin:0 auto;padding:0 20px}
header.top{padding-top:28px}
h1{font-size:1.75rem;margin:0 0 4px;line-height:1.2}
h2{font-size:1.4rem;margin:0 0 8px;line-height:1.25}
h3{font-size:1.08rem;margin:22px 0 6px}
h4{font-size:1rem;margin:18px 0 6px}
p{margin:0 0 12px}
.lede{color:var(--ink-2);margin:0}
.small{font-size:.9rem;color:var(--ink-2)}
.h-count{font-size:.95rem;font-weight:400;color:var(--ink-2);margin-left:6px}
nav.toc{margin:18px 0 0;padding:10px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
nav.toc ul{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:4px 18px}
section{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:22px 24px;margin:20px 0}
.verdict{display:flex;gap:14px;align-items:flex-start;padding:14px 16px;border-radius:8px;margin:0 0 18px;border:1px solid var(--line-2)}
.verdict svg{width:28px;height:28px;flex:none;margin-top:2px}
.verdict p{margin:0}
.verdict-head{font-size:1.15rem;font-weight:650}
.verdict.fail{background:var(--fail-bg)}.verdict.warn{background:var(--warn-bg)}.verdict.ok{background:var(--ok-bg)}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin:0 0 10px}
.tile{border:1px solid var(--line);border-radius:8px;padding:12px 14px;background:var(--plane)}
.tile dt{font-size:.88rem;color:var(--ink-2)}
.tile dd{margin:2px 0 0;font-size:1.7rem;font-weight:650;line-height:1.15}
.tile.hero{grid-column:span 2}
.tile.hero dd{font-size:3.1rem}
.tiles.quiet .tile dd{font-size:1.25rem}
.of{font-size:.9rem;font-weight:400;color:var(--ink-2)}
.sev{display:inline-flex;align-items:center;gap:6px;text-transform:capitalize;white-space:nowrap}
.sev svg{width:14px;height:14px;flex:none}
.cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:0 24px}
.scroll{overflow-x:auto;margin:14px 0}
table{border-collapse:collapse;width:100%;font-size:.93rem}
caption{text-align:left;font-weight:650;padding:0 0 6px}
th,td{text-align:left;vertical-align:top;padding:7px 10px;border-bottom:1px solid var(--line)}
thead th{border-bottom:2px solid var(--line-2);white-space:nowrap}
tbody th{font-weight:500}
td{font-variant-numeric:tabular-nums}
code,pre{font:0.86em/1.45 ui-monospace,SFMono-Regular,Consolas,monospace;background:var(--code);border-radius:4px}
code{padding:1px 5px;overflow-wrap:anywhere}
pre{padding:12px;overflow-x:auto;white-space:pre}
details.rule{border:1px solid var(--line);border-radius:8px;margin:10px 0;background:var(--plane)}
details.rule>summary{padding:12px 14px;cursor:pointer;display:flex;flex-wrap:wrap;gap:4px 16px;align-items:baseline}
details.rule>summary h3{margin:0;font-size:1.02rem;flex:1 1 320px}
.meta{display:inline-flex;flex-wrap:wrap;gap:4px 16px;font-size:.9rem;color:var(--ink-2)}
.rule-body{padding:4px 16px 14px;border-top:1px solid var(--line)}
.rule-body>p:first-child{margin-top:12px}
details.plain{margin:10px 0}
details.plain>summary{cursor:pointer;font-weight:600;padding:4px 0}
ul.issues{list-style:none;margin:0;padding:0}
.issue{border:1px solid var(--line);border-radius:8px;background:var(--surface);padding:12px 14px;margin:10px 0}
.issue[hidden],details.rule[hidden]{display:none}
.where{margin:0 0 6px;display:flex;flex-wrap:wrap;gap:6px}
.tag{display:inline-block;font-size:.8rem;border:1px solid var(--line-2);border-radius:999px;padding:1px 9px;color:var(--ink-2);background:var(--surface)}
.why{margin:0 0 8px}
.facts{display:grid;grid-template-columns:max-content 1fr;gap:4px 12px;margin:0;font-size:.9rem}
.facts dt{color:var(--ink-2)}
.facts dd{margin:0;min-width:0}
.shot{display:inline-block;margin-top:10px}
.shot img{max-width:100%;max-height:240px;border:1px solid var(--line-2);border-radius:6px;display:block}
ul.compact{margin:6px 0;padding-left:20px;font-size:.93rem}
ul.outline{list-style:none;margin:6px 0;padding:0;font-size:.95rem}
ul.outline li{padding:2px 0}
.empty{color:var(--ink-2);font-style:italic}
.filter{display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center;margin:20px 0 0;padding:12px 16px;background:var(--surface);border:1px solid var(--line);border-radius:10px}
.filter select{font:inherit;max-width:100%;padding:5px 8px;border:1px solid var(--line-2);border-radius:6px;background:var(--surface);color:var(--ink)}
footer.bottom{padding:8px 20px 40px;color:var(--ink-2);font-size:.9rem}
@media (max-width:640px){section{padding:16px}.tile.hero{grid-column:span 1}.facts{grid-template-columns:1fr}}
`;

const SCRIPT = `
(function () {
  var select = document.getElementById('owner');
  var page = document.getElementById('page');
  var status = document.getElementById('owner-status');
  if (!select) return;
  function filter() {
    var shown = 0, total = 0;
    document.querySelectorAll('.issue').forEach(function (el) {
      total++;
      var show = (select.value === 'all' || el.getAttribute('data-owner') === select.value) && (!page || page.value === 'all' || el.getAttribute('data-page') === page.value);
      el.hidden = !show;
      if (show) shown++;
    });
    document.querySelectorAll('details.rule').forEach(function (rule) {
      var n = rule.querySelectorAll('.issue:not([hidden])').length;
      rule.hidden = n === 0;
      var count = rule.querySelector('.count');
      if (count) count.textContent = n;
    });
    status.textContent = 'Showing ' + shown + ' of ' + total + ' findings.';
  }
  select.addEventListener('change', filter);
  if (page) page.addEventListener('change', filter);
})();
`;

export function renderHtml(model: ReportModel): string {
  const subject = several(model) ? `${model.pages.length} pages` : (model.pages[0]?.name ?? 'report');
  // Views of a single-page app share one address, so pages are listed under the address they load from.
  const addresses = new Map<string, string[]>();
  for (const p of model.pages) addresses.set(p.url, [...(addresses.get(p.url) ?? []), p.name]);
  const when = `${model.generatedAt.slice(0, 10)} ${model.generatedAt.slice(11, 16)} UTC`;
  const owners = [...new Set([...model.groups.violation, ...model.groups.review, ...model.groups.advisory].flatMap((g) => g.issues.map((i) => i.finding.owner)))].sort();
  const has = (topic: string) => model.info.some((i) => i.topic === topic);

  const toc: [string, string][] = [
    ['summary', 'Summary'],
    ['violations', `Violations (${model.totals.violationTotal})`],
    ['review', `Needs review (${model.totals.review})`],
    ['advisory', `Advisory (${model.totals.advisory})`],
    ['coverage', 'What was tested'],
    ...(has('tab-order') ? ([['keyboard', 'Keyboard']] as [string, string][]) : []),
    ...(has('structure-outline') || has('page-overview') ? ([['structure', 'Structure']] as [string, string][]) : []),
    ...(has('responsive') ? ([['low-vision', 'Zoom and reflow']] as [string, string][]) : []),
    ['method', 'How it works'],
  ];

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Accessibility audit: ${esc(subject)}</title>
<style>${STYLE}</style>
</head>
<body>
<a class="skip" href="#main">Skip to report</a>
<header class="top">
  <h1>Accessibility audit report</h1>
  <p class="lede">${[...addresses].map(([url, names]) => `${names.map(esc).join(' · ')}: <a href="${esc(url)}">${esc(url)}</a>`).join('<br>')}</p>
  <p class="lede">${esc(model.standard)} · ${esc(model.engines.join(', ') || 'custom checks')} plus custom keyboard, structure and reflow checks · ${esc(model.viewports.join(', '))} · generated ${esc(when)}</p>
  <nav class="toc" aria-label="Report sections"><ul>${toc.map(([id, text]) => `<li><a href="#${id}">${esc(text)}</a></li>`).join('')}</ul></nav>
</header>
<main id="main" tabindex="-1">
  ${overview(model)}
  <div class="filter">
    <label for="owner">Show findings owned by</label>
    <select id="owner"><option value="all">Everyone</option>${owners.map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join('')}</select>
    ${several(model) ? `<label for="page">on page</label>
    <select id="page"><option value="all">All pages</option>${model.pages.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select>` : ''}
    <span id="owner-status" class="small" role="status" aria-live="polite"></span>
  </div>
  ${bucketSection(model, 'violation')}
  ${bucketSection(model, 'review')}
  ${bucketSection(model, 'advisory')}
  ${coverageSection(model)}
  ${keyboardSection(model)}
  ${structureSection(model)}
  ${responsiveSection(model)}
  ${methodSection(model)}
</main>
<footer class="bottom">
  <p>Generated by the accessibility suite (Playwright + axe-core). Raw data: <a href="a11y-results.json">a11y-results.json</a> · <a href="a11y-violations.csv">a11y-violations.csv</a> · <a href="playwright-html/index.html">Playwright test report</a>.</p>
</footer>
<script>${SCRIPT}</script>
</body>
</html>`;
}
