# orquestra

Plugin para o Claude Code que escolhe sozinho **qual modelo e qual esforço** usar em cada pedido, para você não gastar Opus no que o Haiku resolve. Em projeto grande, ele planeja, divide em tarefas e manda um executor por tarefa com o modelo certo para cada uma.

## O que ele faz

1. **Dá uma nota de 1 a 6 a cada prompt.** Um classificador rápido (Haiku) lê o pedido e escolhe quem atende:

   | Nota | Tipo de pedido | Modelo e esforço |
   |---|---|---|
   | 1 | Trivial (agradecimento, pergunta rápida, typo) | Haiku · low |
   | 2 | Simples (edição pequena e clara) | Sonnet · low |
   | 3 | Normal (feature pequena, bug visível) | Sonnet · medium |
   | 4 | Difícil (vários arquivos, refatoração) | Opus · medium |
   | 5 | Muito difícil (arquitetura, bug sutil) | Opus · high |
   | 6 | Ultra (sistema novo, decisão crítica) | Opus · max |

2. **Troca o modelo da conversa automaticamente**, a cada turno, e mostra na linha de status quem está atendendo. Para não perder o cache do contexto, só desce de nível quando a queda é grande; subir é sempre na hora.
3. **Em projeto grande, planeja antes de executar.** Quando o pedido é um escopo novo e grande (nota 5 ou 6), o planejador lê o projeto, quebra o trabalho em tarefas com dependências e arquivos previstos, e o recepcionista dá uma nota a cada tarefa. O plano aparece com o modelo de cada uma e **só executa depois do seu `/aprovar`**.
4. **Executa em ondas, um subagente por tarefa.** Cada tarefa roda num agente novo, com contexto limpo, no modelo e esforço da nota dela. Tarefas independentes rodam juntas (se não mexem no mesmo arquivo); as que dependem de outra esperam e recebem o resultado dela. Se uma falha, as dependentes ficam bloqueadas.
5. **Revisão final.** Quando as tarefas acabam, a sessão principal confere se as peças se encaixam e resume o que foi feito.

## Quanto ele pode economizar

**É uma estimativa por média, não uma medição.** Não é a quantidade exata de tokens que você vai economizar. É uma ordem de grandeza do que costuma acontecer comparado a usar o Claude sem ele.

| Situação | Custo a menos (estimado) |
|---|---|
| Sessão comum, com pedidos soltos | cerca de **30 a 45%** |
| Projeto grande com plano e executores | cerca de **50 a 65%** |
| Quem já usava o Sonnet quase sempre | cerca de **10 a 20%** |

Como a estimativa foi feita:

- Parte dos preços da API por milhão de tokens: Haiku 5.5 a $0,10 de entrada e $0,50 de saída, Sonnet 5.5 a $2 e $10, Opus 5.5 a $4 e $20. Ou seja, o Opus custa 2x o Sonnet e 40x o Haiku.
- Supõe que, sem o mod, quase tudo rodaria no Opus, e que os pedidos se dividem em 15% triviais, 20% simples, 35% normais, 20% difíceis, 8% muito difíceis e 2% ultra.
- **O número de tokens não cai por trocar de modelo.** O que cai é o custo, e nos planos de assinatura o consumo do seu limite de uso.
- Desconta o que o próprio mod gasta: uma chamada barata de classificação por prompt e o cache que se perde ao trocar de modelo.
- O resultado real depende dos seus pedidos. Se a nota sair baixa demais e você tiver que refazer, a economia some. Por isso o plano mostra o modelo de cada tarefa antes de executar, e o `/orquestra` mostra as últimas decisões com o motivo de cada uma.

## Instalar

No prompt de uma sessão de terminal:

    /plugin install orquestra --marketplace Vitinhu666/orquestra-mod

Responda `y` para adicionar o marketplace e escolha o escopo **user**, para valer em todas as sessões.

No app desktop: clique em **+** ao lado do campo de texto, depois **Plugins**, **Add marketplace** com `Vitinhu666/orquestra-mod`, e **Add plugin**.

## Comandos

- `/orquestra`: status, tabela de níveis, últimas decisões e o plano atual. Também aceita `on`, `off`, `1-6` (fixa um nível no próximo turno) e `plano on|off`.
- `/planejar <escopo>`: força o planejador, se o automático não pegar.
- `/aprovar [sem 2 3] [4=6]`: aprova o plano; `sem` pula tarefas e `4=6` põe a tarefa 4 no nível 6.
- `/descartar`: descarta o plano (agentes já em andamento terminam, mas nada novo começa).
- `/painel`: abre o painel ao vivo da sessão.

## Painel ao vivo

`/painel` abre um painel que se atualiza sozinho com o que acontece na sessão:

| Bloco | O que mostra | De onde vem |
|---|---|---|
| Atendendo agora | Modelo do último turno, esforço e nota; custo; limite de uso; economia estimada | Uso real reportado pela API em cada turno e a leitura de uso da sessão |
| Janela de contexto | Barra de ocupação com a marca dos 70% | Leitura de uso da sessão |
| Gasto por modelo | Barra empilhada e US$ por Haiku, Sonnet e Opus, com o número de turnos | Tokens de cada turno vezes a tabela de preços da API |
| Turnos | Uma barra por turno (altura = tokens, cor = modelo; executores esmaecidos) e quantas vezes o modelo trocou | Uso de cada turno |
| Plano | Tarefas, status e nível de cada uma | Estado do plano |
| Ferramentas | As mais usadas, erros e arquivos editados | Cada chamada de ferramenta, de qualquer agente |
| Alertas | Trocas de modelo em excesso, mesma ferramenta falhando, contexto acima de 60%, limite de uso acima de 80% | Regras simples sobre os números acima |

Cada modelo também aparece por escrito, não só pela cor.

**A economia é estimada.** Ela compara o custo real com o que custaria se os mesmos tokens tivessem rodado no Opus. Não conta que o esforço e a qualidade mudam a quantidade de tokens, e o custo do cache escrito é aproximado. Só aparece depois de 3 turnos. O painel não abre sozinho, e é o app que decide em que lugar da tela ele fica.

## Ajustes

A tabela `NIVEIS` no topo de `hooks/register.ts` define quem atende cada nível.

## Limitações conhecidas

- Ainda não foi calibrado com uso real prolongado; a precisão da nota depende do pedido.
- O mod só enxerga a resposta final de cada executor (cortada em 1500 caracteres), não os arquivos que ele editou.
- Os preços do painel são os da tabela da API; numa assinatura o consumo do limite de uso não segue exatamente esses valores.
