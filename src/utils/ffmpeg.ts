import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

export class MediaProcessError extends Error {}

export type AudioEffect = 'rapide' | 'lent' | 'robot' | 'grave' | 'aigu' | 'bass' | 'nightcore' | 'nettoyer'

const AUDIO_FILTERS: Record<AudioEffect, string> = {
  rapide: 'atempo=1.25',
  lent: 'atempo=0.80',
  robot: 'asetrate=44100*1.15,aresample=44100,atempo=0.95',
  grave: 'asetrate=44100*0.82,aresample=44100',
  aigu: 'asetrate=44100*1.20,aresample=44100',
  bass: 'equalizer=f=80:width_type=o:width=2:g=8',
  nightcore: 'asetrate=44100*1.25,aresample=44100,atempo=1.05',
  nettoyer: 'afftdn=nf=-25',
}

function extensionFromMime(mimetype: string, fallback: string): string {
  const lower = mimetype.toLowerCase()
  if (lower.includes('ogg')) return 'ogg'
  if (lower.includes('mpeg') || lower.includes('mp3')) return 'mp3'
  if (lower.includes('wav')) return 'wav'
  if (lower.includes('m4a') || lower.includes('mp4a')) return 'm4a'
  if (lower.includes('webm')) return 'webm'
  if (lower.includes('mp4')) return 'mp4'
  if (lower.includes('3gpp')) return '3gp'
  return fallback
}

function runFfmpeg(args: string[], timeoutMs = 150_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const process = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    })
    let errorOutput = ''
    const timeout = setTimeout(() => {
      process.kill('SIGKILL')
      reject(new MediaProcessError('Le traitement média a dépassé le délai autorisé.'))
    }, timeoutMs)
    timeout.unref()
    process.stderr.on('data', (chunk: Buffer) => {
      if (errorOutput.length < 4_000) errorOutput += chunk.toString('utf8')
    })
    process.once('error', (error) => {
      clearTimeout(timeout)
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(new MediaProcessError('FFmpeg est absent du VPS. Lance le panneau « bestla », puis l’option diagnostic, ou réinstalle le service.'))
      } else {
        reject(new MediaProcessError('Impossible de lancer le traitement média.'))
      }
    })
    process.once('close', (code) => {
      clearTimeout(timeout)
      if (code === 0) resolve()
      else reject(new MediaProcessError(errorOutput.trim().slice(0, 300) || 'FFmpeg n’a pas pu traiter ce média.'))
    })
  })
}

function runFfprobe(args: string[], timeoutMs = 30_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const process = spawn('ffprobe', ['-v', 'error', ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    const timeout = setTimeout(() => {
      process.kill('SIGKILL')
      reject(new MediaProcessError('L’analyse du média a dépassé le délai autorisé.'))
    }, timeoutMs)
    timeout.unref()
    process.stdout.on('data', (chunk: Buffer) => { if (stdout.length < 20_000) stdout += chunk.toString('utf8') })
    process.stderr.on('data', (chunk: Buffer) => { if (stderr.length < 4_000) stderr += chunk.toString('utf8') })
    process.once('error', (error) => {
      clearTimeout(timeout)
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') reject(new MediaProcessError('FFprobe est absent du VPS. Réinstalle FFmpeg depuis le panel Bestla.'))
      else reject(new MediaProcessError('Impossible d’analyser ce média.'))
    })
    process.once('close', (code) => {
      clearTimeout(timeout)
      if (code === 0) resolve(stdout.trim())
      else reject(new MediaProcessError(stderr.trim().slice(0, 300) || 'FFprobe n’a pas pu analyser ce média.'))
    })
  })
}

async function withWorkspace<T>(input: Buffer, extension: string, task: (inputPath: string, directory: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(path.join(tmpdir(), 'bestla-media-'))
  try {
    const inputPath = path.join(directory, `entree.${extension.replace(/[^a-z0-9]/gi, '') || 'bin'}`)
    await writeFile(inputPath, input, { mode: 0o600 })
    return await task(inputPath, directory)
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined)
  }
}

function validateTime(value: number, label: string): string {
  if (!Number.isFinite(value) || value < 0 || value > 7_200) throw new MediaProcessError(`${label} doit être compris entre 0 et 7200 secondes.`)
  return String(Math.round(value * 100) / 100)
}

function validateSpeed(value: number): number {
  if (!Number.isFinite(value) || value < 0.5 || value > 3) {
    throw new MediaProcessError('La vitesse doit être comprise entre 0.5x et 3x.')
  }
  return Math.round(value * 100) / 100
}

export function atempoFilter(value: number): string {
  let speed = validateSpeed(value)
  const parts: number[] = []
  while (speed > 2) {
    parts.push(2)
    speed /= 2
  }
  while (speed < 0.5) {
    parts.push(0.5)
    speed /= 0.5
  }
  parts.push(speed)
  return parts.map((part) => `atempo=${part.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}`).join(',')
}

async function inputHasAudio(inputPath: string): Promise<boolean> {
  const result = await runFfprobe(['-select_streams', 'a:0', '-show_entries', 'stream=index', '-of', 'csv=p=0', inputPath])
  return Boolean(result.trim())
}

export async function convertAudioToMp3(input: Buffer, mimetype: string): Promise<Buffer> {
  return withWorkspace(input, extensionFromMime(mimetype, 'ogg'), async (inputPath, directory) => {
    const output = path.join(directory, 'sortie.mp3')
    await runFfmpeg(['-i', inputPath, '-vn', '-c:a', 'libmp3lame', '-b:a', '128k', output])
    return readFile(output)
  })
}

export async function applyAudioEffect(input: Buffer, mimetype: string, effect: AudioEffect): Promise<Buffer> {
  const filter = AUDIO_FILTERS[effect]
  return withWorkspace(input, extensionFromMime(mimetype, 'ogg'), async (inputPath, directory) => {
    const output = path.join(directory, 'sortie.mp3')
    await runFfmpeg(['-i', inputPath, '-vn', '-af', filter, '-c:a', 'libmp3lame', '-b:a', '128k', output])
    return readFile(output)
  })
}

export async function changeAudioSpeed(input: Buffer, mimetype: string, speedInput: number): Promise<Buffer> {
  const speed = validateSpeed(speedInput)
  return withWorkspace(input, extensionFromMime(mimetype, 'ogg'), async (inputPath, directory) => {
    const output = path.join(directory, 'vitesse.mp3')
    await runFfmpeg(['-i', inputPath, '-vn', '-af', atempoFilter(speed), '-c:a', 'libmp3lame', '-b:a', '128k', output])
    return readFile(output)
  })
}

export async function trimAudio(input: Buffer, mimetype: string, start: number, duration: number): Promise<Buffer> {
  return withWorkspace(input, extensionFromMime(mimetype, 'ogg'), async (inputPath, directory) => {
    const output = path.join(directory, 'sortie.mp3')
    await runFfmpeg([
      '-ss',
      validateTime(start, 'Le début'),
      '-i',
      inputPath,
      '-t',
      validateTime(duration, 'La durée'),
      '-vn',
      '-c:a',
      'libmp3lame',
      '-b:a',
      '128k',
      output,
    ])
    return readFile(output)
  })
}

export async function extractAudioFromVideo(input: Buffer, mimetype: string): Promise<Buffer> {
  return withWorkspace(input, extensionFromMime(mimetype, 'mp4'), async (inputPath, directory) => {
    const output = path.join(directory, 'audio.mp3')
    await runFfmpeg(['-i', inputPath, '-vn', '-c:a', 'libmp3lame', '-b:a', '128k', output])
    return readFile(output)
  })
}

export async function compressVideo(input: Buffer, mimetype: string): Promise<Buffer> {
  return withWorkspace(input, extensionFromMime(mimetype, 'mp4'), async (inputPath, directory) => {
    const output = path.join(directory, 'video.mp4')
    await runFfmpeg([
      '-i',
      inputPath,
      '-vf',
      'scale=1280:-2:force_original_aspect_ratio=decrease',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '28',
      '-c:a',
      'aac',
      '-b:a',
      '96k',
      '-movflags',
      '+faststart',
      output,
    ])
    return readFile(output)
  })
}

export async function changeVideoSpeed(input: Buffer, mimetype: string, speedInput: number): Promise<Buffer> {
  const speed = validateSpeed(speedInput)
  return withWorkspace(input, extensionFromMime(mimetype, 'mp4'), async (inputPath, directory) => {
    const output = path.join(directory, 'vitesse.mp4')
    const hasAudio = await inputHasAudio(inputPath)
    const args = [
      '-i', inputPath,
      '-vf', `setpts=PTS/${speed}`,
      ...(hasAudio ? ['-af', atempoFilter(speed)] : ['-an']),
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '23',
      ...(hasAudio ? ['-c:a', 'aac', '-b:a', '128k'] : []),
      '-movflags', '+faststart',
      output,
    ]
    await runFfmpeg(args, 240_000)
    return readFile(output)
  })
}

export async function muteVideo(input: Buffer, mimetype: string): Promise<Buffer> {
  return withWorkspace(input, extensionFromMime(mimetype, 'mp4'), async (inputPath, directory) => {
    const output = path.join(directory, 'muet.mp4')
    // Copie vidéo sans réencodage lorsque le conteneur est déjà compatible.
    try {
      await runFfmpeg(['-i', inputPath, '-map', '0:v:0', '-an', '-c:v', 'copy', '-movflags', '+faststart', output])
    } catch {
      await runFfmpeg(['-i', inputPath, '-map', '0:v:0', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-movflags', '+faststart', output])
    }
    return readFile(output)
  })
}

export async function captureVideoFrame(input: Buffer, mimetype: string, secondInput: number): Promise<Buffer> {
  const second = validateTime(secondInput, 'Le temps de capture')
  return withWorkspace(input, extensionFromMime(mimetype, 'mp4'), async (inputPath, directory) => {
    const output = path.join(directory, 'capture.jpg')
    await runFfmpeg(['-ss', second, '-i', inputPath, '-frames:v', '1', '-q:v', '2', output], 90_000)
    return readFile(output)
  })
}

export async function rotateVideo(input: Buffer, mimetype: string, angle: 90 | 180 | 270): Promise<Buffer> {
  const transpose = angle === 90 ? 'transpose=1' : angle === 180 ? 'transpose=1,transpose=1' : 'transpose=2'
  return withWorkspace(input, extensionFromMime(mimetype, 'mp4'), async (inputPath, directory) => {
    const output = path.join(directory, 'video.mp4')
    await runFfmpeg(['-i', inputPath, '-vf', transpose, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac', '-movflags', '+faststart', output])
    return readFile(output)
  })
}

export async function trimVideo(input: Buffer, mimetype: string, start: number, duration: number): Promise<Buffer> {
  return withWorkspace(input, extensionFromMime(mimetype, 'mp4'), async (inputPath, directory) => {
    const output = path.join(directory, 'video.mp4')
    await runFfmpeg([
      '-ss',
      validateTime(start, 'Le début'),
      '-i',
      inputPath,
      '-t',
      validateTime(duration, 'La durée'),
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '23',
      '-c:a',
      'aac',
      '-movflags',
      '+faststart',
      output,
    ])
    return readFile(output)
  })
}

export async function videoToSticker(input: Buffer, mimetype: string): Promise<Buffer> {
  return withWorkspace(input, extensionFromMime(mimetype, 'mp4'), async (inputPath, directory) => {
    const output = path.join(directory, 'autocollant.webp')
    await runFfmpeg([
      '-t',
      '8',
      '-i',
      inputPath,
      '-vf',
      'fps=15,scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:-1:-1:color=0x00000000',
      '-loop',
      '0',
      '-an',
      '-c:v',
      'libwebp',
      '-q:v',
      '55',
      output,
    ])
    return readFile(output)
  })
}
