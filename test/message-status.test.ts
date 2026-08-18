import assert from 'node:assert/strict'
import test from 'node:test'
import type { WAMessage } from '@whiskeysockets/baileys'
import { quotedAsMessage } from '../src/utils/message.js'

test('préserve status@broadcast lorsqu’une commande répond à un statut', () => {
  const message = {
    key: { remoteJid: '22670000000@s.whatsapp.net', fromMe: true, id: 'commande' },
    message: {
      extendedTextMessage: {
        text: '.telechargerstatut',
        contextInfo: {
          stanzaId: 'statut-id',
          participant: '22671111111@s.whatsapp.net',
          remoteJid: 'status@broadcast',
          quotedMessage: {
            imageMessage: {
              url: 'https://example.com/image.jpg',
              mimetype: 'image/jpeg',
            },
          },
        },
      },
    },
  } as WAMessage

  const quoted = quotedAsMessage(message)
  assert.equal(quoted?.key.remoteJid, 'status@broadcast')
  assert.equal(quoted?.key.participant, '22671111111@s.whatsapp.net')
  assert.ok(quoted?.message?.imageMessage)
})
