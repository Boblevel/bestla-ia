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
