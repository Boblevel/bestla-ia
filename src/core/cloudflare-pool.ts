/**
 * Endpoints Cloudflare Workers AI centraux de Bestla.
 * Aucun token Cloudflare n'est stocké dans le dépôt ou demandé aux installateurs.
 * Le second Worker sert automatiquement de secours si le premier est limité ou indisponible.
 */
export interface CentralCloudflareImageWorker {
  label: string
  url: string
}

export const CENTRAL_CLOUDFLARE_IMAGE_WORKERS: readonly CentralCloudflareImageWorker[] = [
  {
    label: 'principal',
    url: 'https://wild-wood-61a1.yokuuhgotedc.workers.dev',
  },
  {
    label: 'secours',
    url: 'https://withered-fog-53de.korzdudj-ac4.workers.dev',
  },
]
