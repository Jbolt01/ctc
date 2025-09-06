import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const jestBin = resolve(__dirname, 'node_modules', 'jest', 'bin', 'jest.js')
const args = ['--ci']

const child = spawn(process.execPath, [jestBin, ...args], { stdio: 'inherit' })
child.on('exit', (code) => process.exit(code ?? 1))

