import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeWords, parseCommand } from '../src/utils/text.js'

test('parse une commande et ses arguments', () => {
  assert.deepEqual(parseCommand('.ping maintenant', '.'), {
    isCommand: true,
    name: 'ping',
    args: ['maintenant'],
    argText: 'maintenant',
  })
})

test('ignore un message ordinaire', () => {
  assert.equal(parseCommand('bonjour', '.').isCommand, false)
})

test('normalise les accents pour la modération', () => {
  assert.deepEqual(normalizeWords('Éléphant, DÉJÀ !'), ['elephant', 'deja'])
})
