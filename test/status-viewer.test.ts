import assert from 'node:assert/strict'
import test from 'node:test'
import type { WAMessage, WASocket } from '@whiskeysockets/baileys'
import {
  isWhatsAppStatusMessage,
  pendingStatusCount,
  readRememberedStatuses,
  rememberStatusMessage,
  resolveRememberedStatusMessage,
} from '../src/core/status-viewer.js'

function statusMessage(id: string, remoteJid = 'status@broadcast'): WAMessage {
  return {
    key: {
      id,
      remoteJid,
      fromMe: false,
      participant: '22670000000@s.whatsapp.net',
      remoteJidAlt: '22670000000@s.whatsapp.net',
    },
    messageTimestamp: Math.floor(Date.now() / 1000),
    message: { conversation: 'story' },
  } as WAMessage
}

test('reconnaît les deux formes de JID utilisées par les statuts Baileys v7', () => {
  assert.equal(isWhatsAppStatusMessage(statusMessage('a')), true)
  assert.equal(isWhatsAppStatusMessage(statusMessage('b', '1781870949@broadcast')), true)
  assert.equal(isWhatsAppStatusMessage(statusMessage('c', '22670000000@s.whatsapp.net')), false)
})

test('mémorise puis marque tous les statuts récents comme lus en un lot', async () => {
  const batches: string[][] = []
  const sock = {
    async readMessages(keys: Array<{ id?: string | null }>) {
      batches.push(keys.map((key) => key.id ?? ''))
    },
  } as unknown as WASocket

  assert.equal(rememberStatusMessage(sock, statusMessage('one')), true)
  assert.equal(rememberStatusMessage(sock, statusMessage('two')), true)
  assert.equal(pendingStatusCount(sock), 2)

  const result = await readRememberedStatuses(sock)
  assert.deepEqual(result, { read: 2, failed: 0, pendingBefore: 2 })
  assert.equal(pendingStatusCount(sock), 0)
  assert.deepEqual(batches, [['one', 'two']])
})


test('conserve le message complet après lecture pour permettre le téléchargement du statut cité', async () => {
  const sock = {
    async readMessages() {},
  } as unknown as WASocket
  const original = statusMessage('media-status')
  original.message = {
    imageMessage: {
      url: 'https://mmg.whatsapp.net/media',
      directPath: '/v/t62/example',
      mediaKey: Buffer.alloc(32, 1),
      mimetype: 'image/jpeg',
    },
  }
  assert.equal(rememberStatusMessage(sock, original), true)
  const read = await readRememberedStatuses(sock)
  assert.equal(read.read, 1)
  assert.equal(pendingStatusCount(sock), 0)

  const quotedPreview = {
    key: {
      id: 'media-status',
      remoteJid: '22670000000@s.whatsapp.net',
      participant: '22670000000@s.whatsapp.net',
      fromMe: false,
    },
    message: { conversation: 'aperçu de statut' },
  } as WAMessage
  const resolved = resolveRememberedStatusMessage(sock, quotedPreview)
  assert.equal(resolved, original)
  assert.ok(resolved?.message?.imageMessage)
})

test('ignore les messages privés ordinaires et les vieux statuts', () => {
  const sock = { readMessages: async () => undefined } as unknown as WASocket
  const ordinary = statusMessage('ordinary', '22670000000@s.whatsapp.net')
  assert.equal(rememberStatusMessage(sock, ordinary), false)

  const old = statusMessage('old')
  old.messageTimestamp = Math.floor((Date.now() - 27 * 60 * 60_000) / 1000)
  assert.equal(rememberStatusMessage(sock, old), false)
})
