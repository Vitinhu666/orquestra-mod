import { expect, test } from 'claude-code/testing'
import type { TurnStepInput } from 'claude-code'

const USO = { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }

function preparar(on: Parameters<Parameters<typeof test>[1]>[1]) {
  const respostas: string[] = []
  const vistos: TurnStepInput[] = []
  let triagens = 0
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('model.complete', () => {
    triagens++
    return { value: { isAnswered: true, text: respostas.shift() ?? '{"nivel": 5}', usage: USO } }
  })
  on('turn.step', async function* ($, e) {
    vistos.push(e)
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  return { respostas, vistos, triagens: () => triagens }
}

async function passo($: Parameters<Parameters<typeof test>[1]>[0], vistos: TurnStepInput[]): Promise<TurnStepInput> {
  const s = $.turn.step({ turnId: 't', index: 0, model: 'claude-haiku-5-5', messageCount: 1 })
  for await (const _ of s) void _
  await s.result
  return vistos[vistos.length - 1]!
}

test('a escada sobe o esforço do Haiku, depois o do Sonnet, e só então chama o Opus', async ($, on) => {
  const { respostas, vistos } = preparar(on)
  const esperado: [number, string, string][] = [
    [1, 'claude-haiku-5-5', 'low'],
    [2, 'claude-haiku-5-5', 'medium'],
    [3, 'claude-haiku-5-5', 'high'],
    [4, 'claude-sonnet-5-5', 'low'],
    [5, 'claude-sonnet-5-5', 'medium'],
    [6, 'claude-sonnet-5-5', 'high'],
    [7, 'claude-opus-5-5', 'medium'],
    [8, 'claude-opus-5-5', 'high'],
  ]
  for (const [nivel, modelo, esforco] of esperado) {
    // Sobe um nível por vez: a regra de estabilidade só segura descidas.
    respostas.push(`{"nivel": ${nivel}, "motivo": "teste"}`)
    await $.prompt.submit({ text: `pedido nível ${nivel}` })
    const v = await passo($, vistos)
    expect(v.model).toBe(modelo)
    expect(v.effort).toBe(esforco)
  }
})

test('o automático nunca escolhe xhigh nem max, mesmo com nota fora da escala', async ($, on) => {
  const { respostas, vistos } = preparar(on)
  respostas.push('{"nivel": 9, "motivo": "pede o máximo"}')
  await $.prompt.submit({ text: 'algo enorme' })
  const v = await passo($, vistos)
  expect(['xhigh', 'max']).not.toContain(v.effort)
  expect(v.model).toBe('claude-sonnet-5-5')
})

test('/orquestra fixar opus max trava sem triagem, e /orquestra auto volta ao automático', async ($, on) => {
  const { respostas, vistos, triagens } = preparar(on)

  const r = await $.command.run({ command: 'orquestra', args: 'fixar opus max' })
  expect(JSON.stringify(r)).toContain('Opus · max')

  await $.prompt.submit({ text: 'oi' })
  let v = await passo($, vistos)
  expect(v.model).toBe('claude-opus-5-5')
  expect(v.effort).toBe('max')
  expect(triagens()).toBe(0)

  const status = await $.command.run({ command: 'orquestra', args: '' })
  expect(JSON.stringify(status)).toContain('FIXADA em Opus · max')

  const ruim = await $.command.run({ command: 'orquestra', args: 'fixar gpt max' })
  expect(JSON.stringify(ruim)).toContain('Uso: /orquestra fixar')

  await $.command.run({ command: 'orquestra', args: 'auto' })
  respostas.push('{"nivel": 1, "motivo": "valeu"}')
  await $.prompt.submit({ text: 'valeu' })
  v = await passo($, vistos)
  expect(triagens()).toBe(1)
  expect(v.model).toBe('claude-haiku-5-5')
  expect(v.effort).toBe('low')
})

test('/orquestra fixar sonnet sem esforço usa high', async ($, on) => {
  const { vistos } = preparar(on)
  await $.command.run({ command: 'orquestra', args: 'fixar sonnet' })
  await $.prompt.submit({ text: 'qualquer coisa' })
  const v = await passo($, vistos)
  expect(v.model).toBe('claude-sonnet-5-5')
  expect(v.effort).toBe('high')
})
