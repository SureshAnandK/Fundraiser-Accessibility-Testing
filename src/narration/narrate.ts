import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { CDPSession, Page } from '@playwright/test';
import { a11yConfig } from '../../config/a11y.config';
import { tabWalk, type TabStop } from '../checks/keyboard';
import { REPORT_DIR } from '../core/evidence';
import { csvCell, selectorText } from '../core/findings';
import { esc } from '../reporting/htmlTemplate';
import { mux, narrationTrack } from './mux';
import { announce, type Announcement, type AxNode } from './speech';
import { Speaker } from './tts';

export const NARRATION_DIR = path.join(REPORT_DIR, 'narration');

export interface NarrationRow {
  /** Tab stop number, the same numbering the keyboard audit uses. */
  index: number;
  role: string;
  name: string;
  nameSource: string;
  states: string[];
  phrase: string;
  /** Where the announcement sits in the video. */
  startMs: number;
  endMs: number;
  selector: string;
  silent: boolean;
}

export interface Narration {
  video: string;
  transcript: string;
  rows: NarrationRow[];
  /** The walk came back round to the first stop rather than ending on a limit or a trap. */
  completed: boolean;
}

/** Video kept after the last announcement. */
const TAIL_MS = 800;

const DEEP_ACTIVE_ELEMENT = '(() => { let el = document.activeElement; while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement; return el; })()';

/** What Chromium exposes to assistive technology for the element that has focus. */
async function focusedNode(cdp: CDPSession, stop: TabStop): Promise<AxNode> {
  try {
    const { result } = await cdp.send('Runtime.evaluate', { expression: DEEP_ACTIVE_ELEMENT });
    if (result.objectId) {
      const { nodes } = await cdp.send('Accessibility.getPartialAXTree', { objectId: result.objectId, fetchRelatives: false });
      await cdp.send('Runtime.releaseObject', { objectId: result.objectId });
      if (nodes[0] && !nodes[0].ignored) return nodes[0];
      // Ignored means assistive technology is not told about the element, so it has no name to read.
      if (nodes[0]) return { ignored: true, role: { value: stop.role }, name: { value: '' } };
    }
  } catch {
    // Fall through to what the tab walk read from the DOM.
  }
  return { ignored: false, role: { value: stop.role }, name: { value: stop.name } };
}

/** A box round the stop and a caption with what is being spoken. */
function overlayHtml(stop: TabStop, said: Announcement, viewport: { width: number; height: number }): string {
  const onScreen = stop.visible && stop.inViewport;
  const colour = said.silent ? '#e00000' : '#d6006c';
  // Drawn 3px clear of the element so the page's own focus indicator stays visible.
  const box = onScreen
    ? `<div style="position:absolute;left:${stop.x - 6}px;top:${stop.y - 6}px;width:${stop.width + 6}px;height:${stop.height + 6}px;border:3px ${said.silent ? 'dashed' : 'solid'} ${colour};border-radius:4px;box-shadow:0 0 0 1px #fff;"></div>`
    : '';
  const detail = [said.silent ? 'No accessible name: only the role can be announced' : `Name from ${said.nameSource}`, onScreen ? '' : 'not visible on screen'].filter(Boolean).join(' · ');
  // The caption moves to the top when it would cover the stop.
  const edge = onScreen && stop.y + stop.height > viewport.height - 100 ? 'top' : 'bottom';
  return `${box}<div style="position:absolute;left:0;right:0;${edge}:0;padding:12px 20px;background:rgba(17,17,17,.94);border-${edge === 'top' ? 'bottom' : 'top'}:4px solid ${colour};color:#fff;font:600 20px/1.3 'Segoe UI',Arial,sans-serif;">${stop.index} · ${esc(said.phrase)}<div style="font:400 14px/1.3 'Segoe UI',Arial,sans-serif;color:#d0d0d0;margin-top:2px;">${esc(detail)}</div></div>`;
}

function cueTime(ms: number): string {
  const part = (value: number, width = 2) => String(Math.floor(value)).padStart(width, '0');
  return `${part(ms / 3_600_000)}:${part((ms / 60_000) % 60)}:${part((ms / 1000) % 60)}.${part(ms % 1000, 3)}`;
}

/**
 * Records the page being walked with Tab. At each stop the element is boxed, and a voice reads
 * what a screen reader would announce for it: the name, role and state Chromium exposes in its
 * accessibility tree. Writes an MP4, captions and a transcript to `reports/narration/<id>/`.
 */
export async function narrate(page: Page, subject: { id: string; title: string }): Promise<Narration> {
  const dir = path.join(NARRATION_DIR, subject.id);
  mkdirSync(dir, { recursive: true });
  const file = (name: string) => path.join(dir, name);
  const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
  const { gapMs, maxStops, voice } = a11yConfig.narration;

  const speaker = await Speaker.start(path.join(NARRATION_DIR, '.cache'));
  const cdp = await page.context().newCDPSession(page);
  const rows: NarrationRow[] = [];
  const clips: { startMs: number; pcm: Buffer }[] = [];
  let completed = false;
  let endMs = 0;

  try {
    // The finished video starts at the first frame the recorder is given, so that frame is time zero.
    let zero = 0;
    await page.screencast.start({ path: file('walk.webm'), size: viewport, onFrame: (frame) => void (zero ||= frame.timestamp) });
    for (let i = 0; i < 40 && !zero; i++) await page.waitForTimeout(50);
    zero ||= Date.now();
    const now = () => Math.round(Date.now() - zero);

    // A screen reader announces the page title before anything else.
    const title = await speaker.say((await page.title()) || subject.title);
    const titleAt = now() + 300;
    clips.push({ startMs: titleAt, pcm: title.pcm });
    endMs = titleAt + title.durationMs;
    await page.screencast.showChapter(subject.title, {
      description: 'Keyboard walk with simulated screen-reader announcements',
      duration: Math.max(2500, title.durationMs + 800),
    });

    const walk = await tabWalk(page, {
      maxStops,
      onStop: async (stop) => {
        const said = announce(await focusedNode(cdp, stop));
        const clip = await speaker.say(said.phrase);
        const overlay = await page.screencast.showOverlay(overlayHtml(stop, said, viewport));
        const startMs = now();
        endMs = startMs + clip.durationMs;
        clips.push({ startMs, pcm: clip.pcm });
        rows.push({ index: stop.index, role: said.role, name: said.name, nameSource: said.nameSource, states: said.states, phrase: said.phrase, startMs, endMs, selector: selectorText(stop.target), silent: said.silent });
        await page.waitForTimeout(clip.durationMs + gapMs);
        await overlay.dispose();
      },
    });
    completed = walk.completed;
  } finally {
    await page.screencast.stop().catch(() => {});
    await cdp.detach().catch(() => {});
    await speaker.close();
  }

  // Trimming to the last announcement also drops the end of the walk, where each stop is
  // photographed again without focus.
  const totalMs = endMs + TAIL_MS;
  writeFileSync(file('narration.wav'), narrationTrack(clips, totalMs));
  await mux(file('walk.webm'), file('narration.wav'), file('screen-reader.mp4'), totalMs);
  rmSync(file('walk.webm'));
  rmSync(file('narration.wav'));

  const silent = rows.filter((row) => row.silent);
  writeFileSync(
    file('transcript.json'),
    JSON.stringify({ page: subject.title, url: page.url(), recorded: new Date().toISOString(), voice, viewport, completed, stops: rows.length, silentStops: silent.length, rows }, null, 2),
    'utf8',
  );
  const header = ['stop', 'start', 'end', 'role', 'name', 'name_source', 'states', 'spoken', 'silent', 'selector'];
  const lines = rows.map((r) => [r.index, cueTime(r.startMs), cueTime(r.endMs), r.role, r.name, r.nameSource, r.states.join(' | '), r.phrase, r.silent ? 'yes' : 'no', r.selector].map(csvCell).join(','));
  writeFileSync(file('transcript.csv'), `﻿${[header.join(','), ...lines].join('\n')}`, 'utf8');
  const cueText = (phrase: string) => phrase.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  writeFileSync(file('screen-reader.vtt'), `WEBVTT\n\n${rows.map((r) => `${r.index}\n${cueTime(r.startMs)} --> ${cueTime(r.endMs)}\n${cueText(r.phrase)}`).join('\n\n')}\n`, 'utf8');

  return { video: file('screen-reader.mp4'), transcript: file('transcript.json'), rows, completed };
}
