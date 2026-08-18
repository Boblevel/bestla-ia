## 2026-08-18 — V18.0 — TextMaker premium, statuts, contrôle des liens et outils communauté/business

- TextMaker V3 : les 17 commandes françaises utilisent désormais un arrière-plan premium généré par le moteur média IA déjà configuré dans Bestla, puis un texte exact superposé localement avec `sharp`. Le rendu V2 local reste le secours automatique.
- Ajout de `.telechargerstatut` (`.enregistrerstatut`, `.sauverstatut`) : en réponse à un statut, Bestla récupère photo, vidéo ou audio et le renvoie comme média normal lorsque la session peut encore l'obtenir.
- Correction de la reconstruction des messages cités afin de préserver `status@broadcast` lors d'une réponse à un statut.
- Suppression du traitement automatique des liens bruts : un message contenant un lien HTTP(S) sans commande ne déclenche plus d'analyse, de téléchargement ni Assistantauto. Les commandes `.telecharger`, `.qualites`, `.telechargeraudio` et `.telechargerapk` sont nécessaires.
- Ajout de `.comptermembres` / `.comptegroupe` pour compter total, administrateurs et membres standards.
- Bienvenue enrichie : photo de profil visible si disponible, nom déjà connu ou mention de secours, nom du groupe et effectif actuel.
- Ajout des outils business `.calculmarge`, `.prixvente`, `.remise`, `.objectifvente`, `.relanceclient`, `.ficheclient`.
- Ajout des animations `.tiragemembre`, `.choisirhasard`, `.questioncouple`, `.defirigolo`, `.verite`, `.gage`, `.compatibilite`, `.blague`.
- Francisation complémentaire : retrait de l'alias `.pp`, retrait de `.framevideo` et remplacement du sous-ordre affiché `.voix reset` par `.voix reinitialiser`.
- Ajout de tests ciblés pour les réponses aux statuts et l'absence de déclenchement automatique par lien brut.

## 2026-08-17 — V17.9 — français intégral du menu, audio vue unique, TextMaker V2 et APK

- Renommage des commandes V17.8 encore affichées en anglais : `.changerphotoprofil`, `.identifiantcontact`, `.identifiantgroupe`, `.quittergroupe`, `.appel`, `.legende`, `.effacer`, `.supprimer`, `.document`, `.enligne`, `.sondagewhatsapp`, `.lire`, `.programmerstatut`, `.publierstatut`, `.statuts` et `.recuperermedia`.
- Francisation complémentaire du menu : `.mentioncachee`, `.produitsnumeriques`, `.acheternumerique`, `.produitnumerique` et `.livrernumerique`; les anciens noms anglais/anglicisés correspondants ne sont plus des commandes officielles.
- Retrait des alias anglais visibles les plus courants (`download`, `ask`, `replypro`, `tictactoe`, `videoedit`, `commandeswitch`, `tts`) afin que les commandes publiques restent en français.
- `.recuperermedia` accepte maintenant les photos, vidéos **et audios** vue unique/expirés lorsque WhatsApp ou un appareil lié peut encore fournir les octets.
- Refonte TextMaker : noms officiels français et rendus 1280×1280 réellement différenciés (3D, ange, vengeur, bulle, rose, chat, parasite, paillettes, graffiti, pirate, lumière, super-héros, néon, science-fiction, enseigne, tatouage, aquarelle).
- Ajout de `.telechargerapk` : liens Google Play, APKPure, F-Droid, liens `.apk` directs et identifiants de paquet Android. Pour un lien Play Store sans compte Google, Bestla utilise APKPure comme source publique à partir de l’identifiant de paquet.
- En privé, un lien APK reconnu peut maintenant être simplement collé sans commande : Bestla le détecte et lance le téléchargement automatiquement.
- Ajout du moteur local `apkeep` 1.0.0, installé/réparé automatiquement par `scripts/ensure-apk.sh` pendant `npm ci` et au premier usage.
- Ajout de `MAX_APK_MB=100`, indépendant de la limite média habituelle. Le SHA256 de chaque APK téléchargé est affiché avant utilisation.
- Ajout de `.copiertexte` et `.infosmessage` pour les opérations WhatsApp courantes.
- Aucun contournement des applications payantes, DRM, privées ou nécessitant une authentification.

## 2026-08-17 — V17.8 — TextMaker, commandes utilisateur/WhatsApp et récupération média renforcée

- Ajout d'un atelier TextMaker 100 % local, sans clé API : `.3d`, `.angel`, `.avenger`, `.blub`, `.bpink`, `.cat`, `.glitch`, `.glitter`, `.graffiti`, `.hacker`, `.light`, `.marvel`, `.neon`, `.sci`, `.sign`, `.tattoo` et `.watercolor`.
- Ajout des commandes utilisateur `.fullpp`, `.jid`, `.gjid`, `.left` et des alias `.block`, `.unblock`, `.pp`.
- Ajout des commandes WhatsApp `.call`, `.caption`, `.clear`, `.contacts`, `.delete`, `.dlt`, `.doc`, `.online`, `.poll`, `.read`, `.scstatus`, `.setstatus`, `.status` et `.vv`.
- `.vv` et les autres outils média utilisent désormais `downloadMediaMessage` avec demande de réémission Baileys (`updateMediaMessage`) ; en cas d'échec, Bestla force aussi `updateMediaMessage` avant un second essai afin de contourner le défaut de réémission automatique observé sur Baileys rc14, puis conserve le repli CDN classique pour ne pas casser les fonctions existantes. Bestla ne conserve pas automatiquement les médias vue unique.
- `.setstatus` publie un statut texte, image ou vidéo pour les personnes de la discussion actuelle ; `.scstatus` programme réellement un statut texte ou, en réponse à un média, une image/vidéo. `.scstatus liste` et `.scstatus supprimer <id>` gèrent les tâches. Un média planifié est stocké temporairement uniquement après cette demande explicite et supprimé après un envoi unique.
- `.fullpp` remplace la photo de profil du numéro Bestla avec l'image citée ; `.photoprofil` reste disponible et possède maintenant l'alias `.pp` pour consulter une photo de profil visible.
- Aucun nouveau paquet, token ou réglage `.env` n'est requis : TextMaker réutilise `sharp` et les fonctions WhatsApp réutilisent Baileys déjà présent.

## 2026-08-17 — V17.7 — Sélecteur de qualité + secours multi-réseaux

- `.telecharger <lien>` ne part plus automatiquement en 720p : Bestla analyse d'abord le média, affiche les qualités détectées et attend un simple `720p`, `1080p`, `best` ou `audio 128k`.
- Le collage direct d'un lien utilise le même sélecteur et partage la même mémoire de choix pendant 10 minutes.
- Ajout des qualités 240p, 1440p et 2160p lorsque le site les expose ; la limite WhatsApp peut toujours imposer une adaptation vers une qualité plus basse, annoncée dans le résultat.
- YouTube public : le plugin PO Token est chargé explicitement, le serveur local bgutil est démarré automatiquement et Bestla retente en interne avec mweb + PO Token, web_safari puis le profil standard. Le message « réessaie le même lien une fois » est supprimé.
- Instagram : ajout d'un profil iOS de secours. Les autres réseaux utilisent un second profil d'impersonation Chrome lorsque le build yt-dlp fournit curl_cffi.
- Ajout des domaines publics Snapchat Spotlight, Streamable, Tumblr, Flickr et Imgur à la liste autorisée.
- Les contenus réellement privés, membres, authentifiés ou protégés restent volontairement non contournés.

## 2026-08-17 — V17.6 — Téléchargement YouTube public renforcé

- Corrige le faux message « contenu privé » rencontré sur certaines vidéos YouTube publiques quand YouTube déclenche sa vérification anti-bot.
- Installe automatiquement le provider PO Token `bgutil-ytdlp-pot-provider` 1.3.1 recommandé dans l'écosystème yt-dlp, sans configuration utilisateur.
- Le provider est préparé au `postinstall` et réparé automatiquement au premier téléchargement si nécessaire.
- Aucun cookie, compte YouTube ou clé supplémentaire n'est demandé pour les contenus publics.
- Les contenus réellement privés, membres ou nécessitant une authentification restent refusés.

# Journal des changements

### V17 - Assistantauto ~3 s, duo multi-numéros, téléchargements sociaux et vitesse média - 17 août 2026

- Assistantauto vise une réponse autour de 3 secondes : voie locale pour les échanges simples, Gemini `gemini-3.5-flash-lite` en réflexion minimale pour les autres, et réponse locale contextuelle si le réseau dépasse la fenêtre rapide.
- Règle emoji conservée et renforcée : zéro emoji quand le contact n'en utilise pas ; au maximum un lorsque le contact en utilise.
- Ajout du mode `.duo` pour coordonner plusieurs sessions Bestla dans le même groupe, éviter les doubles exécutions et créer des réponses exactes entre numéros. Règle par défaut : `taghid -> hide`.
- Ajout de `.taghid` pour une mention discrète de tous les membres par un administrateur.
- Ajout de `.qualites`, `.telecharger` et `.telechargeraudio`, plus un mode privé ultra-simple : colle seulement le lien, puis réponds par `720p`, `best` ou `audio 128k`.
- Installation/réparation automatique de `yt-dlp` via `npm ci`; une mise à jour Bestla rafraîchit aussi le moteur vers le canal nightly recommandé par le projet yt-dlp.
- Ajout de `.vitesse 0.5..3` pour audio/vidéo avec synchronisation, `.muetvideo` et `.capturevideo`.
- Sécurité du téléchargeur : pas de shell, domaines sociaux autorisés, refus des adresses privées/locales, playlists désactivées, contenus privés/protégés non contournés.
- Correction de deux collisions d'aliases préexistantes : `info/apropos` et `latence/vitesse` sont désormais séparées afin que le registre de commandes reste valide.
- Aucun nouveau token, compte tiers ou réglage `.env` requis.

### Statuts automatiques + commandes WhatsApp pratiques - 17 août 2026

- Ajout de `.lirestatuts` : Bestla mémorise les statuts récents reçus par la session et les marque comme vus en lot.
- Ajout de `.autostatuts activer|desactiver|statut` : lecture automatique persistante des nouveaux statuts, sans configuration VPS supplémentaire.
- Compatibilité renforcée avec les formes de statuts Baileys v7 : `status@broadcast` et JID numériques `@broadcast` accompagnés du participant.
- Les statuts restent totalement séparés du routeur de commandes et d'Assistantauto : aucun risque de réponse automatique à une story.
- Ajout de `.presence enligne|horsligne|ecriture|audio|pause` pour piloter la présence WhatsApp.
- Ajout de `.apropos <texte>` pour modifier le texte À propos du profil connecté.
- Ajout de `.confidentialite` pour afficher les réglages de confidentialité renvoyés par WhatsApp.
- Aucun nouveau secret, compte tiers, package ou réglage `.env` n'est requis.

### Assistantauto rapide + moteur vocal multilingue - 17 août 2026

- Assistantauto passe sur `gemini-3.5-flash-lite` avec `thinkingLevel=minimal` pour les conversations courantes, avec repli automatique vers le modèle Gemini configuré.
- Réponses locales instantanées pour les salutations, remerciements et petits échanges afin d'éviter un appel réseau inutile.
- Persona affinée : jeune adulte francophone ouest-africain de 23 ans, poli, naturel et urbain, sans caricature ni imitation d'accent.
- Règle emoji rigoureuse : aucun emoji si le contact n'en utilise pas ; au maximum un emoji occasionnel lorsque le contact en utilise.
- Un simple accusé de réception sans emoji peut rester sans réponse au lieu de produire une phrase artificielle.
- Ajout de `.vocal` / `.tts` / `.textevoix` / `.vocale` : texte vers vraie note vocale WhatsApp OGG/Opus.
- Ajout de `.voix` pour changer langue, voix homme/femme, voix précise et vitesse ; préférences persistées par utilisateur.
- Installation automatique de `edge-tts 7.2.8` dans `.venv-tts` via le cycle `npm ci`, sans clé API TTS ni configuration manuelle.
- Auto-réparation du moteur vocal au premier usage si l'installation initiale a été interrompue.

### Assistantauto humanisé + suppression du bug DECISION — 17 août 2026

- Suppression de la consigne qui demandait à Gemini d'afficher `DECISION: ...` en fin de réponse : le marqueur interne ne peut plus être envoyé volontairement au contact.
- Nettoyage défensif des anciens marqueurs `DECISION`, `DECISION:` et `DECISION: TRANSFERER/REPONDRE` si un modèle en produit encore un.
- Persona WhatsApp retravaillée : jeune adulte francophone de 23 ans, naturel, bref, spontané, sans ton « service client ».
- Adaptation au ton observable du contact : tutoiement/familiarité si la conversation l'établit, vouvoiement et sobriété si le contact est formel.
- Réponses sociales plus humaines, sans formules répétitives comme « Comment puis-je vous aider aujourd'hui ? » ou « C'est bien noté ».
- Les petits accusés de réception (`OK`, `d'accord`, `merci`, `pas de souci`, etc.) peuvent recevoir une simple réaction WhatsApp au lieu d'un paragraphe IA.
- Les demandes directes à Rhaff/propriétaire déclenchent toujours le signalement interne sans afficher de ticket, de transfert ou de statut au contact.
- Aucun profilage démographique : l'adaptation se fait uniquement à partir du style visible dans les messages.
- Pool média Cloudflare conservé : deux Workers centraux avec bascule automatique, sans secret Cloudflare dans le dépôt.

### Pool Cloudflare central de test + secours vidéo — 16 août 2026

- Deux comptes Workers AI centraux préconfigurés pour les tests, sans saisie Cloudflare sur le VPS des installateurs.
- Bascule automatique du compte principal vers le compte de secours sur quota, 429, erreurs d'authentification temporaires ou indisponibilité serveur.
- Temporisation automatique d'un compte après quota/erreur pour éviter de le solliciter en boucle.
- `.genererimage` utilise `@cf/black-forest-labs/flux-1-schnell`.
- `.generervideo` conserve Gemini lorsqu'il est disponible et rétablit le comportement fiable de l'ancienne version : courte vidéo locale de 5 secondes depuis une image si Gemini échoue ou n'est pas configuré.
- `.animerimage` bénéficie du même secours local.
- Les médias IA sont activés automatiquement lors de l'installation/mise à jour.
- Le dépôt ne contient plus de token Cloudflare ni d’Account ID : uniquement les URL des deux Workers centraux déjà déployés.

### Mise à jour hybride Cloudflare + Gemini — 16 août 2026

- Génération d'images déplacée vers **Cloudflare Workers AI** avec le modèle par défaut `@cf/black-forest-labs/flux-1-schnell`.
- Vidéo courte, animation d'image et retouche vidéo conservées sur **Gemini**.
- Retouche d'image conservée sur **Gemini** comme solution de secours compatible.
- Ajout des variables `.env` Cloudflare : `MEDIA_AI_CLOUDFLARE_ACCOUNT_ID` et `MEDIA_AI_CLOUDFLARE_API_TOKEN`.
- Ajout des fournisseurs séparés `MEDIA_AI_IMAGE_PROVIDER` et `MEDIA_AI_VIDEO_PROVIDER`.
- La commande `.etatmediaia` affiche maintenant l'état détaillé des images, de la retouche image et de la vidéo.
- Le README et le guide d'installation ont été mis à jour pour la configuration hybride recommandée.

### Correctifs de finition — conversations et panneau

- La mention `✦ BY RHAFF SERVICE` est désormais réservée exclusivement à `.menu`.
- Les réponses IA et automatiques parlent naturellement à la place du propriétaire, sans nom de bot, en-tête ni signature, et évitent de répéter une salutation à chaque message.
- Ajout de barres de progression animées en pourcentage pour l’installation, la mise à jour et les principales opérations longues du panneau.
- Les réinstallations conservent une clé Gemini déjà configurée et utilisent `gemini-3.6-flash` pour le texte.
- Les anciennes variables de fournisseurs IA sont nettoyées lors de la configuration Gemini.


### Mise à jour V4 — assistant automatique et outils IA

- Ajout de `.assistantauto activer|desactiver|statut|consigne` pour répondre automatiquement aux messages privés entrants, avec limitation anti-boucle et sans envoi massif.
- Ajout des commandes IA sûres `.reponsepro`, `.ameliorerprompt` et `.ideescontenu`.
- Ajout des alias `.imagine` et `.geminiimage` pour la génération texte → image existante.
- Renforcement des consignes de l’assistant automatique : pas de démarchage, pas de spam, pas de relance répétitive et transfert vers un humain quand nécessaire.

## V4 - ajustements finaux du 16 août 2026

- Version affichée conservée à **4.0.0 / V4** : aucune multiplication de dossiers ou de numéros de version.
- Panneau VPS redimensionné avec en-tête symétrique et informations système alignées.
- Suppression des petites descriptions sous les rubriques du panneau.
- Les mentions du service de publication et du dépôt ne sont plus affichées dans le panneau utilisateur.
- Menu WhatsApp refondu façon Levanter : en-tête complet puis toutes les commandes actives classées par domaine, sans descriptions latérales.
- Signature **BY RHAFF SERVICE** conservée uniquement dans la commande `.menu`; les conversations et réponses automatiques restent naturelles et sans signature.
- Fournisseur IA unifié sur Gemini avec clé privée propre à chaque installation; les anciens réglages de fournisseurs sont nettoyés lors de la migration.

## V4 - révision finale — 2026-08-16

- Version publique maintenue sous **v4 / 4.0.0** pour éviter de multiplier les dossiers et archives de version sur le VPS.
- Panneau VPS restructuré : informations système alignées, titre du menu principal sans grand cadre, navigation compacte.
- Configuration Gemini depuis le panneau Bestla : chaque installation utilise sa propre clé privée stockée dans `.env`.
- Texte configuré sur `gemini-3.6-flash`; l’IA et les médias utilisent exclusivement la configuration Gemini de l’installation.
- Menus WhatsApp classés par domaines, `.menu tout` détaillé, pied de menu `BY RHAFF SERVICE`.
- Nettoyage ciblé des anciens fichiers Bestla sans toucher aux autres services du serveur.
- Désinstallation complète Bestla avec confirmation explicite.
- Installation GitHub et mises à jour conçues pour réutiliser **un seul dossier permanent** : `/root/bestla-ia/bestla-ia-bot`.

## 4.0.0 — 2026-08-15

- Refonte complète du panneau `bestla` : design RHAFF SERVICE, tableau système, menus numérotés et retour `[0]` dans chaque rubrique.
- Gestion professionnelle de plusieurs numéros WhatsApp : ajout guidé, choix QR/code de liaison, changement de mode, réinitialisation et retrait protégé.
- Ajout des sections VPS : contrôle du bot, propriétaires, automatisations, journaux, guide, sauvegardes et maintenance GitHub.
- Ajout des sauvegardes listables, restaurables et nettoyables avec confirmation explicite.
- Ajout de réglages pilotables sans `nano` : nom, signature, préfixe, mode, marquage lu, présence et rejet d'appels.
- Ajout du diagnostic système, de la vérification Git et de l'activation guidée du redémarrage PM2 après reboot.
- Installateurs rendus compatibles avec les gestionnaires de paquets apt, dnf, yum, apk, pacman, zypper et xbps.
- Mise à jour ZIP fiabilisée avec `rsync --delete` tout en conservant `.env`, `data/` et `.git`.

## 3.0.0 — 2026-08-15

- Passage de 98 à **134 commandes principales en français**.
- Nouveau panneau de contrôle VPS : `bestla`.
- Gestion guidée des sessions WhatsApp et des numéros propriétaires.
- Support d’un mode de connexion par session : QR ou code de liaison.
- Installation automatique Debian/Ubuntu : Node.js 22, FFmpeg, PM2, reboot automatique et commande `bestla`.
- Installation GitHub en une commande avec `install-github.sh`.
- Assistant IA optionnel : fournisseur Gemini ou OpenAI-compatible ; accès propriétaire par défaut.
- Ajout de météo, DNS, choix aléatoire et pile ou face.
- Ajout de demandes d’admission de groupe.
- Ajout de budget privé : revenus, dépenses, historique et suppression protégée.
- Ajout de jeux : morpion, nombre secret et quiz.
- Ajout de PDF texte et d’affiches image stylées.
- Ajout de conversions et effets audio, traitement vidéo et autocollant vidéo avec FFmpeg.
- Ajout de photo de profil, réaction et partage de contact WhatsApp.
- Ajout d’un workflow GitHub Actions de vérification.
- Mise à jour sécurisée depuis GitHub ou ZIP, avec sauvegarde de `.env` et `data/`.

## 2.1.0

- 98 commandes françaises, tickets, outils d’entreprise et automations.
