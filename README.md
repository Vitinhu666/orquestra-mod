# orquestra

Plugin para o Claude Code que escolhe sozinho **qual modelo e qual esforço** usar em cada pedido, para você não gastar Opus no que o Haiku resolve.

## O que ele faz

1. **Dá uma nota de 1 a 8 a cada prompt.** Um classificador rápido (Haiku) lê o pedido e escolhe quem atende. A escada sobe primeiro o esforço do modelo mais barato e só depois troca de modelo:

   | Nota | Tipo de pedido | Modelo e esforço |
   |---|---|---|
   | 1 | Trivial (agradecimento, pergunta rápida) | Haiku · low |
   | 2 | Simples (typo, renomear, edição óbvia) | Haiku · medium |
   | 3 | Simples, com mais atenção (config, um teste simples) | Haiku · high |
   | 4 | Normal leve (feature pequena, bug visível) | Sonnet · low |
   | 5 | Normal (feature média, bug que pede investigação) | Sonnet · medium |
   | 6 | Difícil (vários arquivos, refatoração) | Sonnet · high |
   | 7 | Muito difícil (arquitetura, bug sutil, migração grande) | Opus · medium |
   | 8 | Crítico (sistema novo, decisão cara de errar) | Opus · high |

   O Opus fica só para o que é de fato muito difícil: se o Sonnet em high dá conta, ele usa o Sonnet em high. **`xhigh` e `max` nunca são escolhidos sozinhos**: para usar, fixe à mão com `/orquestra fixar opus max` (ou qualquer modelo e esforço) e volte com `/orquestra auto`.

2. **Troca o modelo da conversa automaticamente**, a cada turno, e mostra na linha de status quem está atendendo. Para não perder o cache do contexto, só desce de nível quando a queda é grande; subir é sempre na hora.

## Escolha manual no app

Enquanto a orquestra está **ligada**, ela ignora o modelo e o esforço que você escolhe no seletor do app (inclusive Haiku high ou Sonnet high): a nota da triagem decide. Para escolher você mesmo, use `/orquestra off`; a escolha do app volta a valer na hora.

A única exceção é **Opus em xhigh ou max** escolhido no app. Nesse caso a orquestra desliga sozinha (aviso "Orquestra OFF" na tela e na linha de status) e o seu modelo é usado. O aviso aparece quando você envia a mensagem seguinte, não no clique do seletor, porque o plugin não recebe esse evento. Para ligar de novo, use `/orquestra on`.

## Instalar

No prompt de uma sessão de terminal:

    /plugin install orquestra --marketplace Vitinhu666/orquestra-mod

Responda `y` para adicionar o marketplace e escolha o escopo **user**, para valer em todas as sessões.

No app desktop: clique em **+** ao lado do campo de texto, depois **Plugins**, **Add marketplace** com `Vitinhu666/orquestra-mod`, e **Add plugin**.

## Comandos

- `/orquestra`: status, tabela de níveis e últimas decisões.
- `/orquestra on` / `off`: liga ou desliga a triagem. Desligada, vale o modelo escolhido no app.
- `/orquestra fixar <haiku|sonnet|opus> <low|medium|high|xhigh|max>`: trava modelo e esforço em todos os turnos, sem triagem. Sem esforço, usa `high`.
- `/orquestra auto`: volta ao automático.

## Ajustes

A tabela `NIVEIS` no topo de `hooks/register.ts` define quem atende cada nível.

## Limitações conhecidas

- Ainda não foi calibrado com uso real prolongado; a precisão da nota depende do pedido.
- Cada prompt custa uma chamada barata de classificação ao Haiku, e trocar de modelo perde o cache do contexto.
