import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('envoyervueunique envoie image vidéo et audio directement au destinataire sans légende', async () => {
  const source = await readFile(new URL('../src/plugins/whatsapp.ts', import.meta.url), 'utf8')
  assert.match(source, /name: 'envoyervueunique'/)
  assert.match(source, /sendMessage\(destination, \{ image: media\.buffer, viewOnce: true \}\)/)
  assert.match(source, /sendMessage\(destination, \{ video: media\.buffer, mimetype: media\.mimetype, viewOnce: true \}\)/)
  assert.match(source, /sendMessage\(destination, \{ audio: media\.buffer, mimetype: media\.mimetype, ptt: false, viewOnce: true \}\)/)
  assert.match(source, /remoteJidAlt/)
  assert.match(source, /signalRepository\?\.lidMapping/)
  assert.match(source, /getLIDForPN\(requestedTarget\)/)
  assert.match(source, /getLIDForPN\(matched\.jid\)/)
  assert.match(source, /const destination = await resolvePrivateOutboundJid\(ctx, requestedTarget\)/)
  const commandBlock = source.slice(source.indexOf("name: 'envoyervueunique'"), source.indexOf("name: 'ephemereauto'"))
  assert.equal(/caption\s*:/.test(commandBlock), false)
  assert.equal(/mentions\s*:/.test(commandBlock), false)
  assert.equal(/quoted\s*:/.test(commandBlock), false)
  assert.equal(/disappearingMessagesInChat/.test(commandBlock), false)
})

test('ephemereauto applique 24 h uniquement aux messages privés entrants', async () => {
  const router = await readFile(new URL('../src/core/router.ts', import.meta.url), 'utf8')
  const whatsapp = await readFile(new URL('../src/plugins/whatsapp.ts', import.meta.url), 'utf8')
  assert.match(router, /isPrivateUser && !fromMe && this\.db\.getAutoEphemeral24h\(\)/)
  assert.match(router, /disappearingMessagesInChat: 86_400/)
  assert.match(whatsapp, /name: 'ephemereauto'/)
  assert.equal(whatsapp.includes('updateDefaultDisappearingMode'), false)
})
