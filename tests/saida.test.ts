import { expect, test } from 'claude-code/testing'

import { comprimir } from '../hooks/saida'

test('comprimir tira cores, barra de progresso e junta linhas repetidas', () => {
  const texto = '\x1b[32mok\x1b[0m\nbaixando 10%\rbaixando 100%\nigual\nigual\nigual\nigual\n\n\n\nfim\n'
  const saida = comprimir(texto)
  expect(saida).toBe('ok\nbaixando 100%\nigual  [repetida 4x]\n\nfim\n')
})

test('comprimir deixa saída curta e limpa exatamente como veio', () => {
  const texto = 'a\nb\nc\n'
  expect(comprimir(texto)).toBe(texto)
})

test('comprimir guarda começo e fim de uma saída longa e avisa o que omitiu', () => {
  const texto = Array.from({ length: 1000 }, (_, i) => `linha ${i}`).join('\n')
  const saida = comprimir(texto)
  expect(saida).toContain('linha 0')
  expect(saida).toContain('linha 999')
  expect(saida).not.toContain('linha 500')
  expect(saida).toContain('omitidas pela orquestra')
  expect(saida.split('\n').length).toBeLessThan(160)
})

test('comprimir corta uma linha gigante por caracteres', () => {
  const saida = comprimir('x'.repeat(50_000))
  expect(saida.length).toBeLessThan(10_200)
  expect(saida).toContain('caracteres omitidas')
})

test('o resultado do Bash chega comprimido ao modelo, e /orquestra saida off devolve inteiro', async ($, on) => {
  const longa = Array.from({ length: 600 }, (_, i) => `linha ${i}`).join('\n')
  on('tool.call', () => ({ result: { stdout: longa, stderr: '', interrupted: false } }))

  const ligada = JSON.stringify(await $.tool.call({ tool: 'Bash', command: 'seq 600' }))
  expect(ligada).toContain('omitidas pela orquestra')
  expect(ligada).not.toContain('linha 300')

  const r = await $.command.run({ command: 'orquestra', args: 'saida off' })
  expect(JSON.stringify(r)).toContain('desligada')
  const desligada = JSON.stringify(await $.tool.call({ tool: 'Bash', command: 'seq 600' }))
  expect(desligada).toContain('linha 300')

  await $.command.run({ command: 'orquestra', args: 'saida on' })
  expect(JSON.stringify(await $.tool.call({ tool: 'Bash', command: 'seq 600' }))).toContain('omitidas pela orquestra')
})

test('saída curta do Bash passa sem mudar', async ($, on) => {
  on('tool.call', () => ({ result: { stdout: 'ok\n', stderr: '', interrupted: false } }))
  const r = JSON.stringify(await $.tool.call({ tool: 'Bash', command: 'echo ok' }))
  expect(r).toContain('ok')
  expect(r).not.toContain('omitidas')
})

test('/orquestra curto on|off põe e tira a instrução de respostas curtas do prompt de sistema', async ($, on) => {
  on('prompt.compose', () => ({ sections: [{ id: 'base', text: 'base', scope: 'shared' as const }] }))
  const ids = async () => (await $.prompt.compose({ model: 'claude-sonnet-5-5', promptModel: 'claude-sonnet-5-5', surfaces: [], tools: [], outputStyle: null, traits: [] })).sections.map(s => s.id)

  expect(await ids()).toContain('orquestra:curto')

  const r = await $.command.run({ command: 'orquestra', args: 'curto off' })
  expect(JSON.stringify(r)).toContain('desligadas')
  expect(await ids()).toEqual(['base'])

  await $.command.run({ command: 'orquestra', args: 'curto on' })
  expect(await ids()).toContain('orquestra:curto')

  const status = JSON.stringify(await $.command.run({ command: 'orquestra', args: '' }))
  expect(status).toContain('Respostas curtas: ligadas')
  expect(status).toContain('Saída de terminal enxuta: ligada')
})
