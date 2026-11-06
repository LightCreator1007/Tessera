// Builds JSON and typed TypeScript ABIs from the compiled contract interfaces.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const pkg = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(pkg, '..', '..', 'contracts', 'out')
const outputs = new Map()
let ts = '// Generated from compiled contract interfaces. Do not edit.\n'
for (const name of ['IJobMarket', 'INodeRegistry', 'ToDToken', 'ToDFaucet', 'ToDTestExchange', 'Competitions']) {
  const { abi } = JSON.parse(readFileSync(join(out, `${name}.sol`, `${name}.json`), 'utf8'))
  const json = JSON.stringify(abi, null, 2)
  outputs.set(join(pkg, 'json', `${name}.json`), json + '\n')
  ts += `\nexport const ${name[0].toLowerCase() + name.slice(1)}Abi = ${json} as const\n`
}
outputs.set(join(pkg, 'src', 'generated.ts'), ts)

if (process.argv.includes('--check')) {
  const stale = [...outputs].filter(([path, content]) => !existsSync(path) || readFileSync(path, 'utf8') !== content)
  if (stale.length) {
    console.error('ABI outputs are missing or stale. Run the generate command.')
    process.exit(1)
  }
  console.log('ABI outputs match the compiled interfaces')
} else {
  for (const [path, content] of outputs) {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content)
  }
  console.log('Wrote registry, market, token, faucet, test exchange and competitions ABIs')
}
