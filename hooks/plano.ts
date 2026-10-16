import type { Tarefa } from '../types'

export const MAX_TAREFAS = 12

export const INSTRUCAO_PLANEJADOR = `MODO PLANEJADOR (instrução do sistema; o usuário não vê este bloco).
Você é o planejador de um projeto grande. Outros agentes vão executar as tarefas; você só planeja.
- NÃO edite nem crie arquivos e não rode comandos que alterem algo. Leia e pesquise o que precisar para entender o projeto.
- Se faltar informação essencial, pergunte ao usuário e NÃO emita o plano.
- Quando estiver pronto, responda com um resumo curto do que entendeu e, no final, o plano em JSON dentro de <plano></plano>:
<plano>{"objetivo":"uma frase","tarefas":[{"id":"1","titulo":"curto","descricao":"o que fazer, completo, com critério de pronto","depende":[],"arquivos":["caminhos que a tarefa cria ou edita"]}]}</plano>
Regras do plano:
- De 2 a ${MAX_TAREFAS} tarefas, cada uma executável por um agente que NÃO viu esta conversa: a descrição precisa trazer todo o contexto necessário (caminhos, nomes, decisões já tomadas).
- Tarefas pequenas e independentes são melhores que uma gigante.
- "depende" lista os ids das tarefas cujo resultado esta precisa. Use só quando houver dependência de verdade.
- "arquivos" lista tudo que a tarefa cria ou edita. Tarefas que mexem no mesmo arquivo rodam uma de cada vez.
- Não inclua tarefa de revisão final: isso é feito depois, por mim.`

export function parsePlano(answer: string): { objetivo: string; tarefas: Omit<Tarefa, 'nivel' | 'status'>[] } | null {
  const bruto = answer.match(/<plano>([\s\S]*?)<\/plano>/)?.[1]
  if (!bruto) return null

  let dados: { objetivo?: unknown; tarefas?: unknown }
  try {
    dados = JSON.parse(bruto.trim())
  } catch {
    return null
  }
  if (!Array.isArray(dados.tarefas) || dados.tarefas.length < 1 || dados.tarefas.length > MAX_TAREFAS) return null

  const tarefas: Omit<Tarefa, 'nivel' | 'status'>[] = []
  for (const t of dados.tarefas as Record<string, unknown>[]) {
    if (typeof t?.id !== 'string' && typeof t?.id !== 'number') return null
    if (typeof t.titulo !== 'string' || typeof t.descricao !== 'string') return null
    const lista = (v: unknown) => (Array.isArray(v) ? v.map(String) : [])
    tarefas.push({
      id: String(t.id),
      titulo: t.titulo.slice(0, 80),
      descricao: t.descricao,
      depende: lista(t.depende),
      arquivos: lista(t.arquivos),
    })
  }

  const ids = new Set(tarefas.map(t => t.id))
  if (ids.size !== tarefas.length) return null
  if (tarefas.some(t => t.depende.some(d => !ids.has(d) || d === t.id))) return null
  if (temCiclo(tarefas)) return null

  return { objetivo: typeof dados.objetivo === 'string' ? dados.objetivo : '', tarefas }
}

function temCiclo(tarefas: { id: string; depende: string[] }[]): boolean {
  const deps = new Map(tarefas.map(t => [t.id, t.depende]))
  const estado = new Map<string, 1 | 2>()
  const visita = (id: string): boolean => {
    if (estado.get(id) === 2) return false
    if (estado.get(id) === 1) return true
    estado.set(id, 1)
    for (const d of deps.get(id) ?? []) if (visita(d)) return true
    estado.set(id, 2)
    return false
  }
  return tarefas.some(t => visita(t.id))
}

// Quem é bloqueado por uma dependência que falhou, direta ou em cadeia.
export function bloquear(tarefas: Tarefa[]): Tarefa[] {
  let lista = tarefas
  for (;;) {
    const ruins = new Set(lista.filter(t => t.status === 'erro' || t.status === 'bloqueada' || t.status === 'pulada').map(t => t.id))
    const proximo = lista.map(t =>
      t.status === 'pendente' && t.depende.some(d => ruins.has(d)) ? { ...t, status: 'bloqueada' as const } : t,
    )
    if (proximo.every((t, i) => t === lista[i])) return lista
    lista = proximo
  }
}

// Escolhe o que pode começar agora: dependências prontas e sem disputa por
// arquivo com o que já roda. Tarefa sem lista de arquivos só roda sozinha.
export function prontas(tarefas: Tarefa[]): Tarefa[] {
  const ok = new Set(tarefas.filter(t => t.status === 'ok').map(t => t.id))
  const rodando = tarefas.filter(t => t.status === 'rodando')
  const escolhidas: Tarefa[] = []

  const conflita = (a: Tarefa, b: Tarefa) =>
    a.arquivos.length === 0 || b.arquivos.length === 0 || a.arquivos.some(f => b.arquivos.includes(f))

  for (const t of tarefas) {
    if (t.status !== 'pendente' || !t.depende.every(d => ok.has(d))) continue
    if ([...rodando, ...escolhidas].some(o => conflita(t, o))) continue
    escolhidas.push(t)
  }
  return escolhidas
}

export function terminou(tarefas: Tarefa[]): boolean {
  return tarefas.every(t => t.status !== 'pendente' && t.status !== 'rodando')
}

export function promptExecutor(objetivo: string, t: Tarefa, todas: Tarefa[]): string {
  const base = t.depende
    .map(id => todas.find(o => o.id === id))
    .filter((o): o is Tarefa => o !== undefined)
    .map(o => `- #${o.id} ${o.titulo}: ${o.resultado ?? 'concluída'}`)
    .join('\n')

  return [
    `Você executa a tarefa #${t.id} de um plano maior. Objetivo geral: ${objetivo || '(não informado)'}`,
    '',
    `TAREFA: ${t.titulo}`,
    t.descricao,
    t.arquivos.length ? `\nArquivos previstos: ${t.arquivos.join(', ')}` : '',
    base ? `\nO que as tarefas anteriores de que você depende fizeram:\n${base}` : '',
    '',
    'Faça só esta tarefa e fique dentro dos arquivos dela, salvo necessidade clara. Não refaça o que as outras tarefas cuidam.',
    'Ao final responda curto: o que fez, os arquivos que alterou e qualquer problema ou pendência.',
  ]
    .filter(l => l !== '')
    .join('\n')
}

export function promptRelatorio(objetivo: string, tarefas: Tarefa[]): string {
  const linhas = tarefas
    .map(t => `#${t.id} ${t.titulo} [${t.status}]: ${t.resultado ?? '-'}`)
    .join('\n')
  return [
    `Os executores terminaram o plano${objetivo ? ` "${objetivo}"` : ''}. Resultado por tarefa:`,
    linhas,
    '',
    'Faça a revisão final: confira se as peças se encaixam (leia os arquivos principais e rode testes ou build, se existirem), corrija o que for pequeno e diga ao usuário, em poucas linhas, o que foi feito e o que ficou pendente.',
  ].join('\n')
}

export function cortar(texto: string, max: number): string {
  const limpo = texto.trim()
  return limpo.length > max ? `${limpo.slice(0, max)}…` : limpo
}

// "sem 2 3 4=6": pula as tarefas 2 e 3 e põe a 4 no nível 6.
export function parseAprovar(args: string): { pular: Set<string>; niveis: Map<string, number> } {
  const pular = new Set<string>()
  const niveis = new Map<string, number>()
  let pulando = false
  for (const parte of args.toLowerCase().replace(/#/g, '').split(/[\s,]+/).filter(Boolean)) {
    if (parte === 'sem') {
      pulando = true
      continue
    }
    const troca = parte.match(/^(\d+)=(\d+)$/)
    if (troca) {
      niveis.set(troca[1]!, Number(troca[2]))
      pulando = false
    } else if (/^\d+$/.test(parte) && pulando) {
      pular.add(parte)
    }
  }
  return { pular, niveis }
}
