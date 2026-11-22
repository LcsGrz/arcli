---
name: tarea-de-agente
description: Reglas comunes de los agentes que editan código en arcli (nucleo, interfaz, tester) - base del worktree, verificación e informe. Se precarga en esos agentes; no se invoca a mano.
user-invocable: false
---

# Cómo trabaja un agente de arcli

Te llama el orquestador (la sesión principal) con un brief: el pedido, el nivel de riesgo, los criterios de aceptación y, si lo hay, el plan. Vos no hablás con la persona ni con otros agentes: lo que necesites de ellos va en tu informe.

## Antes de tocar nada

1. **Base:** trabajás en un worktree propio, que tiene que salir de `origin/dev`, nunca de `main`.

   ```bash
   git fetch origin dev
   git log --oneline -1 HEAD; git merge-base --is-ancestor origin/dev HEAD && echo ok
   ```

   Si no da `ok` y todavía no hiciste commits, `git switch -C <rama> origin/dev`. La rama se llama `<tipo>/<ticket>-<tema>` (`fix/rev-63-docnro-cf`). Después `yarn install --frozen-lockfile`.

2. **Leé** `AGENTS.md`, [docs/estandares.md](../../../docs/estandares.md) y lo que tu definición dice para tu capa. Si el brief contradice algo de eso, frená y decilo en el informe en vez de elegir.

3. **Buscá qué reutilizar**, como dice `docs/estandares.md`, antes de escribir código. Anotá qué buscaste y qué encontraste.

## Mientras trabajás

- Si el plan resulta incorrecto o el cambio toca algo del contrato público (comando, flag, clave de config, campo de `--json`, un default) que el brief no autoriza, **frená y devolvé el informe** con la pregunta. No improvises una decisión de producto.
- Nada contra ARCA producción. Contra testing, solo si el brief lo autoriza. Nunca leas ni muestres certificados, claves ni tickets, y nunca toques la config real (`~/Library/Preferences/arcli`): los comandos del CLI van con `ARCLI_CONFIG_DIR=$(mktemp -d)`.
- Commits chicos con mensaje convencional en español (`fix: …`, `feat: …`, `test: …`), terminados en `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- No abras el PR ni mergees salvo que el brief lo pida. Si lo pide, `gh pr create --base dev` y el cuerpo termina en `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

## Antes de terminar

Corré `yarn typecheck`, `yarn lint` y `yarn test` (la suite completa: los tests relacionados se pierden los que leen archivos, como `docs-sync` y los golden). Un hook vuelve a verificar al terminar; si te bloquea, arreglalo o explicá por qué el error no es tuyo.

Para cada test nuevo de un bug, confirmá que falla sin el arreglo. Si el brief trae tests de aceptación escritos antes por `tester` (`it.fails` con el comentario "Tests primero"), pasalos a `it` y dejalos en verde: son los criterios, no se cambian sus aserciones sin decirlo en el informe.

Nunca saltees los hooks de git (`--no-verify`) ni los de Claude: si uno te frena sin razón, decilo en el informe.

## Informe

Devolvé exactamente estas secciones, en este orden:

1. **Qué cambió:** rama, commits y archivos, con el porqué.
2. **Reutilización:** qué buscaste, qué reutilizaste y qué abstracción creaste o descartaste, con el motivo.
3. **Criterios de aceptación:** cada uno con cómo lo verificaste (test, comando o lectura). Si uno no se cumple, decilo.
4. **Decisiones propias:** lo que decidiste sin que el brief lo diga y las alternativas descartadas.
5. **Riesgos y pendientes:** dudas, lo que quedó afuera y lo que no pudiste verificar.
6. **Pedidos:** lo que necesitás de otro rol o de la persona.

Corto y verificable: archivos con línea, comandos con su resultado real. Si algo falló, se dice con la salida.
