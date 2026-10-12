import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { a11yConfig } from '../../config/a11y.config';

export const SAMPLE_RATE = 22_050;
/** 16-bit mono. */
export const BYTES_PER_SAMPLE = 2;

export interface Clip {
  pcm: Buffer;
  durationMs: number;
}

/** Samples quieter than this are treated as silence when trimming. */
const SILENCE = 300;
const PADDING_MS = 40;

/**
 * One long-lived PowerShell process that holds the synthesizer open. Starting it costs about a
 * second; each phrase after that takes a few milliseconds. Requests are base64 so any character
 * survives the pipe.
 */
function workerScript(voice: string, rate: number): string {
  return `
$ProgressPreference = 'SilentlyContinue'
try {
  Add-Type -AssemblyName System.Speech
  $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $synth.SelectVoice('${voice.replace(/'/g, "''")}')
  $synth.Rate = ${rate}
  $format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(${SAMPLE_RATE}, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
  [Console]::Out.WriteLine('ready')
} catch {
  [Console]::Out.WriteLine('error ' + ($_.Exception.Message -replace '\\s+', ' '))
  exit 1
}
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  try {
    $job = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($line)) | ConvertFrom-Json
    $synth.SetOutputToWaveFile($job.file, $format)
    $synth.Speak($job.text)
    $synth.SetOutputToNull()
    [Console]::Out.WriteLine('ok')
  } catch {
    $synth.SetOutputToNull()
    [Console]::Out.WriteLine('error ' + ($_.Exception.Message -replace '\\s+', ' '))
  }
}`;
}

/** Reads the samples out of a WAV file and drops the silence the synthesizer pads each clip with. */
function readClip(file: string): Clip {
  const wav = readFileSync(file);
  let pcm: Buffer | null = null;
  for (let at = 12; at + 8 <= wav.length; ) {
    const size = wav.readUInt32LE(at + 4);
    if (wav.toString('ascii', at, at + 4) === 'data') pcm = wav.subarray(at + 8, at + 8 + size);
    at += 8 + size + (size % 2);
  }
  if (!pcm) throw new Error(`No audio data in ${file}`);

  const samples = Math.floor(pcm.length / BYTES_PER_SAMPLE);
  let first = -1;
  let last = -1;
  for (let i = 0; i < samples; i++) {
    if (Math.abs(pcm.readInt16LE(i * BYTES_PER_SAMPLE)) > SILENCE) {
      if (first < 0) first = i;
      last = i;
    }
  }
  const padding = Math.round((PADDING_MS / 1000) * SAMPLE_RATE);
  const from = first < 0 ? 0 : Math.max(0, first - padding);
  const to = first < 0 ? Math.min(samples, padding * 5) : Math.min(samples, last + padding);
  const trimmed = pcm.subarray(from * BYTES_PER_SAMPLE, to * BYTES_PER_SAMPLE);
  return { pcm: trimmed, durationMs: Math.round(((to - from) / SAMPLE_RATE) * 1000) };
}

/** Speaks text into audio clips with the Windows synthesizer. Clips are cached on disk by phrase. */
export class Speaker {
  private readonly lines: string[] = [];
  private readonly waiting: ((line: string) => void)[] = [];

  private constructor(
    private readonly worker: ChildProcessWithoutNullStreams,
    private readonly cacheDir: string,
  ) {
    createInterface({ input: worker.stdout }).on('line', (line) => {
      const next = this.waiting.shift();
      if (next) next(line);
      else this.lines.push(line);
    });
    worker.on('exit', () => {
      for (const next of this.waiting.splice(0)) next('error the speech process exited');
    });
  }

  static async start(cacheDir: string): Promise<Speaker> {
    if (process.platform !== 'win32') throw new Error('Narration uses the Windows speech synthesizer (System.Speech) and only runs on Windows.');
    const { voice, rate } = a11yConfig.narration;
    mkdirSync(cacheDir, { recursive: true });
    const command = Buffer.from(workerScript(voice, rate), 'utf16le').toString('base64');
    const speaker = new Speaker(spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', command]), cacheDir);
    const reply = await speaker.nextLine();
    if (reply !== 'ready') throw new Error(`Could not start the voice "${voice}" (set A11Y_VOICE to an installed voice): ${reply.replace(/^error /, '')}`);
    return speaker;
  }

  async say(phrase: string): Promise<Clip> {
    const { voice, rate } = a11yConfig.narration;
    const file = path.join(this.cacheDir, `${createHash('sha1').update(`${voice}|${rate}|${phrase}`).digest('hex')}.wav`);
    if (!existsSync(file)) {
      // Written under a temporary name so an interrupted run cannot leave half a clip in the cache.
      const partial = `${file}.part`;
      this.worker.stdin.write(`${Buffer.from(JSON.stringify({ file: partial, text: phrase }), 'utf8').toString('base64')}\n`);
      const reply = await this.nextLine();
      if (reply !== 'ok') throw new Error(`Speech synthesis failed for "${phrase}": ${reply.replace(/^error /, '')}`);
      renameSync(partial, file);
    }
    return readClip(file);
  }

  async close(): Promise<void> {
    if (this.worker.exitCode !== null) return;
    const exited = new Promise((resolve) => this.worker.once('exit', resolve));
    this.worker.stdin.end();
    await exited;
  }

  private nextLine(): Promise<string> {
    const line = this.lines.shift();
    if (line !== undefined) return Promise.resolve(line);
    if (this.worker.exitCode !== null) return Promise.resolve('error the speech process exited');
    return new Promise((resolve) => this.waiting.push(resolve));
  }
}
