import { expect, mock, test } from 'claude-code/testing'

const USO = { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-sonnet-5-5' }

function uso(percent: number) {
  return { startedAt: 0, context: { window: 1_000_000, percent, tokens: percent * 10_000, usd: 0 }, rateLimits: [] }
}

test('compacta sozinha ao passar de 65%, uma vez por subida', async ($, on) => {
  const relogio = mock.clock(on)
  let percent = 50
  const compactacoes: (string | undefined)[] = []

  on('session.usage', () => ({ value: uso(percent) }))
  on('session.compact', (_$, e) => {
    compactacoes.push(e.instructions)
    return { skip: 'teste' }
  })
  on('turn.complete', ($, e) => ({ text: e.answer }))

  const fim = async (n: number, agentId?: string) => {
    await $.turn.complete({ turnId: `t${n}`, agentId, answer: 'ok', durationMs: 1, isAborted: false, reason: 'answer', usage: USO })
    await relogio.advance(2000)
  }

  await fim(1)
  expect(compactacoes.length).toBe(0)

  // 64%: ainda abaixo do limite.
  percent = 64
  await fim(2)
  expect(compactacoes.length).toBe(0)

  // 66%: dispara, com as instruções de manter plano, decisões e arquivos.
  percent = 66
  await fim(3)
  expect(compactacoes.length).toBe(1)
  expect(compactacoes[0]).toContain('plano')
  expect(compactacoes[0]).toContain('arquivos')

  // Continua alto: não pede de novo.
  percent = 70
  await fim(4)
  expect(compactacoes.length).toBe(1)

  // Executor não dispara compactação, mesmo com o contexto alto.
  await fim(5, 'agente-1')
  expect(compactacoes.length).toBe(1)

  // Depois de cair bem abaixo e subir de novo, volta a valer.
  percent = 20
  await fim(6)
  percent = 67
  await fim(7)
  expect(compactacoes.length).toBe(2)
})

test('/orquestra compactar off desliga e /orquestra compactar 80 muda o limite', async ($, on) => {
  const relogio = mock.clock(on)
  let percent = 70
  let chamadas = 0
  on('session.usage', () => ({ value: uso(percent) }))
  on('session.compact', () => {
    chamadas++
    return { skip: 'teste' }
  })
  on('turn.complete', ($, e) => ({ text: e.answer }))

  const fim = async (n: number) => {
    await $.turn.complete({ turnId: `t${n}`, answer: 'ok', durationMs: 1, isAborted: false, reason: 'answer', usage: USO })
    await relogio.advance(2000)
  }

  const off = await $.command.run({ command: 'orquestra', args: 'compactar off' })
  expect(JSON.stringify(off)).toContain('desligada')
  await fim(1)
  expect(chamadas).toBe(0)

  const alto = await $.command.run({ command: 'orquestra', args: 'compactar 80' })
  expect(JSON.stringify(alto)).toContain('80%')
  await fim(2)
  expect(chamadas).toBe(0)

  percent = 82
  await fim(3)
  expect(chamadas).toBe(1)

  const ruim = await $.command.run({ command: 'orquestra', args: 'compactar 99' })
  expect(JSON.stringify(ruim)).toContain('entre 10 e 95')
})
