import assert from 'node:assert/strict'
import test from 'node:test'
import { createTextPdf } from '../src/utils/simple-pdf.js'

test('crée un PDF texte valide et paginé', () => {
  const document = createTextPdf('Test Bestla', 'Bonjour '.repeat(2_000))
  assert.ok(document.subarray(0, 8).toString('ascii').startsWith('%PDF-1.4'))
  assert.ok(document.toString('latin1').includes('%%EOF'))
  assert.ok(document.length > 1_000)
})
