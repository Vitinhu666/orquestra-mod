import { expect, mock, test } from 'claude-code/testing'

import { bloquear, parseAprovar, parsePlano, prontas } from '../hooks/plano'
import type { Tarefa } from '../types'

const USO = { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }

function tarefa(id: string, extra: Partial<Tarefa> = {}): Tarefa {
  return { id, titulo: `t${id}`, descricao: 'd', depende: [], arquivos: [`${id}.ts`], nivel: 3, status: 'pendente', ...extra }
}

test('parsePlano aceita um plano bom e recusa ciclo, id repetido e dependência solta', () => {
  const bom = '<plano>{"objetivo":"x","tarefas":[{"id":"1","titulo":"a","descricao":"d"},{"id":2,"titulo":"b","descricao":"d","depende":["1"]}]}</plano>'
  expect(parsePlano(bom)?.tarefas.length).toBe(2)
  expect(parsePlano('sem plano')).toBeNull()
  const ciclo = '<plano>{"tarefas":[{"id":"1","titulo":"a","descricao":"d","depende":["2"]},{"id":"2","titulo":"b","descricao":"d","depende":["1"]}]}</plano>'
  expect(parsePlano(ciclo)).toBeNull()
  const repetido = '<plano>{"tarefas":[{"id":"1","titulo":"a","descricao":"d"},{"id":"1","titulo":"b","descricao":"d"}]}</plano>'
  expect(parsePlano(repetido)).toBeNull()
  const solta = '<plano>{"tarefas":[{"id":"1","titulo":"a","descricao":"d","depende":["9"]}]}</plano>'
  expect(parsePlano(solta)).toBeNull()
})

test('prontas respeita dependência e disputa por arquivo', () => {
  const lista = [
    tarefa('1'),
    tarefa('2', { arquivos: ['1.ts'] }),
    tarefa('3', { depende: ['1'] }),
    tarefa('4', { arquivos: [] }),
  ]
  // 1 roda; 2 disputa arquivo com 1; 3 espera 1; 4 sem arquivos só roda sozinha.
  expect(prontas(lista).map(t => t.id)).toEqual(['1'])
  const andando = [{ ...lista[0]!, status: 'ok' as const }, ...lista.slice(1)]
  expect(prontas(andando).map(t => t.id)).toEqual(['2', '3'])
})

test('bloquear propaga a falha pelas dependências', () => {
  const lista = [tarefa('1', { status: 'erro' }), tarefa('2', { depende: ['1'] }), tarefa('3', { depende: ['2'] }), tarefa('4')]
  expect(bloquear(lista).map(t => t.status)).toEqual(['erro', 'bloqueada', 'bloqueada', 'pendente'])
})

test('parseAprovar lê "sem" e "tarefa=nivel"', () => {
  const r = parseAprovar('sem 2 3 4=6')
  expect([...r.pular]).toEqual(['2', '3'])
  expect(r.niveis.get('4')).toBe(6)
})

test('projeto grande: planeja, pede aprovação, executa em ondas e chama a revisão', async ($, on) => {
  const respostas: string[] = []
  const spawns: { subagent_type?: string; description?: string; prompt: string }[] = []
  const enviados: string[] = []
  const relogio = mock.clock(on)

  on('prompt.submit', ($, e) => {
    enviados.push(e.text)
    return { text: e.text }
  })
  on('model.complete', () => ({ value: { isAnswered: true, text: respostas.shift() ?? '{"nivel":3}', usage: USO } }))
  on('agent.spawn', ($, e) => {
    spawns.push(e)
    return { model: 'x', agentId: `ag${spawns.length}` }
  })
  on('turn.complete', ($, e) => ({ text: e.answer }))

  respostas.push('{"nivel": 6, "projeto": true, "motivo": "sistema novo"}')
  await $.prompt.submit({ text: 'constrói um sistema de cobrança inteiro' })

  const status1 = await $.command.run({ command: 'recepcao', args: '' })
  expect(JSON.stringify(status1)).toContain('Plano (planejando)')

  const plano =
    '<plano>{"objetivo":"cobrança","tarefas":[' +
    '{"id":"1","titulo":"modelo","descricao":"d","arquivos":["a.ts"]},' +
    '{"id":"2","titulo":"api","descricao":"d","arquivos":["b.ts"]},' +
    '{"id":"3","titulo":"tela","descricao":"d","depende":["1"],"arquivos":["c.ts"]}]}</plano>'
  respostas.push('{"nivel":1}', '{"nivel":4}', '{"nivel":3}')
  const fim = await $.turn.complete({ turnId: 't', answer: `Entendi.\n${plano}`, durationMs: 1, isAborted: false, reason: 'answer' })
  expect(JSON.stringify(fim)).toContain('#1 modelo')
  expect(JSON.stringify(fim)).toContain('Haiku')

  // Sem aprovar, nada roda.
  expect(spawns.length).toBe(0)

  await $.command.run({ command: 'aprovar', args: '' })
  expect(spawns.map(s => s.description)).toEqual(['modelo', 'api'])
  expect(spawns.map(s => s.subagent_type)).toEqual(['recepcionista:nivel-1', 'recepcionista:nivel-4'])

  // Este motor de teste não tem o núcleo que devolve o agentId, então os dois
  // spawns contam como não iniciados: a 3 fica bloqueada, o plano fecha e a
  // revisão final sai (num evento à parte, pelo relógio).
  await relogio.advance(100)
  const fim2 = JSON.stringify(await $.command.run({ command: 'recepcao', args: '' }))
  expect(fim2).toContain('Plano (pronto)')
  expect(fim2).toContain('⊘ #3 tela')
  expect(enviados.some(t => t.includes('revisão final'))).toBe(true)
})
