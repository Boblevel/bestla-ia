/**
 * Petit générateur PDF texte autonome. Il évite une dépendance lourde pour que
 * la commande .creerpdf fonctionne juste après npm install.
 */
function latin1(text: string): Buffer {
  const normalized = Array.from(text)
    .map((character) => {
      const code = character.codePointAt(0) ?? 63
      return code >= 32 && code <= 255 ? character : character === '\n' ? '\n' : '?'
    })
    .join('')
  return Buffer.from(normalized, 'latin1')
}

function literal(text: string): Buffer {
  const escaped = text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
  return Buffer.concat([Buffer.from('(', 'ascii'), latin1(escaped), Buffer.from(')', 'ascii')])
}

function wrap(text: string, width: number): string[] {
  const lines: string[] = []
  for (const source of text.replace(/\r/g, '').split('\n')) {
    const words = source.trim().split(/\s+/).filter(Boolean)
    if (words.length === 0) {
      lines.push('')
      continue
    }
    let line = ''
    for (const word of words) {
      if (!line) {
        line = word
      } else if (line.length + word.length + 1 <= width) {
        line += ` ${word}`
      } else {
        lines.push(line)
        line = word
      }
    }
    if (line) lines.push(line)
  }
  return lines
}

function contentStream(lines: string[]): Buffer {
  const chunks: Buffer[] = [Buffer.from('BT\n/F1 11 Tf\n14 TL\n1 0 0 1 50 790 Tm\n', 'ascii')]
  lines.forEach((line, index) => {
    chunks.push(literal(line))
    chunks.push(Buffer.from(index === lines.length - 1 ? ' Tj\n' : ' Tj\nT*\n', 'ascii'))
  })
  chunks.push(Buffer.from('ET\n', 'ascii'))
  return Buffer.concat(chunks)
}

/** Crée un PDF A4 simple, adapté aux notes, devis courts et textes d’assistance. */
export function createTextPdf(title: string, body: string): Buffer {
  const date = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeStyle: 'short' }).format(new Date())
  const lines = [`${title.trim().slice(0, 100) || 'Document'}`, '', ...wrap(body.trim().slice(0, 12_000), 88), '', `Créé le ${date}`]
  const pages: string[][] = []
  for (let index = 0; index < lines.length; index += 48) pages.push(lines.slice(index, index + 48))
  if (pages.length === 0) pages.push(['Document'])

  const pageNumbers = pages.map((_, index) => 4 + index * 2)
  const objects: Buffer[] = []
  objects[1] = Buffer.from('<< /Type /Catalog /Pages 2 0 R >>', 'ascii')
  objects[2] = Buffer.from(`<< /Type /Pages /Kids [${pageNumbers.map((number) => `${number} 0 R`).join(' ')}] /Count ${pages.length} >>`, 'ascii')
  objects[3] = Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', 'ascii')

  pages.forEach((page, index) => {
    const pageNumber = pageNumbers[index] ?? 4
    const contentNumber = pageNumber + 1
    const stream = contentStream(page)
    objects[pageNumber] = Buffer.from(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentNumber} 0 R >>`,
      'ascii',
    )
    objects[contentNumber] = Buffer.concat([
      Buffer.from(`<< /Length ${stream.length} >>\nstream\n`, 'ascii'),
      stream,
      Buffer.from('endstream', 'ascii'),
    ])
  })

  const header = Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'binary')
  const chunks: Buffer[] = [header]
  const offsets: number[] = [0]
  let offset = header.length
  for (let index = 1; index < objects.length; index += 1) {
    const object = objects[index] ?? Buffer.alloc(0)
    offsets[index] = offset
    const serialized = Buffer.concat([Buffer.from(`${index} 0 obj\n`, 'ascii'), object, Buffer.from('\nendobj\n', 'ascii')])
    chunks.push(serialized)
    offset += serialized.length
  }
  const xrefOffset = offset
  chunks.push(Buffer.from(`xref\n0 ${objects.length}\n0000000000 65535 f \n`, 'ascii'))
  for (let index = 1; index < objects.length; index += 1) {
    chunks.push(Buffer.from(`${String(offsets[index] ?? 0).padStart(10, '0')} 00000 n \n`, 'ascii'))
  }
  chunks.push(Buffer.from(`trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`, 'ascii'))
  return Buffer.concat(chunks)
}
