import assert from 'node:assert/strict'
import test from 'node:test'
import { CommandRegistry } from '../src/core/registry.js'
import { registerBuiltInCommands } from '../src/plugins/index.js'

test('enregistre un catalogue étendu de commandes françaises sans anciens noms anglais', () => {
  const registry = new CommandRegistry()
  registerBuiltInCommands(registry)
  assert.ok(registry.list().length >= 160)
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
    'vocal',
    'voix',
    'creerpdf',
    'budget',
    'morpion',
    'photoprofil',
    'lirestatuts',
    'autostatuts',
    'presence',
    'apropos',
    'confidentialite',
    'duo',
    'mentioncachee',
    'telecharger',
    'telechargeraudio',
    'qualites',
    'vitesse',
    'muetvideo',
    'capturevideo',
    'commande',
    'genererimage',
    'modifierimage',
    'generervideo',
    'animerimage',
    'modifiervideo',
    'serviceclientia',
    'produitsnumeriques',
    'acheternumerique',
    'produitnumerique',
    'livrernumerique',
    '3d',
    'ange',
    'vengeur',
    'bulle',
    'rose',
    'chat',
    'parasite',
    'paillettes',
    'graffiti',
    'pirate',
    'lumiere',
    'superheros',
    'neon',
    'sciencefiction',
    'enseigne',
    'tatouage',
    'aquarelle',
    'changerphotoprofil',
    'identifiantgroupe',
    'identifiantcontact',
    'quittergroupe',
    'appel',
    'legende',
    'effacer',
    'contacts',
    'supprimer',
    'document',
    'enligne',
    'sondagewhatsapp',
    'lire',
    'programmerstatut',
    'publierstatut',
    'statuts',
    'recuperermedia',
    'copiertexte',
    'infosmessage',
    'telechargerapk',
  ]) {
    assert.ok(registry.get(frenchName), frenchName)
  }
  assert.ok(registry.get('pp'), 'pp')
  for (const oldEnglishName of ['angel', 'avenger', 'blub', 'bpink', 'cat', 'glitch', 'glitter', 'hacker', 'light', 'marvel', 'sci', 'sign', 'tattoo', 'watercolor', 'fullpp', 'jid', 'gjid', 'left', 'call', 'caption', 'clear', 'delete', 'dlt', 'doc', 'online', 'poll', 'read', 'scstatus', 'setstatus', 'status', 'vv', 'taghid', 'hidetag', 'block', 'unblock', 'produitsdigitaux', 'acheterdigital', 'produitdigital', 'livrerdigital', 'download', 'dl', 'tts', 'tictactoe', 'videoedit', 'commandeswitch', 'ask', 'prompt', 'replypro']) {
    assert.equal(registry.get(oldEnglishName), undefined, oldEnglishName)
  }
})
