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

declare module 'claude-code' {
  interface PluginState {
    orquestra: {
      ligado: boolean
      atual: Decisao | null
      historico: Decisao[]
      planoAuto: boolean
      plano: Plano | null
    }
  }
}
