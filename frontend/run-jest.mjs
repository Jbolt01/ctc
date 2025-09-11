import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const jestBin = resolve(__dirname, 'node_modules', 'jest', 'bin', 'jest.js')
// Forward CLI args (after the `--`) to Jest; also add CI-friendly defaults
const forwarded = process.argv.slice(2).filter((a) => a !== '--')
const base = ['--ci', '--runInBand', '--forceExit', '--colors']
const args = [...base, ...forwarded]

const child = spawn(process.execPath, [jestBin, ...args], { stdio: 'inherit' })
child.on('exit', (code) => process.exit(code ?? 1))
child.on('close', (code) => process.exit(code ?? 1))
process.on('SIGINT', () => child.kill('SIGINT'))
process.on('SIGTERM', () => child.kill('SIGTERM'))

// Optional hard timeout for flaky tests (in ms)
const maxMs = Number(process.env.JEST_MAX_MS || '0')
if (maxMs > 0) {
  const timer = setTimeout(() => {
    console.error(`\nJest hard timeout reached after ${maxMs} ms; terminating...`)
    try { child.kill('SIGKILL') } catch {}
    // Exit with the same code as typical timeout tools
    process.exit(124)
  }, maxMs)
  // Do not keep process alive because of this timer; it just enforces an upper bound
  timer.unref?.()
}
