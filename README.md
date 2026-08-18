# Bestla iA

## Commande d'installation

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/Boblevel/bestla-ia/main/install-github.sh) --repo https://github.com/Boblevel/bestla-ia.git
```

Après l'installation :

```bash
bestla
```


## V18.0 — TextMaker premium, statuts téléchargeables, liens sur commande et outils communauté/business

- Le **Créateur de texte V3** n'utilise plus un simple fond local : Bestla demande un arrière-plan premium à son moteur média IA déjà configuré, puis superpose le texte exact localement avec `sharp`. Si le fournisseur IA est indisponible, le rendu local reste disponible en secours.
- `.telechargerstatut` télécharge une **photo, vidéo ou audio de statut** lorsque la commande répond directement au statut.
- Un message contenant un lien HTTP(S) sans commande **ne déclenche plus ni analyse, ni téléchargement, ni Assistantauto**. Le propriétaire garde le contrôle avec `.telecharger`, `.qualites`, `.telechargeraudio` ou `.telechargerapk`.
- `.comptermembres` affiche le nombre total de membres, d'administrateurs et de membres standards d'un groupe.
- Le message de bienvenue est enrichi avec la photo de profil visible, le nom connu ou la mention du membre, le nom du groupe et le nombre total de membres.
- Nouvelles commandes business : `.calculmarge`, `.prixvente`, `.remise`, `.objectifvente`, `.relanceclient`, `.ficheclient`.
- Nouvelles commandes communauté/détente : `.tiragemembre`, `.choisirhasard`, `.questioncouple`, `.defirigolo`, `.verite`, `.gage`, `.compatibilite`, `.blague`.
- Francisation complémentaire : l'ancien alias `.pp`, l'alias `.framevideo` et le sous-ordre `.voix reset` ne sont plus exposés ; utiliser `.photoprofil`, `.photodevideo` et `.voix reinitialiser`.

## V17.9 — commandes françaises, récupération audio, TextMaker amélioré et APK

### Commandes officielles en français

Les noms affichés dans `.menu` sont désormais en français. Les commandes ajoutées en V17.8 qui utilisaient des noms anglais ont été renommées :

- `.changerphotoprofil` : remplace la photo de profil du numéro Bestla avec l’image citée.
- `.identifiantcontact` / `.identifiantgroupe` : affichent les identifiants WhatsApp utiles.
- `.quittergroupe` : fait quitter le groupe au numéro Bestla.
- `.appel`, `.legende`, `.effacer`, `.supprimer`, `.document`, `.enligne`, `.sondagewhatsapp`, `.lire`.
- `.publierstatut`, `.programmerstatut`, `.statuts`.
- `.recuperermedia` : remplace l’ancienne commande courte de récupération et accepte maintenant photo, vidéo et audio.
- `.produitsnumeriques`, `.acheternumerique`, `.produitnumerique`, `.livrernumerique` : remplacent les anciens noms contenant « digital ».
- `.mentioncachee` : remplace l’ancien nom `.taghid` dans les groupes et dans la règle Duo par défaut.

### Créateur de texte V3 premium

Les 17 effets conservent leurs noms français, mais le rendu change : Bestla génère d'abord un **arrière-plan premium par son moteur média IA existant**, adapté au style (cinématique, céleste, néon, graffiti, aquarelle, etc.), puis superpose le texte demandé localement en 1280×1280 avec `sharp` pour éviter les fautes de lettres typiques des générateurs d'images. Aucun nouveau réglage n'est demandé à l'installation. Si le moteur IA est momentanément indisponible, le rendu local V2 sert automatiquement de secours.

- `.3d <texte>`
- `.ange <texte>`
- `.vengeur <texte>`
- `.bulle <texte>`
- `.rose <texte>`
- `.chat <texte>`
- `.parasite <texte>`
- `.paillettes <texte>`
- `.graffiti <texte>`
- `.pirate <texte>`
- `.lumiere <texte>`
- `.superheros <texte>`
- `.neon <texte>`
- `.sciencefiction <texte>`
- `.enseigne <texte>`
- `.tatouage <texte>`
- `.aquarelle <texte>`

### Vue unique et médias expirés

Réponds au média avec :

- `.recuperermedia` : tente de récupérer une **photo, vidéo ou audio** vue unique, ainsi qu’un média dont l’URL WhatsApp a expiré lorsque WhatsApp ou un appareil lié peut encore le fournir.

La récupération reste manuelle : Bestla ne crée pas d’archive cachée des médias vue unique.

### Téléchargement APK

Le téléchargement APK est **toujours déclenché volontairement**. Un message contenant un lien sans commande ne lance ni analyse, ni téléchargement, ni réponse Assistantauto. Utilise `.telechargerapk <lien ou identifiant de paquet>`.

Le moteur APK est installé/réparé automatiquement pendant `npm ci` et au premier usage si nécessaire. La commande accepte :

- un lien Google Play : `.telechargerapk https://play.google.com/store/apps/details?id=com.exemple.app` ;
- un lien APKPure ;
- un lien F-Droid ;
- un lien direct se terminant par `.apk` ;
- un identifiant Android : `.telechargerapk com.exemple.app`.

Pour un lien Play Store sans identifiants Google configurés, Bestla extrait l’identifiant du paquet puis utilise la source publique APKPure. F-Droid est téléchargé depuis F-Droid. Les liens APK directs sont récupérés avec les protections réseau Bestla. Le fichier est envoyé comme document WhatsApp avec sa taille et son empreinte SHA256. La limite dédiée est `MAX_APK_MB=100` par défaut.

Les applications payantes, DRM, privées ou nécessitant une authentification ne sont pas contournées.

### Autres commandes pratiques ajoutées

- `.copiertexte` : en réponse à un message, renvoie uniquement son texte ou sa légende.
- `.infosmessage` : affiche le type, l’expéditeur, l’identifiant, la date et le type de média du message cité.

### Business, communauté et détente

- `.calculmarge 5000 7500` : bénéfice, marge sur vente et majoration.
- `.prixvente 5000 30` : calcule le prix conseillé pour une marge cible.
- `.remise 20000 15` : calcule immédiatement le prix après réduction.
- `.objectifvente 500000 175000` : suit la progression d'un objectif commercial.
- `.relanceclient Nom | service | contexte` : prépare une relance client courte et professionnelle.
- `.ficheclient Nom | contact | besoin | budget | note` : met les informations client en fiche claire.
- `.comptermembres` : total du groupe, administrateurs et membres standards.
- `.tiragemembre` : choisit au hasard un membre du groupe pour une animation ou un cadeau.
- `.choisirhasard option 1 | option 2 | option 3` : tranche aléatoirement entre plusieurs choix.
- `.questioncouple`, `.defirigolo`, `.verite`, `.gage`, `.compatibilite @personne`, `.blague` : animations légères et amusantes.


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

- `.vocal <texte>` (alias français `.textevoix`, `.vocale`) : transforme le texte en note vocale.
- `.voix` : affiche les réglages de la personne qui lance la commande.
- `.voix langue fr` : français. Exemples supplémentaires : `en-ng`, `en`, `sw`, `ar`, `es`, `pt`, `de`, `it`, `tr`, `hi`, `af`.
- `.voix homme` / `.voix femme` : change le genre vocal.
- `.voix liste fr` : liste les voix disponibles pour une langue.
- `.voix choisir fr-FR-DeniseNeural` : sélectionne une voix précise.
- `.voix vitesse +10%` : règle la vitesse entre -50% et +50%.
- `.voix reinitialiser` : rétablit la voix française masculine par défaut.

Les préférences sont enregistrées automatiquement par utilisateur dans `data/tts-preferences.json`. Le dossier `.venv-tts/` est local au serveur et ignoré par Git. Si le moteur n'a pas pu être préparé pendant une mise à jour, la première commande `.vocal` tente de le réparer automatiquement.

## Statuts WhatsApp et commandes pratiques

Bestla mémorise les statuts récents reçus par chaque session WhatsApp sans les envoyer à Assistantauto. Baileys exige des clés de messages individuelles pour marquer des éléments comme lus ; Bestla conserve donc automatiquement ces clés récentes et les traite en lot.

- `.lirestatuts` : marque en une fois comme vus les statuts récents mémorisés par la session actuelle.
- `.telechargerstatut` : en réponse directe à un statut, renvoie sa photo, sa vidéo ou son audio sous forme de média normal.
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
- `.duo ajouter mentioncachee | cache` : ajoute une réponse exacte entre deux sessions Bestla.
- `.duo retirer <id>` : supprime une règle.
- Une règle `mentioncachee -> cache` est déjà fournie par défaut ; elle devient active avec `.duo activer`.
- `.mentioncachee [message]` : mention discrètement tous les membres du groupe sans afficher la liste complète des numéros. Commande réservée aux administrateurs du groupe.

Les messages provenant d'une autre session Bestla sont stoppés avant le routeur normal : ils ne lancent ni Assistantauto ni la même commande une deuxième fois.

## Téléchargement de médias publics

Bestla installe et entretient automatiquement `yt-dlp` pendant `npm ci`/mise à jour. Aucune clé API n'est demandée. FFmpeg, déjà installé par Bestla, sert à la fusion et à l'extraction audio.

En discussion privée, **aucun lien brut n'est analysé automatiquement et Assistantauto ignore aussi les messages contenant un lien sans commande**. Utilise une commande explicite. Avec `.telecharger <lien>` sans qualité, Bestla affiche le menu et tu réponds ensuite simplement `720p`, `1080p`, `best`, `audio 128k`, etc. Le choix reste disponible 10 minutes.

- `.qualites <lien>` : inspecte les résolutions disponibles.
- `.telecharger <lien>` : affiche d'abord le menu de qualités.
- `.telecharger <lien> 240p|360p|480p|720p|1080p|1440p|2160p|best` : téléchargement direct si tu connais déjà la qualité souhaitée.
- `.telechargeraudio <lien> 64k|96k|128k|160k|192k|256k|320k` : extrait directement l'audio en MP3.

Pour YouTube public, Bestla prépare automatiquement le fournisseur PO Token, démarre son serveur local et essaie plusieurs profils (`mweb`, `web_safari`, puis le profil standard) avant d'abandonner. Pour les autres réseaux, Bestla tente le profil normal puis un profil d'impersonation navigateur quand le binaire yt-dlp le permet ; Instagram possède en plus un profil iOS de secours.

Domaines publics autorisés : YouTube, Instagram, Facebook, TikTok, X/Twitter, Threads, Vimeo, Dailymotion, SoundCloud, Twitch, Reddit, Pinterest, Snapchat Spotlight, Streamable, Tumblr, Flickr et Imgur. Bestla ne tente pas de contourner les contenus privés, les connexions obligatoires ou les protections DRM. La qualité peut être abaissée automatiquement si le fichier dépasse la limite média WhatsApp configurée ; le message final indique alors la qualité réellement utilisée.

## Vitesse et outils vidéo

Réponds au média avec la commande :

- `.vitesse 0.5` à `.vitesse 3` : ralentit ou accélère un audio ou une vidéo. La vidéo et le son restent synchronisés.
- `.muetvideo` : retire le son d'une vidéo.
- `.capturevideo 5` : extrait une image à la seconde 5.

Aucune configuration supplémentaire n'est nécessaire après une installation ou une mise à jour Bestla normale.

