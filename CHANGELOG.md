# Journal des changements

### Pool Cloudflare central de test + secours vidéo — 16 août 2026

- Deux comptes Workers AI centraux préconfigurés pour les tests, sans saisie Cloudflare sur le VPS des installateurs.
- Bascule automatique du compte principal vers le compte de secours sur quota, 429, erreurs d'authentification temporaires ou indisponibilité serveur.
- Temporisation automatique d'un compte après quota/erreur pour éviter de le solliciter en boucle.
- `.genererimage` utilise `@cf/black-forest-labs/flux-1-schnell`.
- `.generervideo` conserve Gemini lorsqu'il est disponible et rétablit le comportement fiable de l'ancienne version : courte vidéo locale de 5 secondes depuis une image si Gemini échoue ou n'est pas configuré.
- `.animerimage` bénéficie du même secours local.
- Les médias IA sont activés automatiquement lors de l'installation/mise à jour.
- Cette configuration centrale contient des identifiants temporaires destinés aux tests et devra être remplacée après révocation.

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
