import path from 'node:path';
import { test } from '@playwright/test';
import { pages } from '../config/pages';
import { openPage } from '../src/core/pageReady';
import { narrate } from '../src/narration/narrate';

/**
 * Records each page being walked with Tab while a voice reads what a screen reader would
 * announce at every stop. Produces a video and a transcript; it does not gate. Stops with no
 * accessible name are already reported by the keyboard audit as `kbd-stop-unnamed`.
 */
for (const put of pages) {
  test(`${put.name} — narrated keyboard walk`, async ({ page }) => {
    await openPage(page, put);
    const result = await narrate(page, { id: put.id, title: put.name });

    const silent = result.rows.filter((row) => row.silent);
    const relative = (file: string) => path.relative(process.cwd(), file);
    console.log(
      [
        '',
        `  ${result.rows.length} tab stop(s) narrated${result.completed ? '' : ' (walk stopped before returning to the first stop)'}`,
        `  ${silent.length} with nothing to announce${silent.length ? `: stop ${silent.map((row) => row.index).join(', ')}` : ''}`,
        `  video       ${relative(result.video)}`,
        `  transcript  ${relative(result.transcript)}`,
      ].join('\n'),
    );
  });
}
