---
name: sincronizar-docs
description: Pone las docs de arcli al día con un cambio del CLI. Usala después de un cambio visible (comando, flag, clave de config, JSON, validación, mensaje o pantalla del modo interactivo), cuando el hook Stop lo recuerde o antes de abrir un PR con esos cambios.
---

# Sincronizar docs

Qué doc cubre qué está en la tabla de [CONTRIBUTING.md](../../../CONTRIBUTING.md#documentación). Esa tabla es la fuente: leela antes de empezar.

## 1. Qué cambió para quien usa el CLI

`git fetch origin dev`, después `git diff origin/dev...HEAD --stat` más `git status --short`; si te piden documentar un commit o rango puntual, `git show <commit>` en su lugar. Para cada archivo de `src/` cambiado, leé el diff y anotá cada **cambio visible**: un comando, flag, clave, campo de JSON, validación, mensaje o pantalla que antes no existía, cambió o ya no está. Un refactor sin cambio visible no se anota. Si cambiaron scripts de `package.json` o la estructura de carpetas, anotalo para la fila de `AGENTS.md`.

**Listo cuando:** tenés la lista de cambios visibles, o sabés que no hay ninguno y lo decís.

## 2. Actualizar cada doc

Por cada cambio visible, buscá en la tabla todas las filas que le tocan y editá sus docs. Seguí el estilo que ya tiene cada doc (tablas de flags en `cli-reference.md`, una línea por flag en `llms.txt`, ejemplos que se pueden copiar; un JSON de salida que solo da ARCA se arma desde el presenter, con valores de ejemplo). Un dato vive en un solo lugar: si un doc ya enlaza a otro para ese tema, actualizá el destino del enlace.

Si el cambio le afecta a quien usa el CLI, sumá en `## [Sin publicar]` de `CHANGELOG.md` la entrada de una línea y su detalle, con el formato de la skill `changelog` (sección "En cada PR"). Si el cambio cae en la regla de "Contrato público" de [AGENTS.md](../../../AGENTS.md#contrato-público), avisale a la persona antes de seguir.

**Listo cuando:** cada cambio visible tiene sus docs actualizados o una razón para no tocarlos.

## 3. Verificar

- `yarn vitest run src/cli/__tests__/docs-sync.test.ts src/cli/__tests__/examples-valid.test.ts`: cada comando, flag y clave aparece en sus docs y en `llms.txt`, y cada ejemplo de facturación y cada JSON de `--cargar` de los docs pasa el parser real. El resto de los ejemplos (`config`, consultas, `certificado`) los corrés vos con `yarn dev`. Los tests solo miran nombres y sintaxis: las descripciones, los campos de JSON y los códigos de error los verificás vos contra el diff.
- `yarn lint:prettier`; si falla por tablas desalineadas, `yarn lint:prettier:fix`.
- Si cambió la ayuda del CLI, `yarn dev <comando> --ayuda` muestra lo mismo que dicen las docs.

**Listo cuando:** las verificaciones pasan y le reportás a la persona qué docs cambiaste, cuáles de la tabla revisaste sin que hiciera falta tocarlos y qué GIF de `docs/assets/` hay que regrabar (lo graba quien mantiene el repo, ver `docs/development.md`).
