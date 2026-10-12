# Accessibility Testing: University of Andhra Fundraiser

Playwright + axe-core suite that audits the University of Andhra Fundraiser demo app against
**WCAG 2.2 Level AA** and writes a report listing every element that falls short, why, and who
can fix it. Six views of the app are audited at a desktop and a mobile viewport.

The design, and an explanation of how accessibility testing works, is in
[docs/DESIGN.md](docs/DESIGN.md).

## Run it

```bash
npm install
npx playwright install chromium

npm test                 # full audit, desktop + mobile
npm run test:audit       # same, but never fails the run (report only)
npm run test:desktop     # one viewport
npm run test:selfcheck   # prove the detectors work, no network needed
npm run check:report     # scan the generated report itself with axe-core (light + dark)
npm run typecheck

npm run narrate            # video of the keyboard walk with spoken screen-reader announcements
npm run narrate:selfcheck  # prove the narration is right and in sync, no network needed
```

The run exits non-zero when blocking violations are found. That is the audit doing its job, not
the suite breaking; the summary printed at the end separates the two ("suite error(s)").

## Read the results

Everything lands in `reports/`:

| File | What it is |
|---|---|
| `a11y-report.html` | The report. Open this first. |
| `a11y-violations.csv` | One row per failing element, for triage or importing into a tracker. |
| `a11y-results.json` | The full model behind the report. |
| `evidence/` | Screenshots of failing elements, full-page captures, the accessibility tree. |
| `playwright-html/` | Playwright's own test report (`npm run report`). |

A partial run (one spec, one project) rewrites the report with only what that run covered.

## Narrated keyboard walk

`npm run narrate` records each page being walked with Tab. Every stop is boxed in turn while a
voice reads what a screen reader would announce for it. A stop with nothing to announce is boxed
in red and spoken as "unlabelled …". Output goes to `reports/narration/<page id>/`:

| File | What it is |
|---|---|
| `screen-reader.mp4` | The video, with sound (H.264 + MP3, so it is also audible in VS Code's built-in preview). |
| `screen-reader.vtt` | Captions for the video. |
| `transcript.csv`, `transcript.json` | One row per stop: what was spoken, the role and name, where the name came from (`aria-label`, `label`, `contents`, `placeholder`, …), and its time in the video. |

The speech is a simulation. The name, role and state are read from Chromium's accessibility tree,
which is the data a screen reader is given, and spoken with a Windows voice. It is not NVDA or
JAWS output, it covers tab stops only, and it runs on Windows only.

It has its own config ([playwright.narrate.config.ts](playwright.narrate.config.ts)), so it never
rewrites the audit report, and it does not fail on what it finds: the audit already reports
unnamed stops as `kbd-stop-unnamed`. Stops are numbered the same way as the Keyboard tab of the
report, but a live page can serve different content from one load to the next, so the numbers
can shift between runs.

## Run it in GitHub Actions

[.github/workflows/accessibility.yml](.github/workflows/accessibility.yml) runs the audit and the
narration on GitHub's Windows runners. It is manual: open the **Actions** tab, choose
**Accessibility audit and narration**, then **Run workflow**. (The workflow has to be on the
default branch before the button appears.)

| Input | Default | Effect |
|---|---|---|
| `run` | `both` | `audit`, `narration` or `both`. The two are separate jobs and run in parallel. |
| `fail_on` | `serious` | Severity that fails the audit job; `none` reports without failing. Same as `A11Y_FAIL_ON`. |
| `urls` | (empty) | Comma-separated URLs to test instead of the Fundraiser demo. Same as `A11Y_URLS`. |
| `voice` | `Microsoft Zira Desktop` | Windows voice. If the runner does not have it, the first English voice is used and the run says so. |
| `voice_rate` | `0` | Speaking rate, `-10` to `10`. |
| `narrate_max` | (empty) | Narrate only the first N tab stops, for a quick trial. |

Each run page shows a summary, and two artifacts are kept for 14 days:

- `accessibility-report`: `a11y-report.html` (open it first), the CSV and JSON, the evidence screenshots, and Playwright's own report.
- `narration-videos`: one folder per page with `screen-reader.mp4`, the captions and the transcript.

The audit job goes red when violations at or above `fail_on` are found; the report is uploaded
either way. The narration job does not gate on what it finds. It runs `npm run narrate:selfcheck`
first as a warning-only check that the voice and picture are in step on that runner.

The narration needs the Windows speech synthesizer, so it cannot run on a Linux runner. The audit
runs on Windows too so its results match a local `npm test`; to move it to Linux, change its
`runs-on` and expect small differences from font fallback.

## Settings

| Variable | Default | Effect |
|---|---|---|
| `A11Y_FAIL_ON` | `serious` | Lowest severity that fails a test: `critical`, `serious`, `moderate`, `minor`, or `none`. |
| `A11Y_URLS` | (unset) | Comma-separated URLs to audit instead of the registry. Generic checks only. |
| `HEADED` | (unset) | `1` shows the browser. |
| `A11Y_CHANNEL` | (unset) | `chrome` uses installed Chrome instead of bundled Chromium. |
| `A11Y_RETRIES` | `0` | Retries per test. Leave at 0 unless the site is unstable. |
| `A11Y_TRACE` | (unset) | `1` keeps a Playwright trace for failed tests. |
| `A11Y_VOICE` | `Microsoft Zira Desktop` | Installed Windows voice used for narration. |
| `A11Y_VOICE_RATE` | `0` | Narration speaking rate, `-10` (slowest) to `10`. |
| `A11Y_NARRATE_MAX` | (unset) | Narrate only the first N tab stops. |
| `A11Y_FFMPEG` | (unset) | Path to an ffmpeg executable, if the one `npm install` downloads is unavailable. |

PowerShell: `$env:A11Y_FAIL_ON = 'none'; npx playwright test`

## Add a page

Add an entry to [config/pages.ts](config/pages.ts):

```ts
{
  id: 'about-us',                       // stable; used in fingerprints and file names
  name: 'About us',
  url: 'https://example.com/about',
  type: 'generic',                      // selects which interaction states apply
  ready: ['h1'],                        // selectors that must be visible before auditing
}
```

Every spec loops over the registry, so the page gets the rules engine, keyboard, structure and
responsive checks with no further code. Interaction states (an opened menu, a shown validation
message) are per page type; none are defined for the Fundraiser pages yet. To add a set, write
it in [src/states/states.ts](src/states/states.ts) and return it from `statesFor`.

The report lists findings per page and can be filtered to one page. To audit only some of the
registry, match on the page name, which is part of every test title:

```bash
npx playwright test -g "Fundraiser:"          # every page whose name contains "Fundraiser:"
npx playwright test -g "Fundraiser: FAQ"      # one page
```

### Pages of a single-page app

Some apps show every view at one address and route in memory, so a view has no URL to put in
`url`. Give such a page an `enter` function: the steps a user takes to reach the view from `url`.
It runs after `url` loads; `ready` is awaited afterwards, and the audit then starts from the top
of the document as it would on a freshly loaded page.

```ts
{
  id: 'fundraiser-about',
  name: 'Fundraiser: About',
  url,                                  // the same address for every view of the app
  type: 'generic',
  ready: ['.feature-grid'],             // something only this view has
  enter: (page) => page.locator('#site-nav a[href="/about"]').click(),
}
```

`enter` runs at every viewport, including the 320px reflow check, so it has to cope with a
collapsed menu. [config/fundraiser.pages.ts](config/fundraiser.pages.ts) is a worked example: six
views of the University of Andhra Fundraiser demo, one of them reached by filling in a form.

That demo is audited from the copy in [demo/fundraiser/index.html](demo/fundraiser/index.html),
not from its claude.ai link. There the app runs inside a frame of Claude's own page, the frame
cannot be opened by itself, and an automated browser gets a bot check. Replace the copy when the
artifact is republished.

## Safety

The suite is read-only by construction, so it is safe to point at a live site with `A11Y_URLS`:
every request other than GET/HEAD/OPTIONS to the audited site's own domain is aborted in the
browser ([src/core/pageReady.ts](src/core/pageReady.ts)). Tests run on one worker.

The Fundraiser demo's thank-you view is the one place a form is submitted with valid input. It
runs against the local copy, which has no server: the sample gift stays in the page's memory.

## Layout

```
.github/workflows/  the audit + narration workflow
config/      pages under test; standard, thresholds, owner and region rules
demo/        local copy of the Fundraiser demo app that the registry audits
src/core/    axe wrapper, findings model, ownership, evidence, page readiness, WCAG map
src/checks/  keyboard, structure, forms, dialog, responsive; custom rule catalogue
src/states/  interaction states per page type
src/fixtures the `audit` fixture every spec uses
src/reporting  Playwright reporter, report model, HTML template
src/narration  spoken phrasing, Windows voice, audio/video merge, the recorder
tests/       00 self-check · 01 baseline · 02 states · 03 keyboard · 04 structure · 05 responsive
narration/   narrated keyboard walk and its self-check
scripts/     report self-scan, and the helpers the workflow uses (voice choice, run summary)
```
