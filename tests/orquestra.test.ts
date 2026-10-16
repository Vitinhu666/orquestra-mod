import { expect, test } from 'claude-code/testing'
import type { TurnStepInput } from 'claude-code'

const USO = { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }

test('cada prompt escolhe modelo e esforço do turno principal', async ($, on) => {
  const respostas: string[] = []
  const vistos: TurnStepInput[] = []

  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('model.complete', () => ({
    value: { isAnswered: true, text: respostas.shift() ?? '{"nivel": 3, "motivo": "padrão"}', usage: USO },
  }))
  on('turn.step', async function* ($, e) {
    vistos.push(e)
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })

  async function passo(agentId?: string): Promise<TurnStepInput> {
    const s = $.turn.step({ turnId: 't', index: 0, model: 'claude-sonnet-5-5', messageCount: 1, agentId })
    for await (const _ of s) void _
    await s.result
    return vistos[vistos.length - 1]!
  }

  // Bug sutil: Opus, high.
  respostas.push('{"nivel": 8, "motivo": "bug sutil de concorrência"}')
  await $.prompt.submit({ text: 'tem uma race condition no worker' })
  let visto = await passo()
  expect(visto.model).toBe('claude-opus-5-5')
  expect(visto.effort).toBe('high')

  // Subagente fica com o modelo dele.
  visto = await passo('agente-1')
  expect(visto.model).toBe('claude-sonnet-5-5')

  // Queda de um nível só: mantém Opus high (não perde o cache).
  respostas.push('{"nivel": 7, "motivo": "refatoração"}')
  await $.prompt.submit({ text: 'agora refatora esse módulo' })
  visto = await passo()
  expect(visto.model).toBe('claude-opus-5-5')
  expect(visto.effort).toBe('high')

  // Coisa trivial: desce pro Haiku low.
  respostas.push('Claro! {"nivel": 1, "motivo": "agradecimento"}')
  await $.prompt.submit({ text: 'valeu!' })
  visto = await passo()
  expect(visto.model).toBe('claude-haiku-5-5')
  expect(visto.effort).toBe('low')

  // Resposta que não é JSON: cai no nível padrão 5 (Sonnet medium).
  respostas.push('não sei')
  await $.prompt.submit({ text: 'cria um endpoint de login' })
  visto = await passo()
  expect(visto.model).toBe('claude-sonnet-5-5')
  expect(visto.effort).toBe('medium')
})

test('desligada, a orquestra não mexe no modelo', async ($, on) => {
  const vistos: TurnStepInput[] = []
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('model.complete', () => ({ value: { isAnswered: true, text: '{"nivel": 6, "motivo": "x"}', usage: USO } }))
  on('turn.step', async function* ($, e) {
    vistos.push(e)
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })

  const r = await $.command.run({ command: 'orquestra', args: 'off' })
  expect(JSON.stringify(r)).toContain('desligada')

  await $.prompt.submit({ text: 'projeta um sistema distribuído inteiro' })
  const s = $.turn.step({ turnId: 't', index: 0, model: 'claude-sonnet-5-5', messageCount: 1 })
  for await (const _ of s) void _
  await s.result
  expect(vistos[0]!.model).toBe('claude-sonnet-5-5')
})
