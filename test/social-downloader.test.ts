import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  availableVideoChoices,
  clearPendingSocialDownload,
  getPendingSocialDownload,
  normalizePublicMediaUrl,
  parseAudioBitrate,
  parseSocialDownloadChoice,
  parseVideoQuality,
  setPendingSocialDownload,
  SocialDownloadError,
  videoChoiceAllowed,
  videoFormatSelector,
  youtubePotProviderArgs,
} from '../src/core/social-downloader.js'
import { atempoFilter } from '../src/utils/ffmpeg.js'

test('valide les qualités vidéo et audio prévues par les commandes', () => {
  assert.equal(parseVideoQuality(undefined), 720)
  assert.equal(parseVideoQuality('1080p'), 1080)
  assert.equal(parseVideoQuality('2160p'), 2160)
  assert.equal(parseVideoQuality('best'), 'best')
  assert.equal(parseAudioBitrate(undefined), 128)
  assert.equal(parseAudioBitrate('192k'), 192)
  assert.throws(() => parseVideoQuality('8k'), SocialDownloadError)
  assert.throws(() => parseAudioBitrate('999k'), SocialDownloadError)
})

test('bloque les schémas et adresses locales avant yt-dlp', () => {
  assert.equal(normalizePublicMediaUrl('https://youtu.be/example'), 'https://youtu.be/example')
  assert.throws(() => normalizePublicMediaUrl('file:///etc/passwd'), SocialDownloadError)
  assert.throws(() => normalizePublicMediaUrl('http://127.0.0.1/test'), SocialDownloadError)
  assert.throws(() => normalizePublicMediaUrl('http://192.168.1.1/test'), SocialDownloadError)
  assert.throws(() => normalizePublicMediaUrl('https://example.com/video.mp4'), SocialDownloadError)
  assert.equal(normalizePublicMediaUrl('https://www.instagram.com/reel/example/'), 'https://www.instagram.com/reel/example/')
  assert.equal(normalizePublicMediaUrl('https://www.snapchat.com/spotlight/example'), 'https://www.snapchat.com/spotlight/example')
})

test('construit une sélection yt-dlp bornée à la qualité demandée', () => {
  assert.match(videoFormatSelector(720), /height<=\?720/)
  assert.equal(videoFormatSelector('best'), 'bv*+ba/b')
})

test('construit des filtres atempo fiables pour la vitesse média', () => {
  assert.equal(atempoFilter(1.5), 'atempo=1.5')
  assert.equal(atempoFilter(3), 'atempo=2,atempo=1.5')
  assert.equal(atempoFilter(0.5), 'atempo=0.5')
  assert.throws(() => atempoFilter(4))
})

test('comprend le choix de qualité après un simple collage de lien', () => {
  assert.deepEqual(parseSocialDownloadChoice('720p'), { kind: 'video', quality: 720 })
  assert.deepEqual(parseSocialDownloadChoice('2160p'), { kind: 'video', quality: 2160 })
  assert.deepEqual(parseSocialDownloadChoice('best'), { kind: 'video', quality: 'best' })
  assert.deepEqual(parseSocialDownloadChoice('audio 192k'), { kind: 'audio', bitrate: 192 })
  assert.deepEqual(parseSocialDownloadChoice('mp3'), { kind: 'audio', bitrate: 128 })
  assert.equal(parseSocialDownloadChoice('bonjour'), undefined)
})

test('propose seulement les qualités standard réellement détectées puis best', () => {
  assert.deepEqual(availableVideoChoices([239, 360, 719, 1080]), [240, 360, 720, 1080, 'best'])
  assert.deepEqual(availableVideoChoices([]), [360, 480, 720, 1080, 'best'])
})

test('mémorise le lien après .telecharger pour accepter ensuite un simple 720p', () => {
  const session = 'main'
  const chat = '22670000000@s.whatsapp.net'
  const sender = chat
  setPendingSocialDownload(session, chat, sender, 'https://youtu.be/example', [360, 720, 'best'], 30_000)
  const pending = getPendingSocialDownload(session, chat, sender)
  assert.ok(pending)
  assert.equal(videoChoiceAllowed(pending, { kind: 'video', quality: 720 }), true)
  assert.equal(videoChoiceAllowed(pending, { kind: 'video', quality: 1080 }), false)
  assert.equal(videoChoiceAllowed(pending, { kind: 'audio', bitrate: 128 }), true)
  clearPendingSocialDownload(session, chat, sender)
  assert.equal(getPendingSocialDownload(session, chat, sender), undefined)
})

test('active explicitement le provider PO Token YouTube lorsqu’il est installé', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'bestla-pot-test-'))
  const oldXdg = process.env.XDG_CONFIG_HOME
  const oldPort = process.env.BESTLA_POT_PROVIDER_PORT
  try {
    const root = path.join(temp, '.bestla', 'bgutil-ytdlp-pot-provider')
    const server = path.join(root, 'server')
    const generator = path.join(server, 'build', 'generate_once.js')
    const pluginPackage = path.join(temp, '.config', 'yt-dlp', 'plugins', 'bgutil-ytdlp-pot-provider')
    const plugin = path.join(pluginPackage, 'yt_dlp_plugins')
    process.env.XDG_CONFIG_HOME = path.join(temp, '.config')
    process.env.BESTLA_POT_PROVIDER_PORT = '4417'
    assert.deepEqual(youtubePotProviderArgs(temp), [])
    await mkdir(path.join(server, 'build'), { recursive: true })
    await mkdir(plugin, { recursive: true })
    await writeFile(generator, 'export {}')
    const args = youtubePotProviderArgs(temp)
    assert.deepEqual(args, [
      '--plugin-dirs',
      pluginPackage,
      '--extractor-args',
      'youtubepot-bgutilhttp:base_url=http://127.0.0.1:4417',
      '--extractor-args',
      `youtubepot-bgutilscript:script_path=${generator}`,
    ])
  } finally {
    if (oldXdg === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = oldXdg
    if (oldPort === undefined) delete process.env.BESTLA_POT_PROVIDER_PORT
    else process.env.BESTLA_POT_PROVIDER_PORT = oldPort
    await rm(temp, { recursive: true, force: true })
  }
})
