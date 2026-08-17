import { createHash, randomUUID } from 'node:crypto'
import { execFile as execFileCallback } from 'node:child_process'
import { access, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { safeFetchBuffer } from '../utils/safe-fetch.js'

const execFile = promisify(execFileCallback)
const PACKAGE_ID = /^[a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z0-9_]+)+$/
const APK_MIMETYPE = 'application/vnd.android.package-archive'

export type ApkSource = 'direct' | 'apk-pure' | 'f-droid'

export interface ApkRequest {
  input: string
  packageId?: string
  source: ApkSource
  sourceLabel: string
  directUrl?: string
}

export interface DownloadedApk {
  buffer: Buffer
  fileName: string
  packageId?: string
  sourceLabel: string
  sha256: string
}

function projectRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
}

function packageIdFromPathname(pathname: string): string | undefined {
  const candidates = pathname.split('/').map((part) => decodeURIComponent(part).trim()).filter(Boolean).reverse()
  return candidates.find((candidate) => PACKAGE_ID.test(candidate))
}

export function isPotentialApkLink(rawInput: string): boolean {
  try {
    const url = new URL(rawInput.trim())
    if (!['http:', 'https:'].includes(url.protocol)) return false
    const host = url.hostname.toLowerCase().replace(/^www\./, '')
    return (
      host === 'play.google.com' || host.endsWith('.play.google.com') ||
      host === 'f-droid.org' || host.endsWith('.f-droid.org') ||
      host === 'apkpure.com' || host.endsWith('.apkpure.com') ||
      /\.apk$/i.test(url.pathname)
    )
  } catch {
    return false
  }
}

export function parseApkRequest(rawInput: string): ApkRequest {
  const input = rawInput.trim()
  if (!input) throw new Error('Ajoute un lien Play Store, APKPure, F-Droid, un lien direct .apk ou un identifiant de paquet Android.')

  if (PACKAGE_ID.test(input)) {
    return { input, packageId: input, source: 'apk-pure', sourceLabel: 'APKPure public' }
  }

  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new Error('Lien APK invalide.')
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Seuls les liens HTTP(S) sont acceptés.')

  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  const pathname = url.pathname

  if (host === 'play.google.com' || host.endsWith('.play.google.com')) {
    const packageId = url.searchParams.get('id')?.trim()
    if (!packageId || !PACKAGE_ID.test(packageId)) throw new Error('Impossible de trouver l’identifiant de l’application dans ce lien Play Store.')
    return {
      input,
      packageId,
      source: 'apk-pure',
      sourceLabel: 'Lien Play Store - APK récupéré via la source publique APKPure',
    }
  }

  if (host === 'f-droid.org' || host.endsWith('.f-droid.org')) {
    const packageId = packageIdFromPathname(pathname)
    if (!packageId) throw new Error('Impossible de trouver l’identifiant de paquet dans ce lien F-Droid.')
    return { input, packageId, source: 'f-droid', sourceLabel: 'F-Droid' }
  }

  if (host === 'apkpure.com' || host.endsWith('.apkpure.com')) {
    const packageId = packageIdFromPathname(pathname)
    if (!packageId) throw new Error('Impossible de trouver l’identifiant de paquet dans ce lien APKPure.')
    return { input, packageId, source: 'apk-pure', sourceLabel: 'APKPure public' }
  }

  if (/\.apk$/i.test(pathname)) {
    return { input, source: 'direct', sourceLabel: host, directUrl: url.toString() }
  }

  throw new Error('Ce site ne fournit pas un lien APK direct reconnu. Utilise un lien Play Store, APKPure, F-Droid ou une URL qui se termine par .apk.')
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

async function ensureApkeep(): Promise<string> {
  const root = projectRoot()
  const binary = process.env.BESTLA_APKEEP_BIN?.trim() || path.join(root, '.bin', 'apkeep')
  if (await fileExists(binary)) return binary

  const script = path.join(root, 'scripts', 'ensure-apk.sh')
  try {
    await execFile('bash', [script], { cwd: root, timeout: 180_000, maxBuffer: 2 * 1024 * 1024 })
  } catch {
    throw new Error('Le moteur APK n’a pas pu être installé automatiquement. Relance la mise à jour Bestla puis réessaie.')
  }
  if (!(await fileExists(binary))) throw new Error('Le moteur APK reste indisponible après la réparation automatique.')
  return binary
}

async function findApkFiles(directory: string): Promise<string[]> {
  const result: string[] = []
  const entries = await readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) result.push(...await findApkFiles(fullPath))
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.apk')) result.push(fullPath)
  }
  return result
}

function safeFileName(value: string, fallback = 'application.apk'): string {
  const normalized = value.replace(/[\\/:*?"<>|\r\n]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120)
  return normalized.toLowerCase().endsWith('.apk') ? normalized : `${normalized || fallback.replace(/\.apk$/i, '')}.apk`
}

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}

async function downloadDirect(request: ApkRequest, maxBytes: number): Promise<DownloadedApk> {
  const directUrl = request.directUrl
  if (!directUrl) throw new Error('Lien APK direct manquant.')
  const downloaded = await safeFetchBuffer(directUrl, maxBytes)
  const finalPath = new URL(downloaded.finalUrl).pathname
  const contentType = downloaded.contentType.toLowerCase()
  if (!finalPath.toLowerCase().endsWith('.apk') && contentType !== APK_MIMETYPE && contentType !== 'application/octet-stream') {
    throw new Error('Le lien reçu ne renvoie pas un fichier APK.')
  }
  const baseName = decodeURIComponent(path.basename(finalPath)) || 'application.apk'
  return {
    buffer: downloaded.buffer,
    fileName: safeFileName(baseName),
    sourceLabel: request.sourceLabel,
    sha256: sha256(downloaded.buffer),
  }
}

async function downloadWithApkeep(request: ApkRequest, maxBytes: number): Promise<DownloadedApk> {
  if (!request.packageId) throw new Error('Identifiant Android manquant.')
  const binary = await ensureApkeep()
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), `bestla-apk-${randomUUID().slice(0, 8)}-`))
  try {
    const args = ['-a', request.packageId, '-d', request.source, temporaryDirectory]
    try {
      await execFile(binary, args, { timeout: 180_000, maxBuffer: 4 * 1024 * 1024 })
    } catch (error) {
      const stderr = typeof error === 'object' && error && 'stderr' in error ? String((error as { stderr?: unknown }).stderr ?? '') : ''
      if (/not found|404|unable|failed|error/i.test(stderr)) {
        throw new Error('Application introuvable ou téléchargement refusé par la source APK.')
      }
      throw new Error('Le téléchargement APK a échoué. La source peut avoir changé ou être temporairement indisponible.')
    }

    const files = await findApkFiles(temporaryDirectory)
    if (!files.length) throw new Error('La source n’a renvoyé aucun fichier APK compatible.')
    const candidates = await Promise.all(files.map(async (filePath) => ({ filePath, size: (await stat(filePath)).size })))
    const selected = candidates.sort((a, b) => b.size - a.size)[0]
    if (!selected) throw new Error('Aucun APK exploitable trouvé.')
    if (selected.size > maxBytes) {
      throw new Error(`L’APK fait ${(selected.size / 1024 / 1024).toFixed(1)} Mo, au-dessus de la limite Bestla configurée.`)
    }
    const buffer = await readFile(selected.filePath)
    return {
      buffer,
      fileName: safeFileName(path.basename(selected.filePath), `${request.packageId}.apk`),
      packageId: request.packageId,
      sourceLabel: request.sourceLabel,
      sha256: sha256(buffer),
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined)
  }
}

export async function downloadApk(rawInput: string, maxBytes: number): Promise<DownloadedApk> {
  const request = parseApkRequest(rawInput)
  return request.source === 'direct'
    ? downloadDirect(request, maxBytes)
    : downloadWithApkeep(request, maxBytes)
}
