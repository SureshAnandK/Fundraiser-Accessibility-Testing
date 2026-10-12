import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';
import { tabWalk } from '../src/checks/keyboard';
import { selectorText } from '../src/core/findings';
import { ffmpeg } from '../src/narration/mux';
import { narrate, type Narration } from '../src/narration/narrate';
import { SAMPLE_RATE } from '../src/narration/tts';

/**
 * Tests the narration. A narrated video is only evidence if the voice says the right thing while
 * the right element is boxed. These checks read the phrases, then open the finished file and
 * confirm the caption is on screen and speech is audible during each stop, and neither before it.
 */
const fixture = (name: string) => pathToFileURL(path.join(__dirname, '..', 'tests', 'fixtures', name)).href;

/** Is the caption bar across the bottom of the frame at this moment? The fixtures are white there. */
async function captionShown(video: string, atMs: number, frameHeight: number): Promise<boolean> {
  const strip = `crop=iw:20:0:${frameHeight - 30},scale=1:1`;
  const { stdout } = await ffmpeg(['-v', 'error', '-ss', (atMs / 1000).toFixed(3), '-i', video, '-frames:v', '1', '-vf', strip, '-f', 'rawvideo', '-pix_fmt', 'gray', '-']);
  return stdout[0] < 90;
}

/** Root-mean-square level of the sound track between two moments. */
function loudness(pcm: Buffer, fromMs: number, toMs: number): number {
  const from = Math.max(0, Math.round((fromMs / 1000) * SAMPLE_RATE));
  const to = Math.min(Math.floor(pcm.length / 2), Math.round((toMs / 1000) * SAMPLE_RATE));
  let sum = 0;
  for (let i = from; i < to; i++) sum += pcm.readInt16LE(i * 2) ** 2;
  return to > from ? Math.sqrt(sum / (to - from)) : 0;
}

async function expectPictureAndVoiceInStep(result: Narration, frameHeight: number): Promise<void> {
  const info = (await ffmpeg(['-hide_banner', '-i', result.video])).stderr;
  expect.soft(info, 'the file has a video stream').toMatch(/Video: h264/);
  // MP3, because VS Code's video preview cannot decode AAC and would play the file silent.
  expect.soft(info, 'the file has a sound track VS Code can play').toMatch(/Audio: mp3/);

  const pcm = (await ffmpeg(['-v', 'error', '-i', result.video, '-vn', '-f', 's16le', '-ac', '1', '-ar', String(SAMPLE_RATE), '-'])).stdout;
  for (const [i, row] of result.rows.entries()) {
    expect.soft(await captionShown(result.video, row.startMs + 250, frameHeight), `stop ${row.index}: caption is up while it is read`).toBe(true);
    expect.soft(loudness(pcm, row.startMs + 80, row.startMs + 400), `stop ${row.index}: speech is audible`).toBeGreaterThan(500);
    // The first stop follows the title card, which has its own picture and speech.
    if (i === 0) continue;
    expect.soft(await captionShown(result.video, row.startMs - 120, frameHeight), `stop ${row.index}: no caption before it is reached`).toBe(false);
    expect.soft(loudness(pcm, row.startMs - 250, row.startMs - 50), `stop ${row.index}: silence before it is reached`).toBeLessThan(150);
  }
}

test.describe('Narration self-check', () => {
  test('an accessible page: every stop is named, spoken, and in step with the picture', async ({ page }) => {
    await page.goto(fixture('known-good.html'));
    const plain = await tabWalk(page);

    await page.goto(fixture('known-good.html'));
    const result = await narrate(page, { id: 'selfcheck-known-good', title: 'Known-good fixture' });

    expect.soft(result.rows.map((r) => `${r.phrase} [${r.nameSource}]`)).toEqual([
      'Skip to content, link [contents]',
      'Shop, link [contents]',
      'Help, link [contents]',
      'Email address, edit [label]',
      'Subscribe, button [contents]',
      'Privacy policy, link [contents]',
    ]);
    expect.soft(result.completed, 'the walk goes all the way round the page').toBe(true);
    expect.soft(result.rows.map((r) => r.selector), 'narrating does not change the tab order').toEqual(plain.stops.map((s) => selectorText(s.target)));
    await expectPictureAndVoiceInStep(result, page.viewportSize()!.height);
  });

  test('planted defects: a stop with no name is announced as unlabelled', async ({ page }) => {
    await page.goto(fixture('known-bad.html'));
    const result = await narrate(page, { id: 'selfcheck-known-bad', title: 'Known-bad fixture' });

    expect.soft(result.rows.map((r) => `${r.phrase} [${r.nameSource}]`)).toEqual([
      'Skip to content, link [contents]',
      'unlabelled edit [none]',
      'unlabelled button [none]',
      'Link without a focus ring, link [contents]',
      'Details, tab [contents]',
      'Email, edit [label]',
      'Trap, edit [label]',
    ]);
    expect.soft(result.rows.filter((r) => r.silent).map((r) => r.index), 'stops with nothing to announce').toEqual([2, 3]);
    await expectPictureAndVoiceInStep(result, page.viewportSize()!.height);
  });
});
