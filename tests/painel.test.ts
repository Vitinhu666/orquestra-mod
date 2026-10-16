import { expect, test } from 'claude-code/testing'

const PANE = {
  component: 'Pane',
  requestId: 'orquestra-painel',
  props: {
    title: 'Orquestra',
    isFocused: false,
    bodyColumns: 48,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
  },
} as const

const SUPERFICIES = ['terminal', 'desktop'] as const

function usage(model: string, input_tokens: number, output_tokens: number) {
  return { model, input_tokens, output_tokens, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
}

test('sem dados, o painel mostra as mensagens vazias em todas as superfícies', async $ => {
  for (const surface of SUPERFICIES) {
    const ui = await $.ui.mount({ plugin: 'orquestra', surface, ...PANE })
    expect(await ui.find({ text: /Atendendo agora/ })).toBeDefined()
    expect(await ui.find({ text: /Ainda sem turnos/ })).toBeDefined()
    expect(await ui.find({ text: /Janela de contexto/ })).toBeDefined()
    expect(await ui.find({ text: /Nenhuma ainda/ })).toBeDefined()
    expect(await ui.find({ text: /Tudo calmo/ })).toBeDefined()
    await ui.unmount()
  }
})

test('o painel conta turnos por modelo, ferramentas, erros e arquivos', async ($, on) => {
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('tool.call', ($, e) =>
    e.tool === 'Bash'
      ? { result: { stdout: '', stderr: 'boom', interrupted: false }, isError: true }
      : { result: { type: 'create', filePath: 'C:/x/src/app.ts', content: '', structuredPatch: [], originalFile: null } },
  )

  const fim = (n: number, model: string, ent: number, sai: number, agentId?: string) =>
    $.turn.complete({ turnId: `t${n}`, agentId, answer: 'ok', durationMs: 1, isAborted: false, reason: 'answer', usage: usage(model, ent, sai) })

  await fim(1, 'claude-haiku-5-5', 1000, 200)
  await fim(2, 'claude-sonnet-5-5', 4000, 900)
  await fim(3, 'claude-opus-5-5', 8000, 2000)
  await fim(4, 'claude-sonnet-5-5', 3000, 500, 'agente-1')
  await $.tool.call({ tool: 'Write', file_path: 'C:/x/src/app.ts', content: '' })
  await $.tool.call({ tool: 'Bash', command: 'false' })
  await $.tool.call({ tool: 'Bash', command: 'false' })

  for (const surface of SUPERFICIES) {
    const ui = await $.ui.mount({ plugin: 'orquestra', surface, ...PANE })
    expect(await ui.find({ text: /Opus/ })).toBeDefined()
    expect(await ui.find({ text: /Haiku/ })).toBeDefined()
    expect(await ui.find({ text: /Sonnet/ })).toBeDefined()
    expect(await ui.find({ text: /2 turnos/ })).toBeDefined()
    expect(await ui.find({ text: /Write 1/ })).toBeDefined()
    expect(await ui.find({ text: /Bash 2/ })).toBeDefined()
    expect(await ui.find({ text: /2 erros/ })).toBeDefined()
    expect(await ui.find({ text: /app\.ts/ })).toBeDefined()
    expect(await ui.find({ text: /Bash falhou 2x/ })).toBeDefined()
    expect(await ui.find({ text: /Economia/ })).toBeDefined()
    await ui.unmount()
  }
})

test('o painel mostra o que cada agente está fazendo', async ($, on) => {
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('tool.call', () => ({ result: { type: 'create', filePath: 'C:/x/src/app.ts', content: '', structuredPatch: [], originalFile: null } }))

  for (const surface of SUPERFICIES) {
    const vazio = await $.ui.mount({ plugin: 'orquestra', surface, ...PANE })
    expect(await vazio.find({ text: /Nenhum agente ainda/ })).toBeDefined()
    await vazio.unmount()
  }

  await $.tool.call({ tool: 'Write', file_path: 'C:/x/src/app.ts', content: '' })
  await $.turn.complete({ turnId: 'a', agentId: 'agente-7', answer: 'feito', durationMs: 1, isAborted: false, reason: 'answer', usage: usage('claude-haiku-5-5', 100, 50) })

  for (const surface of SUPERFICIES) {
    const ui = await $.ui.mount({ plugin: 'orquestra', surface, ...PANE })
    expect(await ui.find({ text: /Agentes/ })).toBeDefined()
    expect(await ui.find({ text: /Principal/ })).toBeDefined()
    expect(await ui.find({ text: /Write app\.ts/ })).toBeDefined()
    expect(await ui.find({ text: /1 ferramenta/ })).toBeDefined()
    expect(await ui.find({ text: /Haiku/ })).toBeDefined()
    await ui.unmount()
  }
})
