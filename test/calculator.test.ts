import assert from 'node:assert/strict'
import test from 'node:test'
import { CalculationError, calculateExpression } from '../src/utils/calculator.js'
import { ConversionError, convertUnit } from '../src/utils/converter.js'

test('calcule une expression sans eval avec les priorités', () => {
  assert.equal(calculateExpression('2 + 3 × (4 - 1)'), 11)
  assert.equal(calculateExpression('2^3^2'), 512)
  assert.equal(calculateExpression('-5 + 12 / 3'), -1)
})

test('refuse les expressions dangereuses ou invalides', () => {
  assert.throws(() => calculateExpression('process.exit()'), CalculationError)
  assert.throws(() => calculateExpression('1 / 0'), CalculationError)
})

test('convertit les unités et refuse les familles incompatibles', () => {
  assert.equal(convertUnit(2, 'km', 'm').value, 2_000)
  assert.equal(Math.round(convertUnit(0, 'c', 'f').value), 32)
  assert.throws(() => convertUnit(1, 'kg', 'm'), ConversionError)
})
