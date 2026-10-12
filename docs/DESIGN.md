# Accessibility Test Automation — Design

Target standard: **WCAG 2.2 Level AA**. Stack: Playwright Test, TypeScript, axe-core.
Pages under test: the six views of the University of Andhra Fundraiser demo app, a single-page
app audited from a local copy (`demo/fundraiser/index.html`).

## 1. What "testing accessibility" means

A page is accessible when people can perceive and operate it with a keyboard, a screen reader,
magnification, or high contrast. WCAG turns that into numbered success criteria (1.4.3 Contrast,
2.1.1 Keyboard, 4.1.2 Name/Role/Value, and so on).

No single technique can check all of them. A rules engine reads the page; it does not use it. So
the suite has three layers, each covering what the one before it cannot see.

| Layer | What it does | What it examines | Spec |
|---|---|---|---|
| **1. Rules engine** | Runs axe-core's ~100 rules against the rendered DOM, computed styles and accessibility tree | Every image, link, button, field, heading, landmark, ARIA attribute, table, frame; contrast of every text node | `01-axe-baseline` |
| **2. Interaction states** | Drives the page into a state, then runs layer 1 on what appeared | Content that exists only once something is opened, such as a menu or a validation message. No states are defined for the Fundraiser pages yet | `02-axe-states` |
| **3. Behaviour** | Uses the page like a keyboard user and a low-vision user | Tab order, focus visibility, traps, skip links, mouse-only controls, reflow, zoom, text spacing, meaning of alt text / headings / links | `03`, `04`, `05` |

`00-selfcheck` sits underneath all of them: it runs every detector against a fixture page with 16
planted defects and against a clean page. All 16 must be reported and the clean page must report
nothing. Without it, "no violations" could mean "nothing checked".

### What axe-core returns

Four lists per scan, and the report uses all four:

- **violations** — the rule ran and the element failed. Reported as `violation`.
- **incomplete** — axe could not decide (e.g. text over an image). Reported as `needs-review`.
- **passes** — the element satisfied the rule. Becomes the "What was tested" table.
- **inapplicable** — nothing on the page matched the rule. Listed so it is clear it was not skipped.

This is how the report answers "which elements did it test", not only "which failed".

## 2. Architecture

```
tests/*.spec.ts
   │  loop over config/pages.ts
   ▼
audit fixture ─────────────── src/fixtures/a11y.fixture.ts
   │ open()    read-only guard, steps into a single-page app's view, readiness,
   │           lazy-load pass
   │ scan()    axe-core                      ── src/core/axeScanner.ts
   │ record()  custom checks                 ── src/checks/*.ts
   ▼
publish:  annotate owner + region            ── src/core/ownership.ts
          fingerprint                        ── src/core/findings.ts
          element screenshots                ── src/core/evidence.ts
          testInfo.attach(JSON)              (works across workers and retries)
          soft-assert the gate               (A11Y_FAIL_ON)
   ▼
A11yReporter.onEnd ────────── src/reporting/a11yReporter.ts
          de-duplicate into issues           ── src/reporting/model.ts
          a11y-report.html / .csv / .json    ── src/reporting/htmlTemplate.ts
```

### One finding shape for every layer

axe results and custom checks both produce the same record, so they land in one report and one CSV:

`source · ruleId · status · severity · level · wcag[] · title · description · helpUrl · target ·
html · failureSummary` plus, once published, `owner · region · screenshot · fingerprint · context
(page, state, viewport)`.

### Status: the line between fact and judgement

| Status | Meaning | Fails the run? |
|---|---|---|
| `violation` | A rule with an objective pass/fail condition failed. Reproducible; raise as a defect. | Yes, at or above `A11Y_FAIL_ON`, for Level A/AA rules |
| `needs-review` | The engine could not measure it, or the check is a heuristic. A person decides. | No |
| advisory | Best-practice or AAA, whatever its status. | No |

A custom check is only allowed to emit `violation` when its condition is objective. Everything
that involves judgement (is this alt text meaningful, is this bold line a heading) is
`needs-review`.

## 3. Coverage

| Area | Elements examined | How | WCAG |
|---|---|---|---|
| Text alternatives | `img`, `svg`, image links, icon buttons | axe; plus alt that is a file name, a placeholder, or empty on a large/linked image | 1.1.1 |
| Structure | headings, landmarks, lists, tables, ARIA parent/child roles | axe; plus bold paragraphs used as headings; outline exported | 1.3.1, 2.4.6 |
| Input purpose | email / phone / name / address fields | missing `autocomplete` | 1.3.5 |
| Contrast | every text node | axe `color-contrast` | 1.4.3 |
| Zoom | whole page at 200% | horizontal overflow at a 683px viewport | 1.4.4 |
| Reflow | whole page at 320px | horizontal scroll; clipped content | 1.4.10 |
| Text spacing | every container that hides overflow | apply WCAG spacing, find newly clipped text | 1.4.12 |
| Keyboard | every tab stop; ARIA controls outside the tab order; pointer-cursor non-controls; hover submenus | real Tab presses | 2.1.1 |
| No trap | every tab stop | focus stuck for 3 presses | 2.1.2 |
| Bypass | skip links | activate, confirm focus lands at the target | 2.4.1 |
| Focus order | every tab stop | focus dropped to `<body>`; invisible stops; order exported | 2.4.3 |
| Link purpose | every link | axe `link-name`; generic text; same text to different URLs | 2.4.4 |
| Focus visible | every tab stop | **screenshot with focus vs without; identical pixels = no indicator** | 2.4.7 |
| Focus not obscured | every tab stop | all sample points covered by fixed/sticky content | 2.4.11 |
| Target size | interactive controls | axe `target-size` | 2.5.8 |
| Language, title | document | axe | 3.1.1, 2.4.2 |
| Errors | displayed validation messages | `aria-invalid` + `aria-describedby`; announced via focus or live region | 3.3.1, 4.1.3 |
| Labels | form fields | axe `label`; named only by placeholder or title | 3.3.2 |
| Name, role, state | buttons, links, tabs, combobox, dialogs, tab stops | axe ARIA rules; active tab `aria-selected`; combobox `aria-expanded`; unnamed tab stops; dialog name | 4.1.2 |
| Dialogs | modal popup | focus moves in, stays in, Escape closes | 2.4.3 |

The error, dialog and hover-submenu checks need a state to be open, so they run only inside an
interaction state (layer 2); the self-check exercises the error check against its fixture pages.

Not covered by automation, and listed in every report as a manual checklist: a screen-reader
pass, whether alt text is *meaningful*, whether reading order makes sense, colour as the only
signal, motion and timing, captions, and anything behind a sign-in or a real payment step. The
narrated walk (§5) simulates what is announced at each tab stop; it does not replace the
screen-reader pass.

## 4. Design decisions

**Scope each state scan to what changed.** A menu-open scan includes only the menu subtree.
Whole-page rescans would re-report the baseline in every test and bury the state's own findings.

**De-duplicate by fingerprint.** An issue is one element failing one rule. The same issue seen at
two viewports and in three states is one row with five sightings. Generated tokens in selectors
(random iframe names, per-load ids) are masked so identity survives a reload.

**Tag every finding with an owner.** Third-party content such as a chat widget, a payment frame
or an embed injects UI the site does not control. The site is accountable for the whole page, but
the fix path differs, so the report separates "your code" from "raise with the vendor". Ownership
is decided by walking up from the element, not by matching selector text. The Fundraiser embeds
nothing from outside, so `owners` in `config/a11y.config.ts` is empty and every finding is
First-party; add one entry per vendor when a page embeds one.

**Decide focus visibility with pixels, not CSS.** A CSS comparison of outline/box-shadow is a
guess; focus styles can live on a parent or a pseudo-element. The suite photographs each tab stop
focused and unfocused. Identical images are an objective failure. Any difference counts as "has
an indicator", so the check can miss a failure but cannot invent one.

**Never call a frame a trap from the outside.** Focus inside a cross-origin iframe is invisible to
the top document. If a frame absorbs many Tab presses and more controls follow it, that is
`needs-review`. If the frame is the last focusable thing on the page, automation has no browser
toolbar for focus to move to, so the walk is recorded as ended there, not as a trap.

**Read-only by construction.** Every non-GET request to the audited site's own domain is aborted
in the browser, so the suite can be pointed at a live site. One worker.

**Soft assertions, no retries.** Every check in a test runs and reports even after an earlier one
fails. Retries default to 0: accessibility failures are deterministic, so retrying a red test only
doubles the traffic to a live site.

**Probe before coding.** Every selector the suite depends on (the Fundraiser's menu, project
tiles, donation-form fields) was read from the page first. None were assumed.

## 5. The narrated keyboard walk

`npm run narrate` records the page being walked with Tab. At each stop the element is boxed and a
voice reads what a screen reader would announce for it. It is a review and demonstration aid, not
a fourth audit layer: it finds nothing the keyboard audit does not, it makes those findings audible.

```
narration/screen-reader.spec.ts          own config, so the audit report is never rewritten
   openPage()                            same read-only guard as the audit
   page.screencast.start()               silent WebM
   tabWalk({ onStop })                   the audit's own walk, so stops are numbered the same way
      Accessibility.getPartialAXTree     name, role, states, and where the name came from
      announce()                         "Give Now, button" · "unlabelled button"
      Speaker.say()                      Windows voice → audio clip
      screencast.showOverlay()           box and caption, held for the length of the clip
   narrationTrack() + ffmpeg             clips laid on one track at their timestamps → MP4
```

**The words come from the browser, not from a screen reader.** Each phrase is built from the
accessibility node Chromium exposes for the focused element, read over CDP. That is the data NVDA
or JAWS would be handed, so a missing name here is a missing name there. The phrasing (name,
role, states, value, description; "edit", "combo box", "graphic") follows NVDA but is this
suite's own. The audit's simplified name computation in `browser.ts` is not used for speech.

**Sound is added afterwards.** Playwright video has no audio track and its bundled ffmpeg has no
audio codecs, so each phrase is synthesized to a clip, the clips are laid on one silent track at
the moment their overlay appeared, and `ffmpeg-static` joins that track to the recording. The
sound track is MP3 rather than the usual AAC: VS Code's built-in video preview has no AAC
decoder, so an H.264 + AAC file opened from the explorer plays its picture with no sound.

**Time zero is the first frame.** The recorder timestamps frames by wall clock and the finished
file starts at the first one, so each overlay's position in the video is its wall-clock time
minus that frame's timestamp. Measured in the finished files: the caption appears within two
frames (80 ms) of that position and speech starts 40–75 ms after it.

**A stop with nothing to say is still spoken.** An empty name, or one made only of icon-font
glyphs, is read as "unlabelled" plus the role, boxed in red, and marked `silent` in the
transcript. Silence in the video would look like a recording fault.

**It does not gate.** Unnamed stops are already findings (`kbd-stop-unnamed`, axe name rules). A
second gate on the same condition would only make a video run exit red.

**Self-checked like the detectors.** `npm run narrate:selfcheck` narrates both fixture pages and
then opens the finished files: the phrases and name sources are exact, the planted unnamed
button and input are `silent`, the tab order equals a plain `tabWalk`, and for every stop the
caption is on screen and speech is audible while it is shown and neither is before it.

## 6. Custom rule catalogue

Defined in [src/checks/rules.ts](../src/checks/rules.ts). `V` = violation, `R` = needs review.

| Rule | | WCAG | Condition |
|---|---|---|---|
| `kbd-focus-trap` | V | 2.1.2 | Focus on the same element for 3 Tab presses |
| `kbd-focus-not-visible` | V | 2.4.7 | Focused and unfocused screenshots are pixel-identical |
| `kbd-skip-link-broken` | V | 2.4.1 | Target missing, or focus does not reach it |
| `tab-selected-state` | V | 4.1.2 | Tab's panel is displayed but `aria-selected` is not `true` |
| `combobox-expanded-state` | V | 4.1.2 | Popup displayed but `aria-expanded` is not `true` |
| `error-not-associated` | V | 3.3.1 | Visible error, field lacks `aria-invalid` + `aria-describedby` |
| `reflow-horizontal-scroll` | V | 1.4.10 | Page scrolls sideways at 320px |
| `kbd-frame-not-exited` | R | 2.1.2 | Frame absorbs 25 presses with controls after it |
| `kbd-focus-lost` | R | 2.4.3 | Tab leaves focus on `<body>` mid-page |
| `kbd-focus-hidden-element` | R | 2.4.7 | Tab stop is not rendered or is off-screen |
| `kbd-focus-obscured` | R | 2.4.11 | Tab stop fully covered by pinned content |
| `kbd-stop-unnamed` | R | 4.1.2 | Tab stop has no accessible name |
| `kbd-not-focusable` | R | 2.1.1 | Interactive ARIA role, not in tab order |
| `kbd-mouse-only` | R | 2.1.1 | Pointer cursor, not a control, not focusable |
| `kbd-submenu-not-openable` | R | 2.1.1 | Hover submenu does not open from the keyboard |
| `kbd-skip-link-not-first` / `-missing` | R | 2.4.1 | Skip link late in tab order / absent |
| `img-alt-filename` / `-placeholder` | R | 1.1.1 | Alt is a file name, ID, or generic word |
| `img-decorative-large` | R | 1.1.1 | Empty alt on a large or link-only image |
| `heading-visual-only` | R | 1.3.1 | Bold paragraph introducing body text |
| `link-ambiguous-text` | R | 2.4.4 | Generic text, or same text to different URLs |
| `field-name-weak` | R | 3.3.2 | Named only by placeholder or title |
| `field-purpose-missing` | R | 1.3.5 | Personal-data field without `autocomplete` |
| `error-not-announced` | R | 4.1.3 | Error appears with focus elsewhere and no live region |
| `reflow-clipped-content` | R | 1.4.10 | Extends past 320px with no sideways scroll |
| `zoom-200-overflow` | R | 1.4.4 | Overflow at 200% zoom |
| `text-spacing-clipped` | R | 1.4.12 | Newly clipped under WCAG text spacing |
| `dialog-focus-not-moved` / `-not-contained` / `-name-generic` | R | 2.4.3, 4.1.2 | Modal dialog focus and naming |
| `dialog-no-escape`, `link-new-window` | R | best practice | Advisory |

## 7. Limits

- Automation finds a subset of WCAG issues and cannot establish conformance.
- Chromium only. axe results are largely engine-independent; focus rendering is not.
- The accessible name used in inventories is a simplified computation, not the full spec algorithm.
- Pixel comparison treats any on-screen change as a focus indicator, including unrelated motion.
  It can miss a missing indicator next to animated content.
- Leaving a frame at the very end of the page cannot be observed under automation.
- Third-party content is not fixed. A vendor can serve different content on different page loads,
  so expect vendor-owned counts to move between runs. Each state is photographed when it is
  scanned so the report shows what was actually audited.
- `siteDomain()` assumes a single-label TLD (`example.com`, not `example.co.uk`).
- The narrated walk is a simulation. A real screen reader may word, order or skip things
  differently, and what it reads outside the tab order (headings, text, images) is not narrated.
  It needs Windows (System.Speech) and Chromium (CDP). Its stop numbers follow the audit's, but
  two loads of a live page can differ.

## 8. Backlog

Baseline file so CI fails only on *new* violations · CI pipeline · filing Jira defects from the CSV ·
real screen-reader automation (NVDA / VoiceOver), as the narration's source of phrases ·
narration in full reading order · Firefox and WebKit projects · interaction states for the
Fundraiser (mobile menu, donation-form errors) · sitemap crawl.
