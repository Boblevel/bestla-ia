import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function runCli(argumentsList: string[], input?: string) {
  return spawnSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', ...argumentsList], {
    cwd: projectDirectory,
    encoding: 'utf8',
    input,
    env: {
      ...process.env,
      NO_COLOR: '1',
      BESTLA_NO_CLEAR: '1',
    },
  })
}

test('le panneau VPS présente les sections professionnelles et peut être quitté', async () => {
  const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/cli.ts'], {
      cwd: projectDirectory,
      env: { ...process.env, NO_COLOR: '1', BESTLA_NO_CLEAR: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
    child.once('error', reject)
    child.once('close', (code) => resolve({ code, stdout, stderr }))
    setTimeout(() => child.stdin.end('0\n'), 180)
  })
  assert.equal(result.code, 0, result.stderr)
  assert.match(result.stdout, /NUMÉROS WHATSAPP/)
  assert.match(result.stdout, /QUITTER/)
  assert.match(result.stdout, /MAINTENANCE & SYSTÈME/)
  assert.doesNotMatch(result.stdout, /Navigation propre/)
  assert.doesNotMatch(result.stdout, /GITHUB|GitHub|dépôt Git/)
})

test('la commande aide ne demande pas de fichier .env', () => {
  const result = runCli(['aide'])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /COMMANDES VPS/)
  assert.match(result.stdout, /bestla desinstaller confirmer/)
})
