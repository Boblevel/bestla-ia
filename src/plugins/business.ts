import type { AutomationSettings } from '../core/database.js'
import type { BotCommand } from '../types.js'
import { brandedPanel } from '../utils/brand.js'

type BusinessField = keyof AutomationSettings['business']

function businessCommand(
  name: BusinessField,
  title: string,
  description: string,
  aliases: string[] = [],
): BotCommand {
  return {
    name,
    aliases,
    description,
    usage: '[definir <texte>|effacer]',
    category: 'Entreprise',
    async execute(ctx) {
      const action = ctx.args[0]?.toLowerCase()
      if (action === 'definir' || action === 'effacer') {
        if (!ctx.isOwner) return void (await ctx.reply('Cette action est réservée au propriétaire.'))
        const content = action === 'effacer' ? '' : ctx.args.slice(1).join(' ').trim()
        if (action === 'definir' && !content) {
          return void (await ctx.reply(`Utilisation : ${ctx.prefix}${name} definir <texte>`))
        }
        await ctx.db.mutateAutomation((settings) => {
          settings.business[name] = content.slice(0, 4_000)
        })
        await ctx.reply(action === 'effacer' ? `${title} effacé.` : `${title} enregistré.`)
        return
      }

      const content = ctx.db.getAutomation().business[name]
      if (!content) {
        await ctx.reply(
          ctx.isOwner
            ? `${title} n’est pas encore configuré. Utilise ${ctx.prefix}${name} definir <texte>.`
            : 'Cette information n’est pas encore disponible.',
        )
        return
      }
      await ctx.reply(brandedPanel(title.toUpperCase(), content.split('\n'), ctx.config))
    },
  }
}

export const businessCommands: BotCommand[] = [
  businessCommand('entreprise', 'Présentation de l’entreprise', 'Affiche ou configure la présentation de l’entreprise.', [
    'aproposentreprise',
  ]),
  businessCommand('services', 'Nos services', 'Affiche ou configure la liste des services.'),
  businessCommand('tarifs', 'Nos tarifs', 'Affiche ou configure les tarifs.', ['prix']),
  businessCommand('contact', 'Nous contacter', 'Affiche ou configure les coordonnées de contact.', ['coordonnees']),
  businessCommand('adresse', 'Notre adresse', 'Affiche ou configure l’adresse ou la zone desservie.', ['localisation']),
  businessCommand('paiement', 'Moyens de paiement', 'Affiche ou configure les moyens de paiement acceptés.', ['paiements']),
  businessCommand('livraison', 'Livraison', 'Affiche ou configure les informations de livraison.', ['livraisons']),
  businessCommand('reseaux', 'Nos réseaux', 'Affiche ou configure les réseaux sociaux et liens officiels.', ['reseauxsociaux']),
  businessCommand('catalogue', 'Notre catalogue', 'Affiche ou configure le catalogue, les produits ou le lien catalogue.', ['produits']),
  businessCommand('conditions', 'Conditions de vente', 'Affiche ou configure les conditions de vente ou de service.', ['conditionsvente']),
]
