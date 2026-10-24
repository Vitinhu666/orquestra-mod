// Enxuga a saída de um comando antes de ela entrar no contexto do modelo.
// Sem perda de informação útil: tira cores e barras de progresso, junta linhas
// repetidas e, se ainda for grande, guarda só o começo e o fim.

const MAX_LINHAS = 150
const MAX_CHARS = 10_000

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g

export function comprimir(texto: string): string {
  // Barra de progresso reescreve a mesma linha com \r: vale só o último estado.
  const limpas = texto
    .replace(ANSI, '')
    .split('\n')
    .map(l => (l.split('\r').pop() ?? '').trimEnd())

  // Junta linhas iguais seguidas e linhas em branco seguidas.
  const linhas: string[] = []
  for (let i = 0; i < limpas.length; ) {
    let j = i
    while (j + 1 < limpas.length && limpas[j + 1] === limpas[i]) j++
    const vezes = j - i + 1
    if (limpas[i] === '') {
      if (linhas[linhas.length - 1] !== '') linhas.push('')
    } else {
      linhas.push(vezes > 2 ? `${limpas[i]}  [repetida ${vezes}x]` : Array(vezes).fill(limpas[i]).join('\n'))
    }
    i = j + 1
  }

  let saida = linhas.join('\n').replace(/\n+$/, texto.endsWith('\n') ? '\n' : '')
  const total = saida.split('\n').length

  if (total > MAX_LINHAS) {
    const todas = saida.split('\n')
    const metade = MAX_LINHAS / 2
    const omitidas = total - MAX_LINHAS
    saida = [...todas.slice(0, metade), marca(`${omitidas} linhas`), ...todas.slice(-metade)].join('\n')
  }

  if (saida.length > MAX_CHARS) {
    const inicio = Math.floor(MAX_CHARS * 0.6)
    const fim = MAX_CHARS - inicio
    saida = `${saida.slice(0, inicio)}\n${marca(`${saida.length - MAX_CHARS} caracteres`)}\n${saida.slice(-fim)}`
  }

  return saida.length < texto.length ? saida : texto
}

function marca(o_que: string): string {
  return `[… ${o_que} omitidas pela orquestra; rode de novo com grep, head ou tail se precisar delas …]`
}
