/**
 * Compatibilité historique uniquement.
 *
 * Aucune clé Gemini n'est intégrée au code. Chaque installation configure sa
 * propre clé depuis le panneau `bestla` ; elle reste dans le fichier .env privé
 * du VPS.
 */
export function embeddedGeminiApiKey(): string {
  return ''
}
