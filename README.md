# orquestra

Mod para o Claude Code que escolhe sozinho o modelo e o esforço de cada prompt (Haiku, Sonnet ou Opus, de low a max) e, em projetos grandes, planeja, pede aprovação e manda um executor por tarefa.

## Instalar

No prompt de uma sessão de terminal:

    /plugin install orquestra --marketplace Vitinhu666/orquestra-mod

Responda `y` para adicionar o marketplace e escolha o escopo **user**, para valer em todas as sessões.

No app desktop: clique em **+** ao lado do campo de texto, depois **Plugins**, **Add marketplace** com `Vitinhu666/orquestra-mod`, e **Add plugin**.

## Comandos

- `/orquestra`: status, níveis e últimas decisões. `on`, `off`, `1-6` e `plano on|off`.
- `/planejar <escopo>`: força o planejador.
- `/aprovar [sem 2 3] [4=6]`: aprova o plano; pula tarefas ou muda o nível de uma.
- `/descartar`: descarta o plano.

## Ajustes

A tabela `NIVEIS` no topo de `hooks/register.ts` define quem atende cada nível.
