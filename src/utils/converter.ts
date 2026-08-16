export class ConversionError extends Error {}

interface UnitDefinition {
  family: 'longueur' | 'masse' | 'volume'
  factor: number
  label: string
}

const UNITS: Record<string, UnitDefinition> = {
  km: { family: 'longueur', factor: 1_000, label: 'km' },
  kilometre: { family: 'longueur', factor: 1_000, label: 'km' },
  kilometres: { family: 'longueur', factor: 1_000, label: 'km' },
  m: { family: 'longueur', factor: 1, label: 'm' },
  metre: { family: 'longueur', factor: 1, label: 'm' },
  metres: { family: 'longueur', factor: 1, label: 'm' },
  cm: { family: 'longueur', factor: 0.01, label: 'cm' },
  mm: { family: 'longueur', factor: 0.001, label: 'mm' },
  mi: { family: 'longueur', factor: 1_609.344, label: 'mi' },
  mile: { family: 'longueur', factor: 1_609.344, label: 'mi' },
  miles: { family: 'longueur', factor: 1_609.344, label: 'mi' },
  ft: { family: 'longueur', factor: 0.3048, label: 'ft' },
  pied: { family: 'longueur', factor: 0.3048, label: 'ft' },
  pieds: { family: 'longueur', factor: 0.3048, label: 'ft' },
  kg: { family: 'masse', factor: 1, label: 'kg' },
  kilogramme: { family: 'masse', factor: 1, label: 'kg' },
  kilogrammes: { family: 'masse', factor: 1, label: 'kg' },
  g: { family: 'masse', factor: 0.001, label: 'g' },
  gramme: { family: 'masse', factor: 0.001, label: 'g' },
  grammes: { family: 'masse', factor: 0.001, label: 'g' },
  lb: { family: 'masse', factor: 0.45359237, label: 'lb' },
  livre: { family: 'masse', factor: 0.45359237, label: 'lb' },
  livres: { family: 'masse', factor: 0.45359237, label: 'lb' },
  l: { family: 'volume', factor: 1, label: 'L' },
  litre: { family: 'volume', factor: 1, label: 'L' },
  litres: { family: 'volume', factor: 1, label: 'L' },
  ml: { family: 'volume', factor: 0.001, label: 'mL' },
  gal: { family: 'volume', factor: 3.785411784, label: 'gal US' },
}

function normalizeUnit(value: string): string {
  return value.trim().toLowerCase().replaceAll('é', 'e').replaceAll('è', 'e').replaceAll('ê', 'e')
}

export interface ConversionResult {
  value: number
  from: string
  to: string
}

export function convertUnit(value: number, fromRaw: string, toRaw: string): ConversionResult {
  if (!Number.isFinite(value) || Math.abs(value) > 1_000_000_000_000) {
    throw new ConversionError('Valeur invalide ou trop grande.')
  }

  const fromKey = normalizeUnit(fromRaw)
  const toKey = normalizeUnit(toRaw)

  if (['c', 'celsius', '°c'].includes(fromKey) || ['f', 'fahrenheit', '°f'].includes(fromKey)) {
    const fromCelsius = ['c', 'celsius', '°c'].includes(fromKey)
    const toCelsius = ['c', 'celsius', '°c'].includes(toKey)
    const toFahrenheit = ['f', 'fahrenheit', '°f'].includes(toKey)
    if (!toCelsius && !toFahrenheit) throw new ConversionError('La température se convertit seulement entre C et F.')
    return {
      value: fromCelsius ? (toCelsius ? value : value * 9 / 5 + 32) : toCelsius ? (value - 32) * 5 / 9 : value,
      from: fromCelsius ? '°C' : '°F',
      to: toCelsius ? '°C' : '°F',
    }
  }

  const from = UNITS[fromKey]
  const to = UNITS[toKey]
  if (!from || !to) {
    throw new ConversionError('Unité inconnue. Essaie km, m, cm, mi, kg, g, lb, L, mL, gal, C ou F.')
  }
  if (from.family !== to.family) throw new ConversionError('Les unités doivent être de la même famille.')
  return { value: value * from.factor / to.factor, from: from.label, to: to.label }
}
