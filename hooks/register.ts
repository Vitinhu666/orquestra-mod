import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Decisao, Esforco } from '../types'

type Ctx = EngineInterface

// Os oito níveis: edite aqui para mudar quem atende cada um.
const NIVEIS: Record<number, { nome: string; modelo: string; rotulo: string; esforco: Esforco }> = {
  1: { nome: 'Trivial', modelo: 'claude-haiku-5-5', rotulo: 'Haiku', esforco: 'low' },
  2: { nome: 'Simples', modelo: 'claude-haiku-5-5', rotulo: 'Haiku', esforco: 'medium' },
  3: { nome: 'Simples+', modelo: 'claude-haiku-5-5', rotulo: 'Haiku', esforco: 'high' },
  4: { nome: 'Normal leve', modelo: 'claude-sonnet-5-5', rotulo: 'Sonnet', esforco: 'low' },
  5: { nome: 'Normal', modelo: 'claude-sonnet-5-5', rotulo: 'Sonnet', esforco: 'medium' },
  6: { nome: 'Difícil', modelo: 'claude-sonnet-5-5', rotulo: 'Sonnet', esforco: 'high' },
  7: { nome: 'Muito difícil', modelo: 'claude-opus-5-5', rotulo: 'Opus', esforco: 'medium' },
  8: { nome: 'Crítico', modelo: 'claude-opus-5-5', rotulo: 'Opus', esforco: 'high' },
}
const NIVEL_PADRAO = 5

// Modelos que dá para fixar à mão (/orquestra fixar <modelo> <esforço>), inclusive em xhigh e max.
const MODELOS_FIXAVEIS: Record<string, { modelo: string; rotulo: string }> = {
  haiku: { modelo: 'claude-haiku-5-5', rotulo: 'Haiku' },
  sonnet: { modelo: 'claude-sonnet-5-5', rotulo: 'Sonnet' },
  opus: { modelo: 'claude-opus-5-5', rotulo: 'Opus' },
}
const ESFORCOS: Esforco[] = ['low', 'medium', 'high', 'xhigh', 'max']

const CLASSIFICADOR = `Você faz a triagem dos pedidos de um assistente de programação. Leia o pedido e dê uma nota de 1 a 8, que decide qual modelo e qual esforço vão trabalhar nele. A escada sobe primeiro o esforço do modelo mais barato e só depois troca de modelo:

1 Haiku low: saudação, "ok", "valeu", pergunta rápida de fato, rodar um comando conhecido.
2 Haiku medium: typo, renomear algo, edição pequena e óbvia em um arquivo, explicar um trecho curto.
3 Haiku high: ajuste pequeno que pede um pouco de atenção (texto, estilo, config, um teste simples).
4 Sonnet low: feature pequena e clara, bug com causa visível, mudança em poucos arquivos.
5 Sonnet medium: feature média, bug que pede investigação, escrever vários testes.
6 Sonnet high: mudança em vários arquivos, refatoração, bug sem causa óbvia, integrar uma API nova.
7 Opus medium: só para o MUITO difícil: arquitetura, bug sutil (concorrência, memória, segurança), migração grande, desempenho.
8 Opus high: crítico: sistema novo do zero com muitas partes, decisão cara de errar, problema de pesquisa.

Regras:
- Escolha o nível mais barato que resolve BEM o pedido. Se o Sonnet em high dá conta, use 6, não 7.
- Opus (7 e 8) só quando o pedido é de fato muito difícil. Tamanho do texto do pedido não é dificuldade.
- Na dúvida entre duas notas vizinhas do mesmo modelo, escolha a maior. Na dúvida entre trocar ou não de modelo, fique no mais barato com o esforço mais alto.
- Pedidos de continuação ("continua", "faz isso", "pode seguir", "sim") herdam a nota anterior, a não ser que peçam algo claramente mais leve ou mais pesado.

Responda só com JSON, sem mais nada: {"nivel": <1-8>, "motivo": "<até 12 palavras em português>"}`

const ligado = atom({ plugin: 'orquestra', key: 'ligado' } as const, true)
const atual = atom({ plugin: 'orquestra', key: 'atual' } as const, null)
const historico = atom({ plugin: 'orquestra', key: 'historico' } as const, [])
const fixoAtom = atom({ plugin: 'orquestra', key: 'fixo' } as const, null)

function nivelValido(n: unknown): number {
  const v = Math.round(Number(n))
  return v >= 1 && v <= 8 ? v : NIVEL_PADRAO
}

function decisao(nivel: number, motivo: string, prompt: string): Decisao {
  const n = NIVEIS[nivel]!
  return { nivel, modelo: n.modelo, esforco: n.esforco, motivo, prompt: prompt.slice(0, 80) }
}

// Trocar de modelo joga fora o cache do contexto, então só desce de nível
// quando a queda é grande (2 ou mais); subir é sempre na hora.
function aplicarEstabilidade(nova: Decisao, anterior: Decisao | null): Decisao {
  if (!anterior || nova.nivel >= anterior.nivel) return nova
  if (anterior.nivel - nova.nivel >= 2) return nova
  return { ...anterior, motivo: `mantido (${nova.motivo})`, prompt: nova.prompt }
}

function descrever(d: Decisao): string {
  const n = NIVEIS[d.nivel]!
  return `${n.rotulo} · ${n.esforco}`
}

async function atualizarStatus($: Ctx): Promise<void> {
  const d = await read($, atual)
  const on = await read($, ligado)
  const fixo = await read($, fixoAtom)
  $.ui.status(
    !on
      ? '🛎 Orquestra OFF · modo manual: vale o que você escolher'
      : fixo
        ? `🛎 fixado: ${fixo.rotulo} · ${fixo.esforco}`
        : d
          ? `🛎 ${descrever(d)} (${NIVEIS[d.nivel]!.nome})`
          : '🛎 Orquestra pronta',
  )
}

function tabela(): string {
  return Object.entries(NIVEIS)
    .map(([k, n]) => `  ${k}. ${n.nome.padEnd(14)} ${n.rotulo} · ${n.esforco}`)
    .join('\n')
}

async function classificar($: Ctx, texto: string, anterior: Decisao | null): Promise<Decisao> {
  const contexto = anterior
    ? `Nota anterior: ${anterior.nivel} (${anterior.motivo}). Pedido anterior: "${anterior.prompt}"\n\n`
    : ''
  const r = await $.model.complete({
    model: 'haiku',
    system: CLASSIFICADOR,
    prompt: `${contexto}Pedido do usuário:\n${texto.slice(0, 4000)}`,
    maxTokens: 150,
    effort: 'low',
    timeoutMs: 15000,
  })

  if (r.isAnswered) {
    const json = r.text.match(/\{[\s\S]*\}/)?.[0]
    let lido: { nivel?: unknown; motivo?: unknown } = {}
    try {
      lido = json ? JSON.parse(json) : {}
    } catch {
      lido = {}
    }
    const motivo = typeof lido.motivo === 'string' ? lido.motivo.slice(0, 100) : 'sem motivo'
    return decisao(nivelValido(lido.nivel), motivo, texto)
  }

  return anterior
    ? { ...anterior, motivo: 'classificador falhou, mantido', prompt: texto.slice(0, 80) }
    : decisao(NIVEL_PADRAO, 'classificador falhou, padrão', texto)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'orquestra',
      description: 'Orquestra de modelos: status, ligar/desligar, fixar modelo e esforço',
      argumentHint: '[on | off | fixar <modelo> <esforço> | auto]',
    })
    await atualizarStatus($)
    return next(e)
  })

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

    // Fixar à mão: vale para todos os turnos até /orquestra auto. É o único jeito de usar xhigh e max.
    if (arg === 'fixar' || arg.startsWith('fixar ')) {
      const [, modeloNome = '', esforcoNome = 'high'] = arg.split(/\s+/)
      const m = MODELOS_FIXAVEIS[modeloNome]
      const esforco = ESFORCOS.find(x => x === esforcoNome)
      if (!m || !esforco) {
        return { text: `Uso: /orquestra fixar <${Object.keys(MODELOS_FIXAVEIS).join('|')}> <${ESFORCOS.join('|')}>, por exemplo /orquestra fixar opus max. /orquestra auto volta ao automático.` }
      }
      await update($, fixoAtom, () => ({ modelo: m.modelo, rotulo: m.rotulo, esforco }))
      await update($, ligado, () => true)
      await atualizarStatus($)
      return { text: `Fixado em ${m.rotulo} · ${esforco} para todos os turnos, sem triagem. /orquestra auto volta ao automático.` }
    }

    if (arg === 'auto') {
      await update($, fixoAtom, () => null)
      await update($, ligado, () => true)
      await atualizarStatus($)
      return { text: 'Automático de novo: cada prompt volta a passar pela triagem.' }
    }

    const isLigado = await read($, ligado)
    const fixo = await read($, fixoAtom)
    const d = await read($, atual)
    const hist = await read($, historico)
    const ultimas = hist
      .slice(-8)
      .reverse()
      .map(h => `  ${descrever(h).padEnd(16)} ${h.motivo}${h.prompt ? ` — "${h.prompt}"` : ''}`)
      .join('\n')

    return {
      text: [
        `Orquestra ${isLigado ? 'ligada' : 'desligada'}. ${fixo ? `FIXADA em ${fixo.rotulo} · ${fixo.esforco} (sem triagem; /orquestra auto volta ao automático).` : d ? `Agora: ${descrever(d)} (${d.motivo}).` : 'Nenhuma decisão ainda.'}`,
        '',
        'Níveis:',
        tabela(),
        '',
        ultimas ? `Últimas decisões:\n${ultimas}\n` : '',
        'xhigh e max não entram no automático: use /orquestra fixar <haiku|sonnet|opus> <low|medium|high|xhigh|max>.',
        'Uso: /orquestra on | off | fixar <modelo> <esforço> | auto',
      ].join('\n'),
    }
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.command || e.isMeta || !(await read($, ligado))) return next(e)

    // Fixado à mão: sem triagem (e sem a chamada ao Haiku).
    if (await read($, fixoAtom)) return next(e)

    const anterior = await read($, atual)
    const nova = await classificar($, e.text, anterior)
    const escolhida = aplicarEstabilidade(nova, anterior)

    await update($, atual, () => escolhida)
    await update($, historico, list => [...list, escolhida].slice(-30))
    await atualizarStatus($)

    if (!anterior || anterior.modelo !== escolhida.modelo || anterior.esforco !== escolhida.esforco) {
      $.ui.toast(`🛎 ${descrever(escolhida)}: ${escolhida.motivo}`)
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  // Toda chamada do turno principal sai com o modelo e o esforço escolhidos;
  // subagentes ficam com o modelo deles.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) return yield* next(e)

    // Opus em xhigh ou max escolhido no app é uma decisão sua: a orquestra sai de cena.
    if (e.model === 'claude-opus-5-5' && (e.effort === 'xhigh' || e.effort === 'max') && (await read($, ligado))) {
      await update($, ligado, () => false)
      await atualizarStatus($)
      $.ui.toast(`🛎 Orquestra OFF: você escolheu Opus · ${e.effort}. Modo manual: vale o que você escolher no app. /orquestra on liga de novo.`)
    }

    if (!(await read($, ligado))) return yield* next(e)
    const fixo = await read($, fixoAtom)
    if (fixo) return yield* next({ ...e, model: fixo.modelo, effort: fixo.esforco })
    const d = await read($, atual)
    if (!d) return yield* next(e)

    return yield* next({ ...e, model: d.modelo, effort: d.esforco })
  })
}
