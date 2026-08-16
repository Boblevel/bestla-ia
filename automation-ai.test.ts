import assert from 'node:assert/strict'
import test from 'node:test'
import { customerMessageNeedsHuman, parseCustomerAiDecision } from '../src/core/automation.js'

test('parseCustomerAiDecision retire le marqueur et détecte le transfert', () => {
  assert.deepEqual(
    parseCustomerAiDecision('Je transmets ta demande au responsable.\nDECISION: TRANSFERER'),
    { text: 'Je transmets ta demande au responsable.', handoff: true },
  )
  assert.deepEqual(
    parseCustomerAiDecision('Bonjour, comment puis-je aider ?\nDECISION: REPONDRE'),
    { text: 'Bonjour, comment puis-je aider ?', handoff: false },
  )
})

test('customerMessageNeedsHuman détecte les demandes commerciales importantes', () => {
  assert.equal(customerMessageNeedsHuman('Je voudrais un devis pour ce service'), true)
  assert.equal(customerMessageNeedsHuman('Est-ce disponible et quel est le prix ?'), true)
  assert.equal(customerMessageNeedsHuman('Bonjour, merci pour votre réponse'), false)
})
