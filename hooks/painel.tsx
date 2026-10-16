import { atom, read } from 'claude-code'
import type { Register } from 'claude-code'

import type { StatusTarefa } from '../types'
import { ROTULO, agregarPorModelo, alertas, custoTotal, economiaEstimada, familia, pct, serieTurnos, usd } from './painel-dados'
import type { Familia } from './painel-dados'

type On = Parameters<Register>[0]

export const PAINEL_ID = 'orquestra-painel'

const turnosAtom = atom({ plugin: 'orquestra', key: 'turnos' } as const, [])
const ferramentasAtom = atom({ plugin: 'orquestra', key: 'ferramentas' } as const, {})
const arquivosAtom = atom({ plugin: 'orquestra', key: 'arquivos' } as const, [])
const errosAtom = atom({ plugin: 'orquestra', key: 'erros' } as const, 0)
const ultimoErroAtom = atom({ plugin: 'orquestra', key: 'ultimoErro' } as const, null)
const trocasAtom = atom({ plugin: 'orquestra', key: 'trocasModelo' } as const, 0)
const usoAtom = atom({ plugin: 'orquestra', key: 'usoSessao' } as const, null)
const atualAtom = atom({ plugin: 'orquestra', key: 'atual' } as const, null)
const planoAtom = atom({ plugin: 'orquestra', key: 'plano' } as const, null)

// Cor identifica o modelo, mas todo bloco também leva o nome por escrito.
const COR: Record<Familia, string> = { haiku: '#1D9E75', sonnet: '#7F77DD', opus: '#D85A30', outro: '#888780' }
const MARCA: Record<StatusTarefa, string> = { pendente: '○', rodando: '●', ok: '✓', erro: '✗', bloqueada: '⊘', pulada: '–' }
const NIVEIS_BLOCO = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']
const LIMIAR_COMPACTAR = 70

// Barra de texto com uma marca "│" no ponto em que a sessão compacta.
function barra(percent: number | null, largura: number): { cheio: string; vazio: string } {
  const n = Math.max(10, largura)
  const feito = Math.max(0, Math.min(n, Math.round((n * (percent ?? 0)) / 100)))
  const marca = Math.min(n - 1, Math.round((n * LIMIAR_COMPACTAR) / 100))
  const chars = Array.from({ length: n }, (_, i) => (i === marca ? '│' : i < feito ? '█' : '░'))
  return { cheio: chars.slice(0, feito).join(''), vazio: chars.slice(feito).join('') }
}

function milhares(v: number | null): string {
  if (v === null) return '—'
  return v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1).replace('.', ',')} mi` : v >= 1000 ? `${Math.round(v / 1000)} mil` : String(v)
}

export function registrarPainel(on: On): void {
  on('ui.render', { component: 'Pane', requestId: PAINEL_ID }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)

    const turnos = await read($, turnosAtom)
    const ferramentas = await read($, ferramentasAtom)
    const arquivos = await read($, arquivosAtom)
    const erros = await read($, errosAtom)
    const ultimoErro = await read($, ultimoErroAtom)
    const trocas = await read($, trocasAtom)
    const uso = await read($, usoAtom)
    const atual = await read($, atualAtom)
    const plano = await read($, planoAtom)

    const larg = Math.max(24, (e.props.bodyColumns ?? 48) - 2)
    const principais = turnos.filter(t => !t.agente)
    const ultimo = principais[principais.length - 1]
    const fam: Familia | null = ultimo ? familia(ultimo.modelo) : null
    const economia = economiaEstimada(turnos)
    const porModelo = agregarPorModelo(turnos)
    const total = custoTotal(turnos)
    const serie = serieTurnos(turnos, Math.min(40, larg))
    const alertasAgora = alertas({ turnos, ultimoErro, uso })
    const topFerramentas = Object.entries(ferramentas)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
    const ctx = barra(uso?.percent ?? null, larg)
    const limite = uso?.limites.reduce((m, l) => Math.max(m, l.percent), 0) ?? null

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text bold>Atendendo agora</Text>
          {fam ? (
            <Text>
              <Text bold color={COR[fam]}>{ROTULO[fam]}</Text>
              {atual ? <Text dimColor> · esforço {atual.esforco} · nota {atual.nivel}</Text> : null}
            </Text>
          ) : (
            <Text dimColor>Ainda sem turnos nesta sessão.</Text>
          )}
          <Text>
            Custo <Text bold>{usd(uso?.usd ?? (turnos.length ? total : null))}</Text>
            <Text dimColor> · limite de uso {pct(limite)}</Text>
          </Text>
          <Text>
            Economia{' '}
            {economia === null ? (
              <Text dimColor>calculando (precisa de 3 turnos)</Text>
            ) : (
              <Text bold color="success">~{Math.round(economia * 100)}% <Text dimColor>estimada, vs. tudo no Opus</Text></Text>
            )}
          </Text>
        </Box>

        <Box flexDirection="column">
          <Text bold>Janela de contexto</Text>
          <Text>
            <Text color="claude">{ctx.cheio}</Text>
            <Text dimColor>{ctx.vazio}</Text>
          </Text>
          <Text dimColor>
            {pct(uso?.percent)} · {milhares(uso?.tokens ?? null)} de {milhares(uso?.janela ?? null)} tokens · · │ marca {LIMIAR_COMPACTAR}%
          </Text>
        </Box>

        <Box flexDirection="column">
          <Text bold>Gasto por modelo</Text>
          {porModelo.length === 0 ? (
            <Text dimColor>Nada ainda.</Text>
          ) : (
            <Box flexDirection="column">
              <Box flexDirection="row">
                {porModelo.map(m => (
                  <Text color={COR[m.fam]}>{'█'.repeat(Math.max(1, Math.round((larg * (total > 0 ? m.custo / total : 1 / porModelo.length)))))}</Text>
                ))}
              </Box>
              {porModelo.map(m => (
                <Text>
                  <Text color={COR[m.fam]}>■</Text> {ROTULO[m.fam]} <Text bold>{usd(m.custo)}</Text>
                  <Text dimColor> · {m.turnos} {m.turnos === 1 ? 'turno' : 'turnos'}</Text>
                </Text>
              ))}
            </Box>
          )}
        </Box>

        <Box flexDirection="column">
          <Text bold>Turnos (altura = tokens, cor = modelo)</Text>
          {serie.length === 0 ? (
            <Text dimColor>Nada ainda.</Text>
          ) : (
            <Box flexDirection="row">
              {serie.map(b => (
                <Text color={COR[b.fam]} dimColor={b.agente}>{NIVEIS_BLOCO[Math.min(7, Math.floor(b.altura * 8))] ?? '▁'}</Text>
              ))}
            </Box>
          )}
          <Text dimColor>
            {trocas} {trocas === 1 ? 'troca' : 'trocas'} de modelo · executores aparecem esmaecidos
          </Text>
        </Box>

        {plano ? (
          <Box flexDirection="column">
            <Text bold>
              Plano · {plano.fase} · {plano.tarefas.filter(t => t.status === 'ok').length}/{plano.tarefas.length}
            </Text>
            {plano.tarefas.length === 0 ? (
              <Text dimColor>{plano.fase === 'planejando' ? 'O planejador está lendo o projeto.' : 'Sem tarefas.'}</Text>
            ) : (
              plano.tarefas.map(t => (
                <Text dimColor={t.status === 'pendente' || t.status === 'pulada'}>
                  {MARCA[t.status]} #{t.id} {t.titulo}
                  <Text dimColor> · nível {t.nivel}</Text>
                </Text>
              ))
            )}
          </Box>
        ) : null}

        <Box flexDirection="column">
          <Text bold>Ferramentas</Text>
          {topFerramentas.length === 0 ? (
            <Text dimColor>Nenhuma ainda.</Text>
          ) : (
            <Text>
              {topFerramentas.map(([n, c]) => `${n} ${c}`).join(' · ')}
              <Text color={erros > 0 ? 'error' : undefined} dimColor={erros === 0}> · {erros} {erros === 1 ? 'erro' : 'erros'}</Text>
            </Text>
          )}
          <Text dimColor>
            {arquivos.length === 0 ? 'Nenhum arquivo editado.' : `${arquivos.length} arquivos editados: ${arquivos.slice(0, 3).map(a => a.split(/[\\/]/).pop()).join(', ')}${arquivos.length > 3 ? '…' : ''}`}
          </Text>
        </Box>

        <Box flexDirection="column">
          <Text bold>Alertas</Text>
          {alertasAgora.length === 0 ? (
            <Text dimColor>Tudo calmo.</Text>
          ) : (
            alertasAgora.map(a => <Text color={a.nivel === 'critico' ? 'error' : 'warning'}>▲ {a.texto}</Text>)
          )}
        </Box>
      </Box>
    )
  })
}
