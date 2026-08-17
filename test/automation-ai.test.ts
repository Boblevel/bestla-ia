import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import {
  acknowledgementReaction,
  customerMessageNeedsHuman,
  parseCustomerAiDecision,
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
  assert.deepEqual(
    parseCustomerAiDecision('Oui je suis là, dis-moi.\nDECISION:'),
    { text: 'Oui je suis là, dis-moi.', handoff: false },
  )
})

test('customerMessageNeedsHuman détecte les demandes commerciales et demandes directes au propriétaire', () => {
  assert.equal(customerMessageNeedsHuman('Je voudrais un devis pour ce service'), true)
  assert.equal(customerMessageNeedsHuman('Est-ce disponible et quel est le prix ?'), true)
  assert.equal(customerMessageNeedsHuman('Je veux parler à Rhaff'), true)
  assert.equal(customerMessageNeedsHuman('Bonjour, merci pour votre réponse'), false)
})

test('acknowledgementReaction évite les réponses robotiques aux petits accusés de réception', () => {
  assert.equal(acknowledgementReaction('Ok', true), '👍')
  assert.equal(acknowledgementReaction('OK pas de soucis mrs', true), '👍')
  assert.equal(acknowledgementReaction('Merci beaucoup', true), '🙏')
  assert.equal(acknowledgementReaction('Ok', false), undefined)
  assert.equal(acknowledgementReaction('Ok mais explique-moi le prix', true), undefined)
})

test('assistantauto ne demande plus au modèle d’imprimer DECISION et garde le transfert interne', () => {
  const source = readFileSync(new URL('../src/core/automation.ts', import.meta.url), 'utf8')
  assert.equal(source.includes('À la toute fin de ta réponse'), false)
  assert.equal(source.includes('Ta demande est déjà prise en compte'), false)
  assert.equal(source.includes('attenteia:'), false)
  assert.equal(source.includes('serviceclientia:'), false)
  assert.match(source, /Réponds uniquement avec le message naturel à envoyer sur WhatsApp/)
  assert.match(source, /if \(!pending\) \{[\s\S]*await this\.db\.addTicket\(ticket\)/)
})
