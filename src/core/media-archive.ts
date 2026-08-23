import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { MediaType, WAMessage, WASocket } from '@whiskeysockets/baileys'
import type { AppConfig } from '../config.js'
import { downloadMedia, findMedia } from '../utils/message.js'
import { logger } from './logger.js'

export interface ArchivedMedia {
  messageId: string
  chatId: string | null
  type: MediaType
  mimetype: string
  fileName: string
  size: number
  archivedAt: string
  filePath: string
}

interface ArchivedMediaMetadata extends Omit<ArchivedMedia, 'filePath'> {
  storageFile: string
}

function archiveDirectory(config: AppConfig, sessionName: string): string {
  return path.join(config.dataDir, 'media-archive', sessionName)
}

function archiveKey(messageId: string): string {
  return createHash('sha256').update(messageId).digest('hex')
}

function extensionFor(mimetype: string, type: MediaType): string {
  const known: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'video/mp4': 'mp4',
    'audio/mpeg': 'mp3',
    'audio/ogg': 'ogg',
    'audio/ogg; codecs=opus': 'ogg',
    'application/pdf': 'pdf',
    'application/vnd.android.package-archive': 'apk',
  }
  const normalized = mimetype.toLowerCase().trim()
  const fromMime = normalized.split('/')[1]?.split(';')[0]?.replace(/[^a-z0-9]/g, '')
  return known[normalized] ?? fromMime ?? (type === 'sticker' ? 'webp' : 'bin')
}

function safeFileName(value: string | null | undefined, fallback: string): string {
  const base = (value ?? '').trim().replace(/[\\/:*?"<>|\r\n]/g, '_').slice(0, 120)
  return base || fallback
}

function documentFileName(message: WAMessage, mimetype: string, type: MediaType): string {
  const media = findMedia(message)
  const node = media?.node as ({ fileName?: string | null } | undefined)
  const ext = extensionFor(mimetype, type)
  const fallback = `bestla_${message.key.id ?? Date.now()}.${ext}`
  return safeFileName(node?.fileName, fallback)
}

function maxArchiveBytes(config: AppConfig): number {
  return Math.max(config.maxMediaBytes, config.maxApkBytes)
}

export async function archiveMediaMessage(
  config: AppConfig,
  sessionName: string,
  message: WAMessage,
  sock: WASocket,
): Promise<ArchivedMedia | undefined> {
  if (!config.mediaArchive.enabled) return undefined
  const messageId = message.key.id
  const media = findMedia(message)
  if (!messageId || !media) return undefined

  const directory = archiveDirectory(config, sessionName)
  const key = archiveKey(messageId)
  const metadataPath = path.join(directory, `${key}.json`)
  try {
    const existing = await readFile(metadataPath, 'utf8')
    const parsed = JSON.parse(existing) as ArchivedMediaMetadata
    const filePath = path.join(directory, parsed.storageFile)
    await stat(filePath)
    return { ...parsed, filePath }
  } catch {
    // Le média n'est pas encore archivé, ou son index est incomplet.
  }

  const downloaded = await downloadMedia(message, maxArchiveBytes(config), sock)
  const ext = extensionFor(downloaded.mimetype, downloaded.type)
  const storageFile = `${key}.${ext}`
  const filePath = path.join(directory, storageFile)
  const fileName = documentFileName(message, downloaded.mimetype, downloaded.type)
  const metadata: ArchivedMediaMetadata = {
    messageId,
    chatId: message.key.remoteJid ?? null,
    type: downloaded.type,
    mimetype: downloaded.mimetype,
    fileName,
    size: downloaded.buffer.length,
    archivedAt: new Date().toISOString(),
    storageFile,
  }

  await mkdir(directory, { recursive: true, mode: 0o700 })
  await writeFile(filePath, downloaded.buffer, { mode: 0o600 })
  await writeFile(metadataPath, `${JSON.stringify(metadata)}\n`, { mode: 0o600 })
  return { ...metadata, filePath }
}

export async function getArchivedMedia(
  config: AppConfig,
  sessionName: string,
  messageId: string | null | undefined,
): Promise<ArchivedMedia | undefined> {
  if (!messageId) return undefined
  const directory = archiveDirectory(config, sessionName)
  const key = archiveKey(messageId)
  try {
    const raw = await readFile(path.join(directory, `${key}.json`), 'utf8')
    const metadata = JSON.parse(raw) as ArchivedMediaMetadata
    const filePath = path.join(directory, metadata.storageFile)
    const fileStat = await stat(filePath)
    if (!fileStat.isFile()) return undefined
    return { ...metadata, size: fileStat.size, filePath }
  } catch {
    return undefined
  }
}

export async function readArchivedMedia(archived: ArchivedMedia): Promise<Buffer> {
  return readFile(archived.filePath)
}

export async function mediaArchiveStats(config: AppConfig, sessionName: string): Promise<{ files: number; bytes: number }> {
  const directory = archiveDirectory(config, sessionName)
  let entries: string[]
  try {
    entries = await readdir(directory)
  } catch {
    return { files: 0, bytes: 0 }
  }

  let files = 0
  let bytes = 0
  for (const entry of entries.filter((name) => name.endsWith('.json'))) {
    try {
      const raw = await readFile(path.join(directory, entry), 'utf8')
      const metadata = JSON.parse(raw) as ArchivedMediaMetadata
      const fileStat = await stat(path.join(directory, metadata.storageFile))
      if (!fileStat.isFile()) continue
      files += 1
      bytes += fileStat.size
    } catch {
      // Ignore les entrées incomplètes, elles seront nettoyées plus tard.
    }
  }
  return { files, bytes }
}

export async function cleanupMediaArchive(
  config: AppConfig,
  sessionName: string,
  retentionDays = config.mediaArchive.retentionDays,
): Promise<number> {
  const directory = archiveDirectory(config, sessionName)
  let entries: string[]
  try {
    entries = await readdir(directory)
  } catch {
    return 0
  }

  const cutoff = Date.now() - Math.max(1, retentionDays) * 86_400_000
  let removed = 0
  for (const entry of entries.filter((name) => name.endsWith('.json'))) {
    const metadataPath = path.join(directory, entry)
    try {
      const raw = await readFile(metadataPath, 'utf8')
      const metadata = JSON.parse(raw) as ArchivedMediaMetadata
      const archivedAt = Date.parse(metadata.archivedAt)
      if (!Number.isFinite(archivedAt) || archivedAt >= cutoff) continue
      await rm(path.join(directory, metadata.storageFile), { force: true })
      await rm(metadataPath, { force: true })
      removed += 1
    } catch (error) {
      logger.debug({ err: error, session: sessionName, entry }, 'Entrée d’archive média ignorée pendant le nettoyage')
    }
  }
  return removed
}
