# Bestla iA

## Commande d'installation

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/Boblevel/bestla-ia/main/install-github.sh) --repo https://github.com/Boblevel/bestla-ia.git
```

Après l'installation :

```bash
bestla
```

## Médias IA

La génération d'images est préconfigurée avec un pool Cloudflare central à deux comptes : aucun Account ID ni token Cloudflare n'est demandé à l'installation.

- `.genererimage <description>` : Cloudflare Workers AI, bascule automatique compte principal -> compte de secours en cas de quota/erreur.
- `.generervideo <description>` : Gemini si disponible ; sinon création automatique d'une courte vidéo locale de 5 secondes à partir d'une image Cloudflare.
- `.animerimage <instruction>` : Gemini si disponible ; sinon animation locale courte.
- `.modifierimage <instruction>` : retouche Gemini si une clé Gemini est configurée.
- `.etatmediaia` : état du système média.

La clé Gemini déjà présente sur une installation existante est conservée pendant les mises à jour.

## Assistant automatique

- `.assistantauto activer` : active les réponses automatiques sur les messages privés entrants.
- `.assistantauto desactiver` : désactive l'assistant automatique.
- `.assistantauto statut` : affiche son état.
- `.assistantauto consigne <texte>` : ajoute le contexte métier souhaité.

Le mode automatique écrit comme une personne de 23 ans sur WhatsApp : réponses courtes, naturelles et adaptées au ton visible du contact. Il évite les formulations de chatbot, ne signe pas les messages, ne révèle aucun marqueur interne et ne recommence pas une salutation à chaque tour. Les demandes commerciales importantes ou les demandes de parler directement au propriétaire restent signalées en interne sans interrompre la conversation.

Pour les messages très courts comme `OK`, `merci`, `d'accord` ou `pas de souci`, Bestla peut simplement réagir avec un emoji plutôt que d'envoyer une réponse artificielle.
