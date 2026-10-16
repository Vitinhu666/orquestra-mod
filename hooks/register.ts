import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Decisao, Esforco, Plano, StatusTarefa, Tarefa } from '../types'
import { novoTurno } from './painel-dados'
import { PAINEL_ID, registrarPainel } from './painel'
import {
  INSTRUCAO_PLANEJADOR,
  bloquear,
  cortar,
  parseAprovar,
  parsePlano,
  promptExecutor,
  promptRelatorio,
  prontas,
  terminou,
} from './plano'

type Ctx = EngineInterface

// Os seis níveis: edite aqui para mudar quem atende cada um.
const NIVEIS: Record<number, { nome: string; modelo: string; rotulo: string; esforco: Esforco }> = {
  1: { nome: 'Trivial', modelo: 'claude-haiku-5-5', rotulo: 'Haiku', esforco: 'low' },
  2: { nome: 'Simples', modelo: 'claude-sonnet-5-5', rotulo: 'Sonnet', esforco: 'low' },
  3: { nome: 'Normal', modelo: 'claude-sonnet-5-5', rotulo: 'Sonnet', esforco: 'medium' },
  4: { nome: 'Difícil', modelo: 'claude-opus-5-5', rotulo: 'Opus', esforco: 'medium' },
  5: { nome: 'Muito difícil', modelo: 'claude-opus-5-5', rotulo: 'Opus', esforco: 'high' },
  6: { nome: 'Ultra', modelo: 'claude-opus-5-5', rotulo: 'Opus', esforco: 'max' },
}
const NIVEL_PADRAO = 3
// A partir daqui um pedido de projeto grande vira plano (planejador + executores).
const LIMIAR_PLANO = 5

const CLASSIFICADOR = `Você faz a triagem dos pedidos de um assistente de programação. Leia o pedido e dê uma nota de dificuldade de 1 a 6, que decide qual modelo vai trabalhar nele.

1 Trivial: saudação, pergunta rápida de fato, typo, renomear algo, rodar um comando conhecido, "ok", "valeu".
2 Simples: edição pequena e clara em um arquivo, explicar um trecho curto, ajuste de texto ou estilo.
3 Normal: feature pequena, bug com causa visível, mudança em poucos arquivos, escrever um teste.
4 Difícil: mudança em vários arquivos, refatoração, bug sem causa óbvia, integrar uma API nova.
5 Muito difícil: arquitetura, bug sutil (concorrência, memória, segurança), migração grande, desempenho.
6 Ultra: sistema novo do zero com muitas partes, problema de pesquisa, decisão crítica e cara de errar.

Pedidos de continuação ("continua", "faz isso", "pode seguir", "sim") herdam a nota anterior, a não ser que peçam algo claramente mais leve ou mais pesado.
Na dúvida entre duas notas, escolha a maior.

Diga também se o pedido é um PROJETO: um escopo novo e grande que vale quebrar em várias tarefas para vários agentes (construir um sistema, uma migração grande, uma feature com muitas partes). Continuação, pergunta, ajuste, correção de bug e tarefa isolada NÃO são projeto.

Responda só com JSON, sem mais nada: {"nivel": <1-6>, "projeto": <true|false>, "motivo": "<até 12 palavras em português>"}`

const ligado = atom({ plugin: 'orquestra', key: 'ligado' } as const, true)
const atual = atom({ plugin: 'orquestra', key: 'atual' } as const, null)
const historico = atom({ plugin: 'orquestra', key: 'historico' } as const, [])
const planoAuto = atom({ plugin: 'orquestra', key: 'planoAuto' } as const, true)
const planoAtom = atom({ plugin: 'orquestra', key: 'plano' } as const, null)
const turnosAtom = atom({ plugin: 'orquestra', key: 'turnos' } as const, [])
const ferramentasAtom = atom({ plugin: 'orquestra', key: 'ferramentas' } as const, {})
const arquivosAtom = atom({ plugin: 'orquestra', key: 'arquivos' } as const, [])
const errosAtom = atom({ plugin: 'orquestra', key: 'erros' } as const, 0)
const ultimoErroAtom = atom({ plugin: 'orquestra', key: 'ultimoErro' } as const, null)
const trocasAtom = atom({ plugin: 'orquestra', key: 'trocasModelo' } as const, 0)
const usoAtom = atom({ plugin: 'orquestra', key: 'usoSessao' } as const, null)

const MARCA: Record<StatusTarefa, string> = {
  pendente: '○',
  rodando: '●',
  ok: '✓',
  erro: '✗',
  bloqueada: '⊘',
  pulada: '–',
}

function nivelValido(n: unknown): number {
  const v = Math.round(Number(n))
  return v >= 1 && v <= 6 ? v : NIVEL_PADRAO
}

function decisao(nivel: number, motivo: string, prompt: string): Decisao {
  const n = NIVEIS[nivel] ?? NIVEIS[NIVEL_PADRAO]!
  return { nivel, modelo: n.modelo, esforco: n.esforco, motivo, prompt: prompt.slice(0, 80) }
}

// Trocar de modelo joga fora o cache do contexto, então só desce de nível
// quando a queda é grande (2 ou mais); subir é sempre na hora.
export function aplicarEstabilidade(nova: Decisao, anterior: Decisao | null): Decisao {
  if (!anterior || nova.nivel >= anterior.nivel) return nova
  if (anterior.nivel - nova.nivel >= 2) return nova
  return { ...anterior, motivo: `mantido (${nova.motivo})`, prompt: nova.prompt }
}

function descreverNivel(nivel: number): string {
  const n = NIVEIS[nivel] ?? NIVEIS[NIVEL_PADRAO]!
  return `${n.rotulo} · ${n.esforco}`
}

function descrever(d: Decisao): string {
  return descreverNivel(d.nivel)
}

function progresso(p: Plano | null): string {
  if (!p) return ''
  if (p.fase === 'planejando') return ' · 📋 planejando'
  if (p.fase === 'aguardando') return ' · 📋 plano aguardando /aprovar'
  const feitas = p.tarefas.filter(t => t.status !== 'pendente' && t.status !== 'rodando').length
  return p.fase === 'executando' ? ` · 📋 ${feitas}/${p.tarefas.length}` : ''
}

async function atualizarStatus($: Ctx): Promise<void> {
  const d = await read($, atual)
  const on = await read($, ligado)
  const base = !on ? '🛎 Orquestra desligada' : d ? `🛎 ${descrever(d)} (${NIVEIS[d.nivel]!.nome})` : '🛎 Orquestra pronta'
  $.ui.status(base + progresso(await read($, planoAtom)))
}

function tabela(): string {
  return Object.entries(NIVEIS)
    .map(([k, n]) => `  ${k}. ${n.nome.padEnd(14)} ${n.rotulo} · ${n.esforco}`)
    .join('\n')
}

function listaTarefas(p: Plano): string {
  return p.tarefas
    .map(t => {
      const dep = t.depende.length ? `  (depende de ${t.depende.map(d => `#${d}`).join(', ')})` : ''
      const falha = t.status === 'erro' && t.resultado ? `  [${cortar(t.resultado, 70)}]` : ''
      return `  ${MARCA[t.status]} #${t.id} ${t.titulo} — ${descreverNivel(t.nivel)}${dep}${falha}`
    })
    .join('\n')
}

type Classificacao = { nova: Decisao; projeto: boolean }

async function classificar(
  $: Ctx,
  texto: string,
  anterior: Decisao | null,
  rotulo: 'Pedido do usuário' | 'Tarefa a executar',
): Promise<Classificacao> {
  const contexto = anterior
    ? `Nota anterior: ${anterior.nivel} (${anterior.motivo}). Pedido anterior: "${anterior.prompt}"\n\n`
    : ''
  const r = await $.model.complete({
    model: 'haiku',
    system: CLASSIFICADOR,
    prompt: `${contexto}${rotulo}:\n${texto.slice(0, 4000)}`,
    maxTokens: 150,
    effort: 'low',
    timeoutMs: 15000,
  })

  if (r.isAnswered) {
    const json = r.text.match(/\{[\s\S]*\}/)?.[0]
    let lido: { nivel?: unknown; projeto?: unknown; motivo?: unknown } = {}
    try {
      lido = json ? JSON.parse(json) : {}
    } catch {
      lido = {}
    }
    const motivo = typeof lido.motivo === 'string' ? lido.motivo.slice(0, 100) : 'sem motivo'
    return { nova: decisao(nivelValido(lido.nivel), motivo, texto), projeto: lido.projeto === true }
  }

  const nova = anterior
    ? { ...anterior, motivo: 'classificador falhou, mantido', prompt: texto.slice(0, 80) }
    : decisao(NIVEL_PADRAO, 'classificador falhou, padrão', texto)
  return { nova, projeto: false }
}

// Dá a partida nas tarefas que já podem rodar e, quando não sobra nada, fecha
// o plano e chama a revisão final na sessão principal. Cada chamada é curta:
// quem a repete é o fim de cada subagente, não um laço em segundo plano.
async function continuar($: Ctx): Promise<void> {
  let largadas: Tarefa[] = []
  let acabou = false

  await update($, planoAtom, p => {
    largadas = []
    acabou = false
    if (!p || p.fase !== 'executando') return p
    const tarefas = bloquear(p.tarefas)
    largadas = prontas(tarefas)
    const marcadas = tarefas.map(t => (largadas.some(l => l.id === t.id) ? { ...t, status: 'rodando' as const } : t))
    if (largadas.length === 0 && terminou(marcadas)) {
      acabou = true
      return { ...p, tarefas: marcadas, fase: 'pronto' as const }
    }
    return { ...p, tarefas: marcadas }
  })

  const p = await read($, planoAtom)
  if (!p) return

  let falhou = false
  for (const t of largadas) {
    const r = await $.agent.spawn({
      prompt: promptExecutor(p.objetivo, t, p.tarefas),
      description: t.titulo,
      subagentType: `orquestra:nivel-${t.nivel}`,
    })
    await update($, planoAtom, atual =>
      atual && {
        ...atual,
        tarefas: atual.tarefas.map(o =>
          o.id !== t.id
            ? o
            : r.agentId
              ? { ...o, agentId: r.agentId }
              : { ...o, status: 'erro' as const, resultado: `não iniciou: ${r.deny ?? 'sem motivo'}` },
        ),
      },
    )
    if (!r.agentId) falhou = true
  }

  await atualizarStatus($)
  if (falhou) return continuar($)
  if (acabou) enviarDepois($, { text: promptRelatorio(p.objetivo, p.tarefas) })
}

// O motor recusa um prompt enviado de dentro de um comando (ele esperaria o
// próprio turno do comando), então o envio sai num timer curto, de um evento
// à parte.
function enviarDepois($: Ctx, prompt: { text: string; asUser?: true }): void {
  void $.clock.after(50, () => {
    void $.prompt.submit(prompt)
  })
}

// Foto do uso da sessão (contexto, custo, limites) para o painel. Uma leitura
// por segundo no máximo, para não pesar a cada chamada de ferramenta.
let ultimaLeitura = 0

async function lerUso($: Ctx): Promise<void> {
  try {
    const agora = await $.clock.now()
    if (agora - ultimaLeitura < 1000) return
    ultimaLeitura = agora
    const u = await $.session.usage()
    await update($, usoAtom, () => ({
      percent: u.context.percent ?? null,
      tokens: u.context.tokens ?? null,
      janela: u.context.window,
      usd: u.cost?.usd ?? null,
      limites: u.rateLimits.map(l => ({ tipo: l.kind, percent: l.percentUsed })),
    }))
  } catch {
    // Sem leitura agora: o painel mostra o último valor.
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'orquestra',
      description: 'Orquestra de modelos: status, ligar/desligar, fixar um nível, plano automático',
      argumentHint: '[on | off | 1-6 | plano on | plano off]',
    })
    await $.command.register({
      name: 'planejar',
      description: 'Força o modo planejador para um escopo: quebra em tarefas e escolhe o modelo de cada uma',
      argumentHint: '<escopo do projeto>',
    })
    await $.command.register({
      name: 'aprovar',
      description: 'Aprova o plano e começa a executar',
      argumentHint: '[sem 2 3] [4=6]',
    })
    await $.command.register({
      name: 'painel',
      description: 'Abre o painel ao vivo da sessão: modelo, contexto, custo, turnos, plano, ferramentas e alertas',
    })
    await $.command.register({
      name: 'descartar',
      description: 'Descarta o plano atual (agentes já em andamento terminam, mas nada novo começa)',
    })

    // Um tipo de executor por nível; o modelo e o esforço ficam na definição.
    for (const [nivel, n] of Object.entries(NIVEIS)) {
      await $.agent.register({
        name: `nivel-${nivel}`,
        description: `Executor de tarefas do plano (${n.rotulo} · ${n.esforco})`,
        prompt:
          'Você executa uma tarefa de programação bem delimitada, que faz parte de um plano maior. ' +
          'Siga a descrição da tarefa, fique no escopo dela, verifique o que fez quando der (rodar o teste ou o build) e responda curto.',
        model: n.modelo,
        effort: n.esforco,
      })
    }
    await atualizarStatus($)

    return next(e)
  })

  for (const nivel of Object.keys(NIVEIS)) {
    on('agent.offer', { agent: `orquestra:nivel-${nivel}` }, () => ({ isOffered: false }))
  }

  on('command.run', { command: 'orquestra' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()

    if (arg === 'off' || arg === 'on') {
      await update($, ligado, () => arg === 'on')
      await atualizarStatus($)
      return {
        text: arg === 'on'
          ? 'Orquestra ligada: cada prompt vai escolher o modelo.'
          : 'Orquestra desligada: vale o modelo que você escolheu no app.',
      }
    }

    if (arg === 'plano on' || arg === 'plano off') {
      await update($, planoAuto, () => arg === 'plano on')
      return {
        text: arg === 'plano on'
          ? 'Plano automático ligado: projetos grandes passam pelo planejador.'
          : 'Plano automático desligado: use /planejar quando quiser um plano.',
      }
    }

    if (/^[1-6]$/.test(arg)) {
      const d = decisao(Number(arg), 'fixado por você', '')
      await update($, atual, () => d)
      await update($, ligado, () => true)
      await atualizarStatus($)
      return { text: `Próximo turno com ${descrever(d)}. O próximo prompt ainda é reavaliado; use /orquestra off para travar o modelo do app.` }
    }

    const isLigado = await read($, ligado)
    const auto = await read($, planoAuto)
    const d = await read($, atual)
    const hist = await read($, historico)
    const p = await read($, planoAtom)
    const ultimas = hist
      .slice(-8)
      .reverse()
      .map(h => `  ${descrever(h).padEnd(16)} ${h.motivo}${h.prompt ? ` — "${h.prompt}"` : ''}`)
      .join('\n')

    return {
      text: [
        `Orquestra ${isLigado ? 'ligada' : 'desligada'}. ${d ? `Agora: ${descrever(d)} (${d.motivo}).` : 'Nenhuma decisão ainda.'}`,
        `Plano automático: ${auto ? 'ligado' : 'desligado'} (projetos de nível ${LIMIAR_PLANO}+).`,
        '',
        'Níveis:',
        tabela(),
        '',
        ultimas ? `Últimas decisões:\n${ultimas}\n` : '',
        p ? `Plano (${p.fase}): ${p.objetivo || p.pedido}\n${listaTarefas(p)}\n` : '',
        'Uso: /orquestra on | off | 1-6 | plano on | plano off   ·   /planejar <escopo>',
      ].join('\n'),
    }
  })

  on('command.run', { command: 'planejar' }, async ($, e) => {
    const escopo = e.args.trim()
    if (!escopo) return { text: 'Uso: /planejar <escopo do projeto>' }

    const d = decisao(LIMIAR_PLANO, 'planejamento pedido por você', escopo)
    await update($, atual, () => d)
    await update($, ligado, () => true)
    await update($, planoAtom, () => ({ fase: 'planejando' as const, pedido: escopo, objetivo: '', tarefas: [] }))
    await atualizarStatus($)
    enviarDepois($, { text: escopo, asUser: true })

    return { text: 'Planejando: o planejador vai ler o projeto e propor as tarefas.' }
  })

  on('command.run', { command: 'aprovar' }, async ($, e) => {
    const p = await read($, planoAtom)
    if (!p || p.fase !== 'aguardando') return { text: 'Nenhum plano aguardando aprovação.' }

    const { pular, niveis } = parseAprovar(e.args)
    await update($, planoAtom, atual =>
      atual && {
        ...atual,
        fase: 'executando' as const,
        tarefas: atual.tarefas.map(t => ({
          ...t,
          status: pular.has(t.id) ? ('pulada' as const) : t.status,
          nivel: niveis.has(t.id) ? nivelValido(niveis.get(t.id)) : t.nivel,
        })),
      },
    )
    await continuar($)

    const depois = await read($, planoAtom)
    const rodando = depois?.tarefas.filter(t => t.status === 'rodando').length ?? 0
    return { text: `Plano aprovado. ${rodando} tarefa(s) em andamento; as outras entram conforme as dependências ficam prontas.` }
  })

  registrarPainel(on)

  on('command.run', { command: 'painel' }, async $ => {
    const r = await $.ui.open({ id: PAINEL_ID, title: 'Orquestra', columns: 48 })
    return { text: r.isPlaced ? 'Painel da Orquestra aberto.' : 'Nenhuma tela desenhou o painel agora (o app decide onde ele cabe).' }
  })

  on('command.run', { command: 'descartar' }, async ($) => {
    const p = await read($, planoAtom)
    if (!p) return { text: 'Não há plano para descartar.' }
    await update($, planoAtom, () => null)
    await atualizarStatus($)
    return { text: p.fase === 'executando' ? 'Plano descartado. Os agentes que já rodam terminam, mas nada novo começa.' : 'Plano descartado.' }
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.command || e.isMeta || !(await read($, ligado))) return next(e)

    const p = await read($, planoAtom)

    // O que o próprio mod enviou (/planejar, revisão final) não é reclassificado.
    if (e.origin?.kind === 'plugin') {
      return p?.fase === 'planejando' ? next({ ...e, context: [...(e.context ?? []), INSTRUCAO_PLANEJADOR] }) : next(e)
    }

    const anterior = await read($, atual)
    const { nova, projeto } = await classificar($, e.text, anterior, 'Pedido do usuário')
    let escolhida = aplicarEstabilidade(nova, anterior)

    const querPlano =
      projeto && nova.nivel >= LIMIAR_PLANO && (await read($, planoAuto)) && p?.fase !== 'executando'

    if (querPlano) {
      escolhida = nova
      await update($, planoAtom, () => ({ fase: 'planejando' as const, pedido: e.text, objetivo: '', tarefas: [] }))
    } else if (p?.fase === 'planejando') {
      await update($, planoAtom, () => null)
    }

    await update($, atual, () => escolhida)
    await update($, historico, list => [...list, escolhida].slice(-30))
    await atualizarStatus($)

    if (!anterior || anterior.modelo !== escolhida.modelo || anterior.esforco !== escolhida.esforco) {
      $.ui.toast(`🛎 ${descrever(escolhida)}: ${escolhida.motivo}`)
    }
    if (querPlano) $.ui.toast('📋 Projeto grande: o planejador vai montar o plano antes de executar.')

    return next(querPlano ? { ...e, context: [...(e.context ?? []), INSTRUCAO_PLANEJADOR] } : e)
  })

  // Enquanto planeja, o planejador só lê: nada de editar arquivo. Para o painel,
  // toda chamada de ferramenta (inclusive de executores) também é contada aqui.
  on('tool.call', async ($, e, next) => {
    const edita = e.tool === 'Edit' || e.tool === 'Write' || e.tool === 'NotebookEdit'
    if (edita && e.agentId === undefined && (await read($, planoAtom))?.fase === 'planejando') {
      return { deny: 'Modo planejador: não edite arquivos agora. Termine o plano com <plano>…</plano>; a execução vem depois da aprovação.' }
    }

    const nome = String(e.tool)
    const caminho =
      e.tool === 'Edit' || e.tool === 'Write' ? e.file_path : e.tool === 'NotebookEdit' ? e.notebook_path : undefined

    const r = await next(e)

    await update($, ferramentasAtom, c => ({ ...c, [nome]: (c[nome] ?? 0) + 1 }))
    if (caminho && !r.deny) {
      await update($, arquivosAtom, l => [caminho, ...l.filter(o => o !== caminho)].slice(0, 30))
    }
    if (!r.deny && r.isError) {
      await update($, errosAtom, n => n + 1)
      await update($, ultimoErroAtom, o => ({ tool: nome, seguidos: o?.tool === nome ? o.seguidos + 1 : 1 }))
    } else if (!r.deny) {
      await update($, ultimoErroAtom, o => (o?.tool === nome ? null : o))
    }
    await lerUso($)

    return r
  })

  // Toda chamada do turno principal sai com o modelo e o esforço escolhidos;
  // os executores têm o deles na definição do agente.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined || !(await read($, ligado))) return yield* next(e)
    const d = await read($, atual)
    if (!d) return yield* next(e)

    return yield* next({ ...e, model: d.modelo, effort: d.esforco })
  })

  on('turn.complete', async ($, e, next) => {
    const resposta = await next(e)

    // Para o painel: o que este turno custou, e se o modelo mudou desde o turno anterior.
    if (e.usage) {
      const agente = e.agentId !== undefined
      const usage = e.usage
      const ts = await $.clock.now().catch(() => 0)
      let trocou = false
      await update($, turnosAtom, lista => {
        const anterior = [...lista].reverse().find(t => !t.agente)
        const turno = novoTurno((lista[lista.length - 1]?.n ?? 0) + 1, usage, ts, agente)
        trocou = !agente && anterior !== undefined && anterior.modelo !== turno.modelo
        return [...lista, turno].slice(-200)
      })
      if (trocou) await update($, trocasAtom, n => n + 1)
    }
    ultimaLeitura = 0
    await lerUso($)

    // Fim de um executor: registra, libera o que dependia dele, quem sabe fecha.
    if (e.agentId !== undefined) {
      let achou = false
      await update($, planoAtom, p => {
        achou = false
        if (!p) return p
        return {
          ...p,
          tarefas: p.tarefas.map(t => {
            if (t.agentId !== e.agentId) return t
            achou = true
            const ok = e.reason === 'answer'
            return { ...t, status: ok ? ('ok' as const) : ('erro' as const), resultado: ok ? cortar(e.answer, 1500) : `terminou com ${e.reason}` }
          }),
        }
      })
      if (achou) await continuar($)
      return resposta
    }

    // Fim do turno do planejador: lê o plano, dá a nota de cada tarefa, pede o ok.
    const p = await read($, planoAtom)
    if (!p || p.fase !== 'planejando') return resposta

    const parsed = e.reason === 'answer' ? parsePlano(e.answer) : null
    if (!parsed) {
      // Perguntou algo, abortou ou não deu plano legível: volta ao normal.
      await update($, planoAtom, () => null)
      await atualizarStatus($)
      return resposta
    }

    const notas = await Promise.all(
      parsed.tarefas.map(t => classificar($, `${t.titulo}\n${t.descricao}`, null, 'Tarefa a executar')),
    )
    const plano: Plano = {
      fase: 'aguardando',
      pedido: p.pedido,
      objetivo: parsed.objetivo,
      tarefas: parsed.tarefas.map((t, i) => ({ ...t, nivel: notas[i]!.nova.nivel, status: 'pendente' as const })),
    }
    await update($, planoAtom, () => plano)
    await atualizarStatus($)

    return {
      ...resposta,
      text: [
        `📋 Plano${plano.objetivo ? `: ${plano.objetivo}` : ''}`,
        listaTarefas(plano),
        '',
        '/aprovar executa tudo · /aprovar sem 2 3 pula tarefas · /aprovar 4=6 muda a tarefa 4 para o nível 6 · /descartar cancela',
      ].join('\n'),
    }
  })
}
