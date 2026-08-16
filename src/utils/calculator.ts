const MAX_EXPRESSION_LENGTH = 160
const MAX_RESULT = 1_000_000_000_000_000

export class CalculationError extends Error {}

/**
 * Évalue une petite expression mathématique sans exécuter de JavaScript.
 * Les opérateurs disponibles sont +, -, ×, ÷, *, /, ^ et les parenthèses.
 */
export function calculateExpression(input: string): number {
  const source = input
    .replaceAll(',', '.')
    .replaceAll('×', '*')
    .replaceAll('x', '*')
    .replaceAll('X', '*')
    .replaceAll('÷', '/')
    .replace(/\s+/g, '')

  if (!source || source.length > MAX_EXPRESSION_LENGTH) {
    throw new CalculationError('Expression vide ou trop longue.')
  }

  let position = 0

  const ensureFinite = (value: number): number => {
    if (!Number.isFinite(value) || Math.abs(value) > MAX_RESULT) {
      throw new CalculationError('Résultat hors limite.')
    }
    return value
  }

  const consume = (character: string): boolean => {
    if (source[position] !== character) return false
    position += 1
    return true
  }

  const parseNumber = (): number => {
    const chunk = source.slice(position).match(/^(?:\d+(?:\.\d*)?|\.\d+)/)?.[0]
    if (!chunk) throw new CalculationError('Nombre attendu.')
    position += chunk.length
    return ensureFinite(Number(chunk))
  }

  const parseFactor = (): number => {
    if (consume('+')) return parseFactor()
    if (consume('-')) return ensureFinite(-parseFactor())
    if (consume('(')) {
      const value = parseExpression()
      if (!consume(')')) throw new CalculationError('Parenthèse fermante manquante.')
      return value
    }
    return parseNumber()
  }

  const parsePower = (): number => {
    const base = parseFactor()
    if (!consume('^')) return base
    const exponent = parsePower()
    return ensureFinite(base ** exponent)
  }

  const parseTerm = (): number => {
    let value = parsePower()
    while (true) {
      if (consume('*')) {
        value = ensureFinite(value * parsePower())
      } else if (consume('/')) {
        const divisor = parsePower()
        if (divisor === 0) throw new CalculationError('Division par zéro impossible.')
        value = ensureFinite(value / divisor)
      } else {
        return value
      }
    }
  }

  const parseExpression = (): number => {
    let value = parseTerm()
    while (true) {
      if (consume('+')) {
        value = ensureFinite(value + parseTerm())
      } else if (consume('-')) {
        value = ensureFinite(value - parseTerm())
      } else {
        return value
      }
    }
  }

  const result = parseExpression()
  if (position !== source.length) throw new CalculationError('Caractère non autorisé dans le calcul.')
  return result
}

export function formatCalculatedNumber(value: number): string {
  return new Intl.NumberFormat('fr-FR', {
    maximumFractionDigits: 10,
  }).format(value)
}
