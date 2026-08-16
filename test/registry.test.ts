import assert from 'node:assert/strict'
import test from 'node:test'
import { CommandRegistry } from '../src/core/registry.js'

test('retrouve une commande par son alias', () => {
  const registry = new CommandRegistry()
  registry.register({
    name: 'test',
    aliases: ['essai'],
    description: 'Commande de test',
    category: 'Général',
    async execute() {},
  })
  assert.equal(registry.get('essai')?.name, 'test')
})

test('refuse les collisions de commandes', () => {
  const registry = new CommandRegistry()
  const command = {
    name: 'test',
    description: 'Commande de test',
    category: 'Général' as const,
    async execute() {},
  }
  registry.register(command)
  assert.throws(() => registry.register(command), /déjà enregistrée/)
})
