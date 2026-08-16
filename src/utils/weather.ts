export interface WeatherSnapshot {
  location: string
  country: string
  timezone: string
  temperature: number
  apparentTemperature: number
  humidity: number
  windSpeed: number
  precipitation: number
  condition: string
  min: number | null
  max: number | null
  rainProbability: number | null
}

type JsonObject = Record<string, unknown>

function asObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : {}
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

async function fetchJson(url: string): Promise<JsonObject> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(20_000),
    headers: { 'user-agent': 'Bestla-iA/3.0 (weather)' },
  })
  if (!response.ok) throw new Error(`Le service météo répond HTTP ${response.status}.`)
  const payload = await response.json().catch(() => ({}))
  return asObject(payload)
}

function conditionFromCode(code: number | null): string {
  const labels: Record<number, string> = {
    0: 'ciel dégagé',
    1: 'peu nuageux',
    2: 'partiellement nuageux',
    3: 'couvert',
    45: 'brouillard',
    48: 'brouillard givrant',
    51: 'bruine faible',
    53: 'bruine modérée',
    55: 'bruine forte',
    61: 'pluie faible',
    63: 'pluie modérée',
    65: 'forte pluie',
    71: 'neige faible',
    73: 'neige modérée',
    75: 'forte neige',
    80: 'averses faibles',
    81: 'averses modérées',
    82: 'fortes averses',
    95: 'orage',
    96: 'orage avec grêle légère',
    99: 'orage avec forte grêle',
  }
  return code !== null ? (labels[code] ?? 'conditions variables') : 'conditions indisponibles'
}

/** Interroge uniquement les points de terminaison publics connus d’Open-Meteo. */
export async function getWeather(place: string): Promise<WeatherSnapshot> {
  const query = place.trim().slice(0, 120)
  if (!query) throw new Error('Indique une ville ou une localité.')

  const geocoding = await fetchJson(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1&language=fr&format=json`,
  )
  const first = Array.isArray(geocoding.results) ? asObject(geocoding.results[0]) : {}
  const latitude = numberValue(first.latitude)
  const longitude = numberValue(first.longitude)
  if (latitude === null || longitude === null) throw new Error('Lieu introuvable. Essaie avec une ville et un pays, par exemple « Bobo-Dioulasso Burkina Faso ».')

  const forecast = await fetchJson(
    `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&forecast_days=1&timezone=auto`,
  )
  const current = asObject(forecast.current)
  const daily = asObject(forecast.daily)
  const firstDaily = (key: string): number | null => {
    const values = daily[key]
    return Array.isArray(values) ? numberValue(values[0]) : null
  }

  return {
    location: textValue(first.name) || query,
    country: textValue(first.country),
    timezone: textValue(forecast.timezone) || 'locale',
    temperature: numberValue(current.temperature_2m) ?? 0,
    apparentTemperature: numberValue(current.apparent_temperature) ?? 0,
    humidity: numberValue(current.relative_humidity_2m) ?? 0,
    windSpeed: numberValue(current.wind_speed_10m) ?? 0,
    precipitation: numberValue(current.precipitation) ?? 0,
    condition: conditionFromCode(numberValue(current.weather_code)),
    min: firstDaily('temperature_2m_min'),
    max: firstDaily('temperature_2m_max'),
    rainProbability: firstDaily('precipitation_probability_max'),
  }
}
