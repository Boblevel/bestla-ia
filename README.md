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

Assistantauto privilégie maintenant la vitesse : les salutations, remerciements et petits échanges courants sont traités localement et instantanément ; les autres messages utilisent `gemini-3.5-flash-lite` avec réflexion minimale, puis retombent sur le modèle Gemini configuré si nécessaire. Le style est celui d'un jeune adulte francophone ouest-africain de 23 ans, poli et naturel, sans caricature ni imitation d'accent. Le ton s'adapte uniquement aux messages visibles du contact.

Règle emoji stricte : si le contact n'utilise aucun emoji, Assistantauto n'en envoie aucun. Si le contact en utilise, la réponse peut en reprendre au maximum un lorsque cela paraît naturel. Un simple `OK` sans emoji peut rester sans réponse, comme dans une conversation humaine.

## Texte vers vocal

Le moteur vocal est installé automatiquement pendant `npm ci`, donc aussi lors d'une installation neuve ou d'une mise à jour depuis le panneau Bestla. Aucune clé TTS n'est demandée. Le service utilise `edge-tts` et convertit le résultat en OGG/Opus pour l'envoyer comme vraie note vocale WhatsApp.

- `.vocal <texte>` (alias `.tts`, `.textevoix`, `.vocale`) : transforme le texte en note vocale.
- `.voix` : affiche les réglages de la personne qui lance la commande.
- `.voix langue fr` : français. Exemples supplémentaires : `en-ng`, `en`, `sw`, `ar`, `es`, `pt`, `de`, `it`, `tr`, `hi`, `af`.
- `.voix homme` / `.voix femme` : change le genre vocal.
- `.voix liste fr` : liste les voix disponibles pour une langue.
- `.voix choisir fr-FR-DeniseNeural` : sélectionne une voix précise.
- `.voix vitesse +10%` : règle la vitesse entre -50% et +50%.
- `.voix reset` : rétablit la voix française masculine par défaut.

Les préférences sont enregistrées automatiquement par utilisateur dans `data/tts-preferences.json`. Le dossier `.venv-tts/` est local au serveur et ignoré par Git. Si le moteur n'a pas pu être préparé pendant une mise à jour, la première commande `.vocal` tente de le réparer automatiquement.
