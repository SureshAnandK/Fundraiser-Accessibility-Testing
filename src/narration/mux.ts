import { execFile } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';
import { BYTES_PER_SAMPLE, SAMPLE_RATE } from './tts';

/** Playwright's bundled ffmpeg encodes VP8 video only, so audio needs a full build. */
function ffmpegBinary(): string {
  const binary = process.env.A11Y_FFMPEG || ffmpegStatic;
  if (!binary) throw new Error('No ffmpeg binary found. Run `npm install`, or set A11Y_FFMPEG to the path of an ffmpeg executable.');
  return binary;
}

/** Runs ffmpeg. Probing a file exits non-zero by design, so the caller decides what an error is. */
export function ffmpeg(args: string[]): Promise<{ code: number; stdout: Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(ffmpegBinary(), args, { encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error && typeof error.code !== 'number') reject(error);
      else resolve({ code: error ? Number(error.code) : 0, stdout, stderr: stderr.toString() });
    });
  });
}

/**
 * Lays every clip at its start time on one silent track and returns it as a WAV file. Done here
 * rather than with one ffmpeg input per clip: a long page has more clips than a Windows command
 * line can carry.
 */
export function narrationTrack(clips: { startMs: number; pcm: Buffer }[], totalMs: number): Buffer {
  const data = Buffer.alloc(Math.ceil((totalMs / 1000) * SAMPLE_RATE) * BYTES_PER_SAMPLE);
  for (const clip of clips) {
    const at = Math.max(0, Math.round((clip.startMs / 1000) * SAMPLE_RATE)) * BYTES_PER_SAMPLE;
    if (at < data.length) clip.pcm.copy(data, at, 0, Math.min(clip.pcm.length, data.length - at));
  }

  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * BYTES_PER_SAMPLE, 28);
  header.writeUInt16LE(BYTES_PER_SAMPLE, 32);
  header.writeUInt16LE(BYTES_PER_SAMPLE * 8, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/**
 * Joins the silent recording and the narration track into an MP4. The sound is MP3, not the
 * usual AAC: VS Code's built-in video preview has no AAC decoder and plays such a file silent.
 */
export async function mux(video: string, audio: string, out: string, durationMs: number): Promise<void> {
  const result = await ffmpeg([
    '-y', '-v', 'error',
    '-i', video,
    '-i', audio,
    '-map', '0:v:0', '-map', '1:a:0',
    '-t', (durationMs / 1000).toFixed(3),
    // H.264 needs even dimensions.
    '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
    '-c:a', 'libmp3lame', '-b:a', '128k', '-ar', '44100',
    '-movflags', '+faststart',
    out,
  ]);
  if (result.code !== 0) throw new Error(`ffmpeg could not write ${out}: ${result.stderr.trim()}`);
}
