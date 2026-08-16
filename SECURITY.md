# Sécurité

- Ne partage jamais `.env`, `data/` ou `data/sessions/`.
- Ne partage jamais `AI_API_KEY`, une archive créée par `bestla sauvegarde` ou un QR/code de liaison.
- Révoque immédiatement un appareil depuis WhatsApp si une session a été exposée.
- Utilise une clé API aléatoire et place l’API derrière HTTPS si elle est accessible depuis Internet.
- N’expose pas directement le port 3000 à tout Internet sans pare-feu ou reverse proxy.
- Laisse `AI_PUBLIC=false` tant que tu ne souhaites pas faire payer ou limiter l’accès à ton fournisseur IA.
- Vérifie chaque plugin personnalisé : un plugin possède les mêmes droits que le bot.
- Mets régulièrement à jour les dépendances et relance les tests avant le déploiement.

Ce projet ne contient pas de télémétrie et n’exporte pas les identifiants de session.
