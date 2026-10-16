import type { Turno, UltimoErro, UsoSessao } from '../types'

// US$ por milhão de tokens (tabela da API). Cache-escrita é estimado: entrada x1,25.
export const PRECOS: Record<string, { ent: number; sai: number; cl: number }> = {
  haiku: { ent: 0.1, sai: 0.5, cl: 0.01 },
  sonnet: { ent: 2, sai: 10, cl: 0.2 },
  opus: { ent: 4, sai: 20, cl: 0.2 },
}
const MULT_CACHE_ESCRITA = 1.25

export type Familia = 'haiku' | 'sonnet' | 'opus' | 'outro'

export function familia(modelo: string): Familia {
  const m = modelo.toLowerCase()
  if (m.includes('haiku')) return 'haiku'
  if (m.includes('sonnet')) return 'sonnet'
  if (m.includes('opus')) return 'opus'
  return 'outro'
}

export const ROTULO: Record<Familia, string> = { haiku: 'Haiku', sonnet: 'Sonnet', opus: 'Opus', outro: 'Outro' }

export type UsoTokens = { ent: number; sai: number; cl: number; ce: number }

export function custoCom(fam: Familia, u: UsoTokens): number {
  const p = PRECOS[fam]
  if (!p) return 0
  return (u.ent * p.ent + u.sai * p.sai + u.cl * p.cl + u.ce * p.ent * MULT_CACHE_ESCRITA) / 1_000_000
}

type UsageApi = {
  model: string
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

export function novoTurno(n: number, usage: UsageApi, ts: number, agente: boolean): Turno {
  const u = {
    ent: usage.input_tokens,
    sai: usage.output_tokens,
    cl: usage.cache_read_input_tokens,
    ce: usage.cache_creation_input_tokens,
  }
  return {
    n,
    modelo: usage.model,
    ...u,
    tokens: u.ent + u.sai + u.cl + u.ce,
    custo: custoCom(familia(usage.model), u),
    ts,
    agente,
  }
}

export type ResumoModelo = { fam: Familia; custo: number; turnos: number }

export function agregarPorModelo(turnos: Turno[]): ResumoModelo[] {
  const mapa = new Map<Familia, ResumoModelo>()
  for (const t of turnos) {
    const fam = familia(t.modelo)
    const r = mapa.get(fam) ?? { fam, custo: 0, turnos: 0 }
    r.custo += t.custo
    r.turnos += 1
    mapa.set(fam, r)
  }
  const ordem: Familia[] = ['haiku', 'sonnet', 'opus', 'outro']
  return ordem.map(f => mapa.get(f)).filter((r): r is ResumoModelo => r !== undefined)
}

export type BarraTurno = { n: number; fam: Familia; altura: number; agente: boolean }

// Altura de 0 a 1 em relação ao maior turno da janela.
export function serieTurnos(turnos: Turno[], max = 40): BarraTurno[] {
  const fim = turnos.slice(-max)
  const topo = Math.max(1, ...fim.map(t => t.tokens))
  return fim.map(t => ({ n: t.n, fam: familia(t.modelo), altura: t.tokens / topo, agente: t.agente }))
}

export function custoTotal(turnos: Turno[]): number {
  return turnos.reduce((s, t) => s + t.custo, 0)
}

// 1 - custo real / custo se tudo tivesse rodado no Opus com os mesmos tokens.
// É uma estimativa: não conta que o esforço e a qualidade mudam os tokens.
export function economiaEstimada(turnos: Turno[]): number | null {
  if (turnos.length < 3) return null
  const real = custoTotal(turnos)
  const seOpus = turnos.reduce((s, t) => s + custoCom('opus', t), 0)
  if (seOpus <= 0) return null
  return Math.max(0, 1 - real / seOpus)
}

export type Alerta = { texto: string; nivel: 'aviso' | 'critico' }

export type EntradaAlertas = {
  turnos: Turno[]
  ultimoErro: UltimoErro | null
  uso: UsoSessao | null
}

export function alertas(e: EntradaAlertas): Alerta[] {
  const lista: Alerta[] = []

  const recentes = e.turnos.filter(t => !t.agente).slice(-6)
  let trocas = 0
  for (let i = 1; i < recentes.length; i++) {
    if (recentes[i]!.modelo !== recentes[i - 1]!.modelo) trocas++
  }
  if (trocas >= 3) lista.push({ nivel: 'aviso', texto: `${trocas} trocas de modelo nos últimos 6 turnos (cada troca perde o cache)` })

  if (e.ultimoErro && e.ultimoErro.seguidos >= 2) {
    lista.push({ nivel: 'aviso', texto: `${e.ultimoErro.tool} falhou ${e.ultimoErro.seguidos}x seguidas` })
  }

  const ctx = e.uso?.percent ?? null
  if (ctx !== null && ctx >= 85) lista.push({ nivel: 'critico', texto: `Contexto em ${Math.round(ctx)}%: compacte agora` })
  else if (ctx !== null && ctx >= 60) lista.push({ nivel: 'aviso', texto: `Contexto em ${Math.round(ctx)}%` })

  for (const l of e.uso?.limites ?? []) {
    if (l.percent >= 80) lista.push({ nivel: l.percent >= 95 ? 'critico' : 'aviso', texto: `Limite de uso (${l.tipo}) em ${Math.round(l.percent)}%` })
  }
  return lista
}

export function usd(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—'
  return `$${v.toFixed(v < 1 ? 3 : 2).replace('.', ',')}`
}

export function pct(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : `${Math.round(v)}%`
}
