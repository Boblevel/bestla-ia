# Bestla iA

Bot WhatsApp français multi-compte créé pour **RHAFF SERVICE**.

Bestla iA v4 rassemble **146 commandes WhatsApp françaises** : gestion de groupes, automatisation commerciale, tickets clients, budget privé, assistant IA optionnel, images, audio, vidéo, documents PDF, jeux et un panneau de contrôle VPS professionnel.

> Bestla iA utilise Baileys, une connexion WhatsApp Web non officielle. Utilise uniquement les comptes que tu contrôles, respecte les règles de WhatsApp et n’envoie jamais de messages non sollicités.


## Assistant IA automatique et commandes IA sûres

Bestla V4 inclut un assistant automatique pour les conversations privées entrantes. Il ne prospecte pas, n’envoie pas de messages en masse et n’intervient pas automatiquement dans les groupes.

```text
.assistantauto activer
.assistantauto desactiver
.assistantauto statut
.assistantauto consigne Réponds poliment, brièvement et professionnellement.
.imagine Une boutique premium blanche et or, lumière cinématique
.reponsepro <message client>
.ameliorerprompt <idée visuelle>
.ideescontenu <sujet>
```

L’assistant automatique applique un délai minimum entre deux réponses automatiques d’un même contact afin d’éviter les boucles et comportements agressifs.

## Ce que cette version apporte

- un panneau VPS interactif au style RHAFF SERVICE : tape simplement `bestla` ;
- des sous-menus numérotés avec `[0] Retour` dans chaque section ;
- démarrage automatique après un reboot grâce à PM2 ;
- ajout, mode de liaison, réinitialisation et retrait guidés de comptes WhatsApp, sans ouvrir `nano` ;
- ajout et retrait de numéros propriétaires ;
- QR ou code de liaison pour chaque session séparément ;
- 146 commandes WhatsApp en français ;
- réaction `⏳` pendant l’exécution d’une commande, puis `✅` ou `❌` ;
- activation/désactivation individuelle des commandes par le propriétaire ;
- IA automatique via Pollinations (texte, image, retouche et vidéo), avec Gemini manuel en option ;
- service client IA automatique, privé, poli et configurable ;
- catalogue et livraison contrôlée de produits digitaux ;
- assistant IA configurable, privé par défaut ;
- météo, DNS, budget, PDF, affiches texte, jeux ;
- audio et vidéo traités localement avec FFmpeg ;
- sauvegardes privées, restauration contrôlée et nettoyage des anciennes archives ;
- installateurs Linux multi-distributions et contrôle GitHub.

Les récupérateurs TikTok, Instagram, Spotify, Facebook et autres plateformes ne sont volontairement pas inclus : ils sont instables, peuvent enfreindre les conditions des plateformes et exposent le numéro WhatsApp. Bestla traite les médias que tu envoies directement au bot.

## Installation en une commande depuis GitHub

Après avoir créé ton dépôt GitHub (la dernière partie de ce guide explique comment), une personne pourra installer Bestla iA avec une seule commande :

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/UTILISATEUR_GITHUB/DEPOT_GITHUB/main/install-github.sh) --repo https://github.com/UTILISATEUR_GITHUB/DEPOT_GITHUB.git
```

Le script installe automatiquement Node.js 22, FFmpeg, Git, les dépendances du bot, PM2, le démarrage après reboot et la commande `bestla`. Il demande le numéro WhatsApp propriétaire, le mode de liaison (`qr` ou `pairing`), puis propose l’autorisation IA automatique. Pour cette dernière, aucune clé n’est à copier : Bestla affiche un code Pollinations à valider dans le navigateur.

Les distributions Linux reconnues sont Debian/Ubuntu, Fedora/RHEL/Rocky/Alma, Alpine, Arch/Manjaro, openSUSE et Void Linux. Il faut un serveur Linux maintenu, avec accès `root` ou `sudo`. Un conteneur sans systemd/OpenRC doit aussi avoir une politique de redémarrage configurée chez son hébergeur.

La liaison WhatsApp ne peut pas être automatisée : WhatsApp demande toujours de scanner le QR ou de saisir le code de liaison depuis le téléphone concerné.

## Installation depuis une archive ZIP

Dans le terminal du VPS :

```bash
cd /root
unzip -o bestla-ia-bot-v4.zip -d /root/bestla-install
cd /root/bestla-install/bestla-ia-bot
bash installer-vps.sh
```

À la première installation, réponds au numéro WhatsApp international sans `+`, espace ou tiret. Exemple Burkina Faso : `22670000000`.

## Connecter WhatsApp

Après l’installation :

Bestla utilise toujours le même dossier permanent : `/root/bestla-ia/bestla-ia-bot`. Les mises à jour ne créent plus de dossier `v4.1`, `v4.2`, etc. Un rollback unique caché peut être conservé sans accumulation.

```bash
bestla logs live
```

Selon ton choix :

- `qr` : WhatsApp → **Appareils connectés** → **Connecter un appareil** → scanne le QR ;
- `pairing` : WhatsApp → **Appareils connectés** → **Connecter un appareil** → **Lier avec un numéro de téléphone** → saisis le code affiché.

Quand la session est connectée, arrête les journaux avec `Ctrl+C`. Le bot continue à tourner en arrière-plan.

## Panneau de contrôle VPS

Tape simplement :

```bash
bestla
```

Tu obtiens un panneau interactif professionnel, dans le style RHAFF SERVICE. Chaque rubrique possède `[0] Retour au menu principal`. Les mêmes actions peuvent aussi être utilisées directement :

| Action | Commande |
|---|---|
| Voir l’état du bot | `bestla statut` |
| Démarrer | `bestla demarrer` |
| Arrêter | `bestla stopper` |
| Redémarrer | `bestla redemarrer` |
| Voir les journaux | `bestla logs` |
| Voir QR/code en direct | `bestla logs live` |
| Voir les sessions | `bestla sessions` |
| Ajouter un compte | `bestla sessions ajouter boutique 22670000000 pairing` |
| Changer QR/code d'une session | `bestla sessions mode boutique qr` |
| Refaire une liaison | `bestla sessions reinitialiser boutique confirmer` |
| Retirer un compte | `bestla sessions retirer boutique confirmer` |
| Voir les propriétaires | `bestla proprietaires liste` |
| Ajouter un propriétaire | `bestla proprietaires ajouter 22670000000` |
| Retirer un propriétaire | `bestla proprietaires retirer 22670000000 confirmer` |
| Modifier le préfixe | `bestla configuration prefixe .` |
| Passer en privé | `bestla configuration mode prive` |
| Changer la signature | `bestla configuration signature RHAFF SERVICE` |
| Voir les programmes actifs | `bestla programmes` |
| Sauvegarder les réglages/sessions | `bestla sauvegarde` |
| Voir/restaurer les sauvegardes | `bestla sauvegardes liste` |
| Vérifier l’installation | `bestla diagnostic` |
| Activer le reboot automatique | `bestla demarrageauto` |
| Mettre à jour depuis GitHub | `bestla miseajour confirmer` |

Le retrait ou la réinitialisation d’une session ne supprime pas immédiatement ses clés WhatsApp : elles sont déplacées dans `data/sessions-retirees/` afin de pouvoir les récupérer au besoin.

### Ajouter plusieurs numéros depuis le panneau

```text
bestla
→ 1  Gestion des numéros WhatsApp
→ 1  Ajouter un numéro WhatsApp
```

Le panneau demande le nom de la session (par exemple `boutique`), le numéro international et le choix QR ou code de liaison. Le bot redémarre sans interrompre durablement les autres sessions, puis les journaux affichent la liaison à faire.

## Utiliser le bot dans WhatsApp

Le préfixe par défaut est `.`. Commence par :

```text
.info
.menu
.menu ia
.menu groupe
.menu nom_commande
```

`.menu` affiche maintenant un panneau inspiré de la présentation Levanter : en-tête compact (préfixe, utilisateur, session, heure, date, version, RAM, uptime, plateforme), puis toutes les commandes actives classées par domaine, sans descriptions à côté. `.menu categorie` affiche uniquement le domaine choisi et `.menu nom_commande` ouvre la fiche détaillée. Le propriétaire peut désactiver/réactiver une commande avec `.commande desactiver NOM` et `.commande activer NOM`.

### Général — 14 commandes

`.menu`, `.latence`, `.duree`, `.info`, `.proprietaire`, `.identifiant`, `.heure`, `.calculer`, `.convertir`, `.motdepasse`, `.meteo`, `.domaine`, `.choisir`, `.pileouface`

Exemples :

```text
.calculer (25 + 5) × 2
.convertir 10 km mi
.meteo Ouagadougou
.choisir rouge | bleu | vert
```

### IA — 6 commandes

`.assistant`, `.traduire`, `.resumer`, `.corrigertexte`, `.reformuler`, `.etatia`

Par sécurité, l’IA reste réservée au propriétaire par défaut. La méthode recommandée ne demande pas de copier une clé :

```bash
bestla configuration apiauto
```

Bestla affiche une adresse Pollinations et un code temporaire. Après validation dans le navigateur, le VPS reçoit le jeton officiel et tente de créer automatiquement une clé Bestla dédiée valable jusqu’à 365 jours, limitée aux modèles utilisés. Le secret final est stocké uniquement dans `.env`.

```text
.assistant Explique-moi simplement la différence entre un site web et une application.
.traduire anglais | Bonjour, nous vous répondrons bientôt.
.resumer Texte très long…
.corrigertexte Je veux que tu corriges ce message.
```

#### Médias IA et service client IA

Configuration automatique recommandée :

```env
AI_PROVIDER=openai-compatible
AI_MODEL=openai-fast
AI_BASE_URL=https://gen.pollinations.ai/v1
POLLINATIONS_API_KEY=<stockée automatiquement>
MEDIA_AI_PROVIDER=pollinations
MEDIA_AI_ENABLED=true
MEDIA_AI_PUBLIC=false
MEDIA_AI_IMAGE_MODEL=flux
MEDIA_AI_IMAGE_EDIT_MODEL=kontext
MEDIA_AI_VIDEO_MODEL=wan-fast
MEDIA_AI_VIDEO_ASPECT_RATIO=9:16
COMMAND_REACTIONS=true
```

La clé elle-même n’est jamais incluse dans le dépôt ou le ZIP. Pollinations fournit le device-flow officiel : l’utilisateur autorise son propre compte, puis Bestla récupère le jeton serveur automatiquement. Si le compte autorise la gestion des clés, Bestla crée ensuite une clé enfant dédiée pouvant durer jusqu’à 365 jours ; sinon il conserve le jeton autorisé. Les modèles texte à accès gratuit existent, tandis que certains modèles d’image/retouche/vidéo consomment des crédits Pollen. Si le compte média n’a plus de crédit, Bestla tente automatiquement le point d’accès image anonyme historique de Pollinations pour la génération d’images. Pour une génération vidéo sans crédit, Bestla peut créer un clip de secours de 5 secondes localement avec FFmpeg à partir d’une image générée ou fournie. Les retouches sémantiques avancées restent dépendantes d’un fournisseur qui accepte la requête.

```text
.genererimage Une boutique moderne blanche et or
.modifierimage Remplace le fond par un studio premium
.generervideo Plan cinématique vertical d’une boutique moderne
.animerimage La caméra avance lentement et les mouvements restent naturels
.modifiervideo Garde le sujet et rends l’éclairage plus cinématique
.etatmediaia
```

Avec Pollinations, `.modifiervideo` recrée une nouvelle séquence guidée par la première image de la vidéo source et la consigne demandée. Pour une retouche vidéo native image-par-image, le mode Gemini manuel reste disponible si le compte utilisé le permet.

Le service client IA utilise automatiquement le même fournisseur texte :

```text
.serviceclientia activer
.serviceclientia statut
.serviceclientia consigne Réponds de façon professionnelle, polie, précise et concise.
.serviceclientia desactiver
```

### Groupe — 21 commandes

`.expulser`, `.promouvoir`, `.retrograder`, `.ajouter`, `.mentionnertous`, `.ouvrir`, `.fermer`, `.nomgroupe`, `.descriptiongroupe`, `.invitation`, `.revoquerlien`, `.administrateurs`, `.infosgroupe`, `.membres`, `.reglement`, `.messagesdisparition`, `.validationentree`, `.demandesadmission`, `.ajoutmembres`, `.verrouillerinfos`, `.deverrouillerinfos`

Les actions sensibles demandent que Bestla soit administrateur du groupe.

```text
.reglement definir Respect obligatoire. Pas de liens non autorisés.
.validationentree activer
.demandesadmission liste
.demandesadmission accepter @personne
```

### Modération — 18 commandes

`.antilien`, `.antispam`, `.bienvenue`, `.aurevoir`, `.protection`, `.reglages`, `.motinterdit`, `.domainesautorises`, `.messagebienvenue`, `.messagedepart`, `.avertir`, `.retireravertissement`, `.avertissements`, `.effaceravertissements`, `.verifierlien`, `.effacermessage`, `.listeavertissements`, `.verifiermembre`

```text
.protection activer
.motinterdit ajouter insulte
.domainesautorises ajouter youtube.com
.messagebienvenue definir Bienvenue {nom} dans {groupe} !
```

### Images — 15 commandes

`.autocollant`, `.image`, `.infomedia`, `.codeqr`, `.compresserimage`, `.redimensionner`, `.noiretblanc`, `.tournerimage`, `.flouimage`, `.filigrane`, `.recadrerimage`, `.infosimage`, `.amelioreimage`, `.genererimage`, `.modifierimage`

Réponds à l’image avec la commande, ou envoie l’image avec la commande en légende.

```text
.filigrane RHAFF SERVICE
.recadrerimage carre
.amelioreimage
```

### Audio et vidéo — 11 commandes

`.convertiraudio`, `.effetaudio`, `.couperaudio`, `.extraireaudio`, `.compresservideo`, `.tournervideo`, `.coupervideo`, `.autocollantvideo`, `.generervideo`, `.animerimage`, `.modifiervideo`

```text
.convertiraudio
.effetaudio robot
.couperaudio 10 30
.coupervideo 5 20
.autocollantvideo
```

FFmpeg est installé automatiquement par `installer-vps.sh`. Les vidéos très longues ou trop lourdes sont refusées pour protéger le VPS.

### Documents et création — 3 commandes

`.creerpdf`, `.texteimage`, `.mediaserveur`

```text
.creerpdf Mon devis | Bonjour, voici le détail de votre devis…
.texteimage neon | Bienvenue chez RHAFF SERVICE
```

### Automatisation — 18 commandes

`.autoreponse`, `.absence`, `.horaires`, `.reactionauto`, `.programmer`, `.programmes`, `.annulerprogramme`, `.faq`, `.note`, `.raccourci`, `.annonce`, `.sondage`, `.serviceclientia`, `.etatautomatisation`, `.ticket`, `.tickets`, `.repondreticket`, `.prioriteticket`

```text
.autoreponse ajouter prive bonjour | Bonjour, comment pouvons-nous vous aider ?
.autoreponse activer
.absence activer Nous vous répondrons bientôt.
.programmer quotidien 08:00 | Bonjour à toute l’équipe
.ticket ouvrir Je souhaite un devis
```

Les programmes sont liés au chat où ils sont créés. Cela évite les envois involontaires vers un autre contact.

### Budget privé — 6 commandes

`.revenu`, `.depense`, `.budget`, `.historiquebudget`, `.supprimerbudget`, `.effacerbudget`

Elles fonctionnent seulement dans le chat privé du propriétaire.

```text
.revenu 5000 | Vente | Client site web
.depense 1200 | Internet | Forfait data
.budget
.historiquebudget
```

### Entreprise — 12 commandes

`.entreprise`, `.services`, `.tarifs`, `.contact`, `.adresse`, `.paiement`, `.livraison`, `.reseaux`, `.catalogue`, `.conditions`, `.produitsdigitaux`, `.acheterdigital`

```text
.entreprise definir RHAFF SERVICE accompagne ses clients dans leurs projets numériques.
.services definir Automatisation - Assistance - Développement
.contact definir WhatsApp : +226 XX XX XX XX
```

Produits digitaux :

```text
.produitdigital ajouter pack1 | Pack Premium | Description publique | Lien/code/texte privé de livraison
.produitdigital liste
.produitdigital desactiver pack1
.produitdigital activer pack1
.produitsdigitaux
.acheterdigital pack1
.livrerdigital pack1 22670000000
```

La commande `.acheterdigital` crée une demande/ticket ; la livraison privée n’est envoyée qu’après l’action explicite du propriétaire avec `.livrerdigital`.

### Jeux — 4 commandes

`.morpion`, `.devinenombre`, `.quiz`, `.arreterjeu`

```text
.morpion creer @personne
.morpion jouer 5
.devinenombre debut
.quiz
```

### WhatsApp — 4 commandes

`.reaction`, `.photoprofil`, `.envoyercontact`, `.liremessage`

```text
.reaction ❤️
.photoprofil @personne
.envoyercontact 22670000000 | RHAFF SERVICE
```

### Propriétaire — 14 commandes

`.mode`, `.prefixe`, `.commande`, `.quitter`, `.sauvegarde`, `.nettoyerprogrammes`, `.etatserveur`, `.redemarrerbot`, `.bloquercontact`, `.debloquercontact`, `.listeblocages`, `.etatmediaia`, `.produitdigital`, `.livrerdigital`

## Configurer l’assistant IA

### Méthode recommandée - automatique

```bash
bestla configuration apiauto
```

Aucune clé publique n’est recherchée ni copiée depuis Internet. Bestla utilise le device-flow officiel Pollinations : ouvre l’adresse affichée, saisis le code, autorise l’accès, puis le VPS reçoit et enregistre la clé automatiquement.

### Gemini manuel - optionnel

Si tu possèdes déjà une clé Gemini légitime :

```bash
bestla configuration apigemini TA_CLE_GEMINI
```

La clé est stockée dans `.env` avec des permissions privées et n’est jamais affichée en clair dans le panneau.


## Plusieurs comptes WhatsApp

Chaque compte est une session distincte. Exemple :

```bash
bestla sessions ajouter boutique 22671111111 pairing
bestla logs live
```

Le bot affiche alors le code de liaison du compte `boutique`. Le compte principal `main` continue de fonctionner pendant cette opération.

## Mise à jour

### Depuis GitHub

```bash
bestla miseajour confirmer
```

Le panneau refuse une mise à jour si le dépôt contient des modifications locales, afin de ne rien écraser accidentellement.

### Depuis une archive ZIP

Le script `mettre-a-jour-vps.sh` conserve `.env` et `data/`, puis crée une sauvegarde avant de mettre le code à jour :

```bash
cd /root/bestla-update-v4/bestla-ia-bot
bash mettre-a-jour-vps.sh /root/bestla-ia/bestla-ia-bot
```

## Créer une archive de version

Dans le dossier du projet :

```bash
npm run release
```

L’archive est créée dans `releases/` sans `.env`, sans sessions WhatsApp, sans `data/` et sans `node_modules/`.

## Structure importante

```text
bestla-ia-bot/
├── .env                 # privé, jamais sur GitHub
├── data/                # privé : base et sessions WhatsApp
├── src/                 # code du bot et panneau bestla
├── installer-vps.sh     # installation complète sur VPS
├── install-github.sh    # installation en une commande depuis GitHub
├── mettre-a-jour-vps.sh # mise à jour depuis ZIP
└── scripts/creer-release.sh
```

## Sécurité

- garde au moins un numéro dans `OWNER_NUMBERS` ;
- active `AI_PUBLIC=true` seulement si tu acceptes que les utilisateurs consomment ton crédit IA ;
- ne partage jamais `.env`, `data/`, une archive de sauvegarde ou un QR de liaison ;
- limite l’API HTTP ou désactive-la si tu ne l’utilises pas ;
- garde le bot administrateur seulement dans les groupes où il doit modérer ;
- utilise les automatismes pour des clients ou membres consentants, jamais pour le spam.

Le manuel PDF de la version est livré séparément de l’archive afin de conserver le ZIP d’installation léger ; il détaille les commandes et les procédures de dépannage.

## Nettoyage et désinstallation

```bash
bestla nettoyer confirmer
bestla desinstaller confirmer
```

Le nettoyage cible seulement les anciens ZIP, dossiers de test et sauvegardes de migration Bestla. La désinstallation retire le processus PM2 Bestla, le raccourci `/usr/local/bin/bestla` et le dossier Bestla, sans supprimer Node.js, PM2, FFmpeg ni les autres applications du VPS.
