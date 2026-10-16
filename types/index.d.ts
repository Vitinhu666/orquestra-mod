export type Esforco = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export type Decisao = {
  nivel: number
  modelo: string
  esforco: Esforco
  motivo: string
  prompt: string
}

export type StatusTarefa = 'pendente' | 'rodando' | 'ok' | 'erro' | 'bloqueada' | 'pulada'

export type Tarefa = {
  id: string
  titulo: string
  descricao: string
  depende: string[]
  arquivos: string[]
  nivel: number
  status: StatusTarefa
  agentId?: string
  resultado?: string
}

export type FasePlano = 'planejando' | 'aguardando' | 'executando' | 'pronto'

export type Plano = {
  fase: FasePlano
  pedido: string
  objetivo: string
  tarefas: Tarefa[]
}

// Um turno da conversa (principal ou de um executor), com o que a API cobrou.
export type Turno = {
  n: number
  modelo: string
  ent: number
  sai: number
  cl: number
  ce: number
  tokens: number
  custo: number
  ts: number
  agente: boolean
}

export type UsoSessao = {
  percent: number | null
  tokens: number | null
  janela: number
  usd: number | null
  limites: { tipo: string; percent: number }[]
}

export type UltimoErro = { tool: string; seguidos: number }

// Modelo e esforço escolhidos à mão; enquanto existir, a triagem não roda.
export type Fixo = { modelo: string; rotulo: string; esforco: Esforco }

// Compactação automática: liga/desliga e o percentual do contexto que dispara.
export type Compactar = { ligado: boolean; limiar: number; ultima: number | null }

// Um agente da sessão: a conversa principal ("principal") ou um subagente.
export type Agente = {
  id: string
  nome: string
  tipo: string
  modelo: string
  status: 'rodando' | 'ok' | 'erro'
  acao: string
  ferramentas: number
  // Última vez que o agente fez algo (ferramenta, início ou fim).
  visto: number
  inicio: number
  fim?: number
}

declare module 'claude-code' {
  interface PluginState {
    orquestra: {
      ligado: boolean
      atual: Decisao | null
      historico: Decisao[]
      planoAuto: boolean
      plano: Plano | null
      turnos: Turno[]
      ferramentas: Record<string, number>
      arquivos: string[]
      erros: number
      ultimoErro: UltimoErro | null
      trocasModelo: number
      usoSessao: UsoSessao | null
      agentes: Agente[]
      compactar: Compactar
      fixo: Fixo | null
    }
  }
}
