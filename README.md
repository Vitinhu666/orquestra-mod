# recepcionista

Mod para o Claude Code que escolhe sozinho o modelo e o esforço de cada prompt (Haiku, Sonnet ou Opus, de low a max) e, em projetos grandes, planeja, pede aprovação e manda um executor por tarefa.

## Instalar

No prompt de uma sessão de terminal:

    /plugin install recepcionista --marketplace Vitinhu666/recepcionista-mod

Responda `y` para adicionar o marketplace e escolha o escopo **user**, para valer em todas as sessões.

No app desktop: clique em **+** ao lado do campo de texto, depois **Plugins**, **Add marketplace** com `Vitinhu666/recepcionista-mod`, e **Add plugin**.

## Comandos

- `/recepcao`: status, níveis e últimas decisões. `on`, `off`, `1-6` e `plano on|off`.
- `/planejar <escopo>`: força o planejador.
- `/aprovar [sem 2 3] [4=6]`: aprova o plano; pula tarefas ou muda o nível de uma.
- `/descartar`: descarta o plano.

## Ajustes

A tabela `NIVEIS` no topo de `hooks/register.ts` define quem atende cada nível.
