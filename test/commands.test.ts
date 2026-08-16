import assert from 'node:assert/strict'
import test from 'node:test'
import { CommandRegistry } from '../src/core/registry.js'
import { registerBuiltInCommands } from '../src/plugins/index.js'

test('enregistre un catalogue étendu de commandes françaises sans anciens noms anglais', () => {
  const registry = new CommandRegistry()
  registerBuiltInCommands(registry)
  assert.ok(registry.list().length >= 130)
  for (const oldName of ['ping', 'uptime', 'owner', 'kick', 'add', 'open', 'close', 'warn', 'sticker']) {
    assert.equal(registry.get(oldName), undefined, oldName)
  }
  for (const frenchName of [
    'latence',
    'duree',
    'proprietaire',
    'expulser',
    'ajouter',
    'ouvrir',
    'fermer',
    'avertir',
    'calculer',
    'reglement',
    'messagesdisparition',
    'filigrane',
    'ticket',
    'catalogue',
    'etatserveur',
    'assistant',
    'convertiraudio',
    'creerpdf',
    'budget',
    'morpion',
    'photoprofil',
    'commande',
    'genererimage',
    'modifierimage',
    'generervideo',
    'animerimage',
    'modifiervideo',
    'serviceclientia',
    'produitsdigitaux',
    'acheterdigital',
    'produitdigital',
    'livrerdigital',
  ]) {
    assert.ok(registry.get(frenchName), frenchName)
  }
})
