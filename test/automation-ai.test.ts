import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import {
  acknowledgementReaction,
  customerMessageNeedsHuman,
  messageHasEmoji,
  parseCustomerAiDecision,
  quickHumanReply,
  sanitizeNaturalReply,
} from '../src/core/automation.js'

test('parseCustomerAiDecision retire les anciens marqueurs internes', () => {
  assert.deepEqual(
    parseCustomerAiDecision('Je te réponds juste après.\nDECISION: TRANSFERER'),
    { text: 'Je te réponds juste après.', handoff: true },
  )
  assert.deepEqual(
    parseCustomerAiDecision('Ça va bien et toi ?\nDECISION: REPONDRE'),
    { text: 'Ça va bien et toi ?', handoff: false },
  )
  assert.deepEqual(
    parseCustomerAiDecision('Merci à toi 🙏\nDECISION'),
    { text: 'Merci à toi 🙏', handoff: false },
  )
})

test('customerMessageNeedsHuman détecte les demandes commerciales et directes au propriétaire', () => {
  assert.equal(customerMessageNeedsHuman('Je voudrais un devis pour ce service'), true)
  assert.equal(customerMessageNeedsHuman('Est-ce disponible et quel est le prix ?'), true)
  assert.equal(customerMessageNeedsHuman('Je veux parler à Rhaff'), true)
  assert.equal(customerMessageNeedsHuman('Bonjour, merci pour votre réponse'), false)
})

test('assistantauto ne réagit en emoji que si le contact utilise lui-même un emoji', () => {
  assert.equal(acknowledgementReaction('Ok', true), undefined)
  assert.equal(acknowledgementReaction('OK pas de soucis mrs', true), undefined)
  assert.equal(acknowledgementReaction('Merci beaucoup', true), undefined)
  assert.equal(acknowledgementReaction('Ok 👍', true), '👍')
  assert.equal(acknowledgementReaction('Merci beaucoup 🙏', true), '🙏')
  assert.equal(acknowledgementReaction('Ok 👍', false), undefined)
})

test('petits échanges sociaux ont une réponse locale immédiate et sobre', () => {
  const greeting = quickHumanReply('Salut', false, 'contact-a')
  assert.equal(greeting.handled, true)
  assert.ok(greeting.text)
  assert.equal(messageHasEmoji(greeting.text ?? ''), false)

  const thanks = quickHumanReply('Merci beaucoup', true, 'contact-a')
  assert.equal(thanks.handled, true)
  assert.ok(thanks.text)
  assert.equal(messageHasEmoji(thanks.text ?? ''), false)

  const ack = quickHumanReply('OK pas de soucis mrs', true, 'contact-a')
  assert.deepEqual(ack, { handled: true })
})

test('barrière emoji retire les emojis si le contact n’en utilise pas', () => {
  assert.equal(sanitizeNaturalReply('D’accord 👍 on fait comme ça 🙏', true, false), 'D’accord on fait comme ça')
  const allowed = sanitizeNaturalReply('D’accord 👍 on fait comme ça 🙏', true, true)
  assert.equal(messageHasEmoji(allowed), true)
  assert.equal((allowed.match(/\p{Extended_Pictographic}/gu) ?? []).length, 1)
})

test('assistantauto utilise le modèle rapide et ne demande jamais d’imprimer DECISION', () => {
  const source = readFileSync(new URL('../src/core/automation.ts', import.meta.url), 'utf8')
  assert.equal(source.includes('À la toute fin de ta réponse'), false)
  assert.equal(source.includes('Ta demande est déjà prise en compte'), false)
  assert.equal(source.includes('attenteia:'), false)
  assert.equal(source.includes('serviceclientia:'), false)
  assert.match(source, /gemini-3\.5-flash-lite/)
  assert.match(source, /thinkingLevel: 'minimal'/)
  assert.match(source, /Retourne uniquement le message final à envoyer/)
  assert.match(source, /if \(handoff && !pending\) \{[\s\S]*await this\.db\.addTicket\(ticket\)/)
})
