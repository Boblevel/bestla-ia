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

Assistantauto vise maintenant un rythme humain d'environ **3 secondes** : les petits échanges sont préparés localement, et les autres messages utilisent `gemini-3.5-flash-lite` avec réflexion minimale. Si l'appel réseau dépasse la fenêtre rapide, Bestla envoie une courte réponse locale contextuelle au lieu de laisser la personne attendre longtemps. Le réseau WhatsApp lui-même peut parfois ajouter un léger délai.

Le style est celui d'un jeune adulte africain francophone de 23 ans, poli, posé et naturel, sans caricature ni imitation d'accent. Le ton, le tutoiement/vouvoiement et la longueur s'adaptent uniquement à la manière dont le contact écrit. Règle emoji stricte : aucun emoji si le contact n'en utilise pas ; s'il en utilise, au maximum un emoji occasionnel lorsque cela paraît naturel.

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

## Statuts WhatsApp et commandes pratiques

Bestla mémorise les statuts récents reçus par chaque session WhatsApp sans les envoyer à Assistantauto. Baileys exige des clés de messages individuelles pour marquer des éléments comme lus ; Bestla conserve donc automatiquement ces clés récentes et les traite en lot.

- `.lirestatuts` : marque en une fois comme vus les statuts récents mémorisés par la session actuelle.
- `.autostatuts activer` : marque automatiquement comme vus les nouveaux statuts à leur réception.
- `.autostatuts desactiver` : arrête la lecture automatique.
- `.autostatuts statut` : affiche l'état du réglage. Le choix est conservé après redémarrage et mise à jour.
- `.presence enligne|horsligne|ecriture|audio|pause` : change la présence WhatsApp du compte connecté.
- `.apropos <texte>` : modifie le texte « À propos » du profil WhatsApp.
- `.confidentialite` : affiche les réglages de confidentialité accessibles depuis la session.

Aucune clé, variable `.env` ou configuration VPS supplémentaire n'est requise pour ces commandes. `autostatuts` est désactivé par défaut afin que chaque installateur choisisse volontairement de l'activer.

## Duo multi-numéros et mention discrète

Quand plusieurs numéros Bestla sont connectés au même projet, le mode duo évite qu'un message envoyé par une session soit exécuté une seconde fois par une autre session dans le même groupe. Il peut aussi déclencher de petites réponses entre les numéros Bestla.

- `.duo activer` / `.duo desactiver` / `.duo statut`
- `.duo liste` : affiche les règles.
- `.duo ajouter taghid | hide` : ajoute une réponse exacte entre deux sessions Bestla.
- `.duo retirer <id>` : supprime une règle.
- Une règle `taghid -> hide` est déjà fournie par défaut ; elle devient active avec `.duo activer`.
- `.taghid [message]` : mention discrètement tous les membres du groupe sans afficher la liste complète des numéros. Commande réservée aux administrateurs du groupe.

Les messages provenant d'une autre session Bestla sont stoppés avant le routeur normal : ils ne lancent ni Assistantauto ni la même commande une deuxième fois.

## Téléchargement de médias publics

Bestla installe et entretient automatiquement `yt-dlp` pendant `npm ci`/mise à jour. Aucune clé API n'est demandée. FFmpeg, déjà installé par Bestla, sert à la fusion et à l'extraction audio.

En discussion privée, tu peux aussi **coller uniquement le lien**. Bestla demande alors `360p`, `480p`, `720p`, `1080p`, `best` ou `audio 128k`, puis lance le téléchargement après ta réponse. Le choix reste disponible 10 minutes.

- `.qualites <lien>` : inspecte les résolutions disponibles.
- `.telecharger <lien> 360p|480p|720p|1080p|best` : télécharge directement une vidéo publique. Le moteur yt-dlp et le fournisseur PO Token YouTube sont préparés automatiquement pendant l'installation/mise à jour ; aucune clé ou compte YouTube n'est demandé pour les contenus publics.
- `.telechargeraudio <lien> 64k|96k|128k|160k|192k|256k|320k` : extrait directement l'audio en MP3.

Domaines publics autorisés : YouTube, Instagram, Facebook, TikTok, X/Twitter, Threads, Vimeo, Dailymotion, SoundCloud, Twitch, Reddit et Pinterest. Bestla ne tente pas de contourner les contenus privés, les connexions obligatoires ou les protections DRM. La qualité peut être abaissée automatiquement si le fichier dépasse la limite média WhatsApp configurée.

## Vitesse et outils vidéo

Réponds au média avec la commande :

- `.vitesse 0.5` à `.vitesse 3` : ralentit ou accélère un audio ou une vidéo. La vidéo et le son restent synchronisés.
- `.muetvideo` : retire le son d'une vidéo.
- `.capturevideo 5` : extrait une image à la seconde 5.

Aucune configuration supplémentaire n'est nécessaire après une installation ou une mise à jour Bestla normale.

