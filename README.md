# orquestra

Plugin para o Claude Code que escolhe sozinho o modelo e o esforço de cada pedido.

Cada prompt recebe uma nota de 1 a 8 de um classificador (Haiku):

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

`xhigh` e `max` nunca são escolhidos pela triagem.

Com a orquestra ligada, o modelo do seletor do app é ignorado. A exceção é Opus em `xhigh` ou `max`: aí a orquestra desliga sozinha e o seu modelo é usado.

## Instalar

    /plugin install orquestra --marketplace Vitinhu666/orquestra-mod

## Comandos

- `/orquestra`: status e últimas decisões.
- `/orquestra on` / `off`: liga ou desliga a triagem.
- `/orquestra fixar <haiku|sonnet|opus> <low|medium|high|xhigh|max>`: trava modelo e esforço, sem triagem.
- `/orquestra auto`: volta ao automático.

A tabela `NIVEIS` no topo de `hooks/register.ts` define quem atende cada nível.
