import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  normalizePublicMediaUrl,
  parseAudioBitrate,
  parseSocialDownloadChoice,
  parseVideoQuality,
  SocialDownloadError,
  videoFormatSelector,
  youtubePotProviderArgs,
} from '../src/core/social-downloader.js'
import { atempoFilter } from '../src/utils/ffmpeg.js'

test('valide les qualités vidéo et audio prévues par les commandes', () => {
  assert.equal(parseVideoQuality(undefined), 720)
  assert.equal(parseVideoQuality('1080p'), 1080)
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
  assert.deepEqual(parseSocialDownloadChoice('best'), { kind: 'video', quality: 'best' })
  assert.deepEqual(parseSocialDownloadChoice('audio 192k'), { kind: 'audio', bitrate: 192 })
  assert.deepEqual(parseSocialDownloadChoice('mp3'), { kind: 'audio', bitrate: 128 })
  assert.equal(parseSocialDownloadChoice('bonjour'), undefined)
})


test('active automatiquement le provider PO Token YouTube lorsqu’il est installé', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'bestla-pot-test-'))
  const oldXdg = process.env.XDG_CONFIG_HOME
  try {
    const root = path.join(temp, '.bestla', 'bgutil-ytdlp-pot-provider')
    const server = path.join(root, 'server')
    const plugin = path.join(temp, '.config', 'yt-dlp', 'plugins', 'bgutil-ytdlp-pot-provider', 'yt_dlp_plugins')
    process.env.XDG_CONFIG_HOME = path.join(temp, '.config')
    assert.deepEqual(youtubePotProviderArgs(temp), [])
    await mkdir(path.join(server, 'build'), { recursive: true })
    await mkdir(plugin, { recursive: true })
    await writeFile(path.join(server, 'build', 'generate_once.js'), 'export {}')
    const args = youtubePotProviderArgs(temp)
    assert.deepEqual(args, [
      '--extractor-args',
      `youtubepot-bgutilscript:server_home=${server}`,
      '--extractor-args',
      'youtube:player-client=mweb',
    ])
  } finally {
    if (oldXdg === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = oldXdg
    await rm(temp, { recursive: true, force: true })
  }
})
