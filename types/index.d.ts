export type Esforco = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export type Decisao = {
  nivel: number
  modelo: string
  esforco: Esforco
  motivo: string
  prompt: string
}

// Modelo e esforço escolhidos à mão; enquanto existir, a triagem não roda.
export type Fixo = { modelo: string; rotulo: string; esforco: Esforco }

declare module 'claude-code' {
  interface PluginState {
    orquestra: {
      ligado: boolean
      atual: Decisao | null
      historico: Decisao[]
      fixo: Fixo | null
      curto: boolean
      saida: boolean
    }
  }
}
