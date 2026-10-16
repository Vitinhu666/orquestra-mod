import { expect, mock, test } from 'claude-code/testing'

import { agentesParaMostrar, duracao, resumirAcao } from '../hooks/painel-dados'
import type { Agente } from '../types'

const PANE = (bodyColumns: number) =>
  ({
    component: 'Pane',
    requestId: 'orquestra-painel',
    props: { title: 'Orquestra', isFocused: false, bodyColumns, placement: 'dock', scroll: { offset: 0, bodyRows: 30 } },
  }) as const

const SUPERFICIES = ['terminal', 'desktop'] as const

function usage(model: string) {
  return { model, input_tokens: 100, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
}

function uso(percent: number) {
  return { startedAt: 0, context: { window: 1_000_000, percent, tokens: percent * 10_000, usd: 0 }, rateLimits: [] }
}

test('resumirAcao: caminho vira nome do arquivo, comando longo é cortado, sem argumento fica só a ferramenta', () => {
  expect(resumirAcao('Edit', { file_path: 'C:\\proj\\src\\app.ts' })).toBe('Edit app.ts')
  expect(resumirAcao('Bash', { command: 'npm   test' })).toBe('Bash npm test')
  const longo = resumirAcao('Bash', { command: 'x'.repeat(80) })
  expect(longo.length).toBeLessThan(50)
  expect(longo.endsWith('…')).toBe(true)
  expect(resumirAcao('TodoWrite', {})).toBe('TodoWrite')
  expect(resumirAcao('Grep', { pattern: 'TODO' })).toBe('Grep TODO')
})

test('agentesParaMostrar: principal primeiro, depois quem roda, depois quem terminou por último', () => {
  const a = (id: string, status: Agente['status'], fim?: number): Agente => ({
    id, nome: id, tipo: '', modelo: '', status, acao: '', ferramentas: 0, visto: 0, inicio: 0, fim,
  })
  const ordem = agentesParaMostrar([a('velho', 'ok', 1), a('rodando', 'rodando'), a('principal', 'ok', 5), a('novo', 'erro', 9)])
  expect(ordem.map(x => x.id)).toEqual(['principal', 'rodando', 'novo', 'velho'])
  expect(agentesParaMostrar(Array.from({ length: 20 }, (_, i) => a(`x${i}`, 'ok', i)), 8).length).toBe(8)
  expect(duracao(59_000)).toBe('59s')
  expect(duracao(125_000)).toBe('2min')
  expect(duracao(3_900_000)).toBe('1h05')
})

test('turno sem usage não quebra: não conta turno, mas marca a conversa principal', async ($, on) => {
  on('turn.complete', ($, e) => ({ text: e.answer }))
  await $.turn.complete({ turnId: 't', answer: 'ok', durationMs: 1, isAborted: false, reason: 'answer' })
  for (const surface of SUPERFICIES) {
    const ui = await $.ui.mount({ plugin: 'orquestra', surface, ...PANE(48) })
    expect(await ui.find({ text: /Principal/ })).toBeDefined()
    expect(await ui.find({ text: /Ainda sem turnos/ })).toBeDefined()
    await ui.unmount()
  }
})

test('turno interrompido marca erro e não compacta', async ($, on) => {
  const relogio = mock.clock(on)
  let compactou = 0
  on('session.usage', () => ({ value: uso(90) }))
  on('session.compact', () => {
    compactou++
    return { skip: 'teste' }
  })
  on('turn.complete', ($, e) => ({ text: e.answer }))
  await $.turn.complete({ turnId: 't', answer: '', durationMs: 1, isAborted: true, reason: 'aborted', usage: usage('claude-opus-5-5') })
  await relogio.advance(2000)
  expect(compactou).toBe(0)
  for (const surface of SUPERFICIES) {
    const ui = await $.ui.mount({ plugin: 'orquestra', surface, ...PANE(48) })
    expect(await ui.find({ text: /terminou com aborted/ })).toBeDefined()
    await ui.unmount()
  }
})

test('compactação que falha (turno já rodando) tenta de novo no fim do próximo turno', async ($, on) => {
  const relogio = mock.clock(on)
  let tentativas = 0
  on('session.usage', () => ({ value: uso(70) }))
  on('session.compact', () => {
    tentativas++
    if (tentativas === 1) throw new Error('a turn is running')
    return { skip: 'teste' }
  })
  on('turn.complete', ($, e) => ({ text: e.answer }))
  const fim = async (n: number) => {
    await $.turn.complete({ turnId: `t${n}`, answer: 'ok', durationMs: 1, isAborted: false, reason: 'answer', usage: usage('claude-sonnet-5-5') })
    await relogio.advance(2000)
  }
  await fim(1)
  expect(tentativas).toBe(1)
  await fim(2)
  expect(tentativas).toBe(2)
  // A segunda deu "skip" (vetada por um hook): não insiste mais.
  await fim(3)
  expect(tentativas).toBe(2)
})

test('sem leitura de uso (session.usage indisponível) o painel mostra traço em vez de quebrar', async ($, on) => {
  on('turn.complete', ($, e) => ({ text: e.answer }))
  await $.turn.complete({ turnId: 't', answer: 'ok', durationMs: 1, isAborted: false, reason: 'answer', usage: usage('claude-haiku-5-5') })
  for (const surface of SUPERFICIES) {
    const ui = await $.ui.mount({ plugin: 'orquestra', surface, ...PANE(48) })
    expect(await ui.find({ text: /Janela de contexto/ })).toBeDefined()
    expect(await ui.find({ text: /—/ })).toBeDefined()
    await ui.unmount()
  }
})

test('painel estreito e painel muito largo desenham sem erro; 250 turnos ficam em 200', async ($, on) => {
  on('turn.complete', ($, e) => ({ text: e.answer }))
  for (let i = 0; i < 250; i++) {
    await $.turn.complete({ turnId: `t${i}`, answer: 'ok', durationMs: 1, isAborted: false, reason: 'answer', usage: usage('claude-sonnet-5-5') })
  }
  for (const surface of SUPERFICIES) {
    for (const largura of [12, 48, 240]) {
      const ui = await $.ui.mount({ plugin: 'orquestra', surface, ...PANE(largura) })
      expect(await ui.find({ text: /200 turnos/ })).toBeDefined()
      await ui.unmount()
    }
  }
})

test('agente parado há mais de 10 minutos aparece com aviso', async ($, on) => {
  const relogio = mock.clock(on)
  on('tool.call', () => ({ result: { stdout: 'ok', stderr: '', interrupted: false } }))
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  await relogio.advance(11 * 60_000)
  for (const surface of SUPERFICIES) {
    const ui = await $.ui.mount({ plugin: 'orquestra', surface, ...PANE(48) })
    expect(await ui.find({ text: /sem atividade há 11min/ })).toBeDefined()
    expect(await ui.find({ text: /Bash npm test/ })).toBeDefined()
    await ui.unmount()
  }
})
