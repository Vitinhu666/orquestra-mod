import { expect, test } from 'claude-code/testing'

import { agregarPorModelo, alertas, custoCom, economiaEstimada, familia, novoTurno, serieTurnos } from '../hooks/painel-dados'
import type { Turno } from '../types'

function usage(model: string, ent = 1000, sai = 1000, cl = 0, ce = 0) {
  return { model, input_tokens: ent, output_tokens: sai, cache_read_input_tokens: cl, cache_creation_input_tokens: ce }
}

test('familia e custo por modelo seguem a tabela de preços', () => {
  expect(familia('claude-haiku-5-5')).toBe('haiku')
  expect(familia('claude-opus-5-5')).toBe('opus')
  expect(familia('gpt')).toBe('outro')
  const u = { ent: 1_000_000, sai: 1_000_000, cl: 0, ce: 0 }
  expect(Math.abs(custoCom('opus', u) - 24) < 1e-9).toBe(true)
  expect(Math.abs(custoCom('sonnet', u) - 12) < 1e-9).toBe(true)
  expect(Math.abs(custoCom('haiku', u) - 0.6) < 1e-9).toBe(true)
  expect(custoCom('outro', u)).toBe(0)
})

test('novoTurno soma os quatro contadores e calcula o custo', () => {
  const t = novoTurno(1, usage('claude-sonnet-5-5', 100, 50, 1000, 20), 5, false)
  expect(t.tokens).toBe(1170)
  expect(t.custo).toBeGreaterThan(0)
  expect(t.agente).toBe(false)
})

test('agregarPorModelo e serieTurnos', () => {
  const ts: Turno[] = [
    novoTurno(1, usage('claude-haiku-5-5'), 1, false),
    novoTurno(2, usage('claude-opus-5-5', 5000, 5000), 2, false),
    novoTurno(3, usage('claude-opus-5-5'), 3, true),
  ]
  const ag = agregarPorModelo(ts)
  expect(ag.map(a => [a.fam, a.turnos])).toEqual([['haiku', 1], ['opus', 2]])
  const serie = serieTurnos(ts)
  expect(serie[1]!.altura).toBe(1)
  expect(serie[0]!.altura).toBeLessThan(0.5)
  expect(serieTurnos(ts, 2).length).toBe(2)
})

test('economia é nula com poucos turnos e positiva quando o Haiku atende', () => {
  const dois: Turno[] = [novoTurno(1, usage('claude-haiku-5-5'), 1, false), novoTurno(2, usage('claude-haiku-5-5'), 2, false)]
  expect(economiaEstimada(dois)).toBeNull()
  const tres = [...dois, novoTurno(3, usage('claude-haiku-5-5'), 3, false)]
  expect(economiaEstimada(tres)!).toBeGreaterThan(0.9)
  const soOpus = [1, 2, 3].map(n => novoTurno(n, usage('claude-opus-5-5'), n, false))
  expect(economiaEstimada(soOpus)).toBe(0)
})

test('alertas: trocas, erro repetido, contexto e limite de uso', () => {
  const nomes = ['claude-haiku-5-5', 'claude-opus-5-5', 'claude-haiku-5-5', 'claude-opus-5-5', 'claude-haiku-5-5', 'claude-opus-5-5']
  const turnos = nomes.map((m, i) => novoTurno(i + 1, usage(m), i, false))
  const a = alertas({
    turnos,
    ultimoErro: { tool: 'Bash', seguidos: 2 },
    uso: { percent: 88, tokens: 1, janela: 1, usd: 1, limites: [{ tipo: '5h', percent: 96 }] },
  })
  const textos = a.map(x => x.texto).join(' | ')
  expect(textos).toContain('trocas de modelo')
  expect(textos).toContain('Bash falhou 2x')
  expect(textos).toContain('Contexto em 88%')
  expect(textos).toContain('Limite de uso (5h) em 96%')
  expect(a.some(x => x.nivel === 'critico')).toBe(true)
  expect(alertas({ turnos: [], ultimoErro: null, uso: null })).toEqual([])
  const agentes = nomes.map((m, i) => novoTurno(i + 1, usage(m), i, true))
  expect(alertas({ turnos: agentes, ultimoErro: null, uso: null })).toEqual([])
})
