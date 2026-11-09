---
name: release
description: Saca una versión de arcli a npm. Arma el PR release/vX.Y.Z de dev a main, crea la release de GitHub (que crea el tag y dispara el workflow Release) y vuelve a llevar main a dev.
disable-model-invocation: true
argument-hint: "[patch|minor|major]"
---

# Release de arcli

Solo para quien mantiene arcli: publicar necesita permisos de escritura en el repo, el workflow Release y npm. Un colaborador no la necesita.

El procedimiento base está en [docs/development.md](../../../docs/development.md#sacar-una-versión). Esta skill lo ejecuta con los formatos y gates que se usan en el repo. Antes de seguir, leé esa sección y la regla de versionado que trae.

Hay cuatro **gates**: puntos donde mostrás lo que vas a hacer y esperás un "dale" explícito del usuario. Lo que pasa después de un gate es público o irreversible, así que un gate aprobado habilita solo esa acción.

## 1. Estado de partida

La base es `dev`. Solo para un hotfix (un arreglo que ya se mergeó a `main`, ver [Ramas](../../../docs/development.md#ramas)) es `main`. En lo que sigue, `<base>` es una de las dos.

- `git fetch` y sin cambios en archivos versionados. Lo que no se versiona (por ejemplo `.claude/settings.local.json`) no importa.
- `main` es ancestro de `origin/dev` (`git merge-base --is-ancestor origin/main origin/dev`). Si no lo es, falta volver a llevar a `dev` la release o el hotfix anterior: hacé el paso 7 antes de seguir.
- `## [Sin publicar]` en [CHANGELOG.md](../../../CHANGELOG.md) de `<base>` tiene entradas. Si está vacío, revisá `git log --no-merges vANTERIOR..origin/<base>`: si hay cambios que afectan a quien usa el CLI y les falta entrada, avisá y frená. Si no hay nada que publicar, frená.

**Listo cuando:** sabés qué PRs entran (los `#N` de `git log --oneline --no-merges vANTERIOR..origin/<base>`) y tenés las entradas de "Sin publicar".

## 2. Versión

Elegí patch, minor o major con la regla de versionado de `docs/development.md`, leyendo las entradas y no los títulos de commit. Si el usuario pasó un argumento y no coincide con lo que dice la regla, decíselo antes de seguir. Una clave de config nueva o un default que cambia es minor. Un cambio que rompe comandos, flags, claves o `--json` es major y necesita una sección que explique qué cambia para quien ya lo usa.

**Listo cuando:** tenés `X.Y.Z` y una frase con el motivo.

## 3. Rama y cambios

Creá `release/vX.Y.Z` desde `origin/<base>` y tocá exactamente tres archivos:

- `CHANGELOG.md`:
  - Renombrá las entradas a `## [X.Y.Z] - AAAA-MM-DD` (fecha de hoy) y dejá arriba un `## [Sin publicar]` vacío.
  - Debajo del título, un párrafo que resuma qué cambia para quien usa el CLI y cierre diciendo qué del contrato **no** cambia, como en 1.8.0 y 1.7.1.
  - Al final: `[Sin publicar]` compara `vX.Y.Z...HEAD` y se suma `[X.Y.Z]: .../compare/vANTERIOR...vX.Y.Z`.
- `package.json`: `"version"`.
- `src/cli/version.ts`: `CLI_VERSION`. Un test verifica que coincida con `package.json`.

Después corré `yarn typecheck`, `yarn lint`, `yarn test` y `yarn build`, y `node dist/cli/index.js --version` tiene que imprimir `X.Y.Z`. Anotá cuántos tests pasaron.

**Listo cuando:** el diff toca solo esos tres archivos, todo pasa y la versión compilada es `X.Y.Z`.

## 4. Gate 1: commit, push y PR

Mostrá el diff y el cuerpo del PR, y esperá el ok. El commit y el título del PR son `vX.Y.Z`, y el PR va contra `main` (`gh pr create --base main`), no contra la rama default. Cuerpo:

```markdown
## Release X.Y.Z

Prepara la versión X.Y.Z con #A y #B. El detalle está en [`CHANGELOG.md`](https://github.com/LcsGrz/arcli/blob/release/vX.Y.Z/CHANGELOG.md).

- **Área:** resumen en una línea.

### Por qué es <patch|minor|major>

Qué cambia del contrato y qué no.

### Verificación

- `yarn typecheck`, `yarn lint` y `yarn test` (N tests) pasan.
- `yarn build` OK y `arcli --version` devuelve `X.Y.Z`.
```

Después esperá el CI del PR con `gh pr checks --watch`. Si falla, arreglalo en la rama y repetí la verificación del paso 3.

**Listo cuando:** el PR está abierto y el CI en verde.

## 5. Gate 2: merge

Pedí el ok para mergear. El merge es squash: `gh pr merge <N> --squash --delete-branch`, que deja en `main` un solo commit `vX.Y.Z (#N)` con todo lo que traía `<base>`. Después `git switch main && git pull`.

**Listo cuando:** `main` local apunta al commit `vX.Y.Z (#N)` y `src/cli/version.ts` dice `X.Y.Z`.

## 6. Gate 3: tag, release de GitHub y npm

Pedí el ok una sola vez y mostrá las notas antes: crear la release ya publica en npm. Esto publica en npm, y una versión publicada en npm no se puede volver a usar.

1. Notas: el cuerpo de la sección `[X.Y.Z]` del CHANGELOG, sin la línea `## [X.Y.Z] - fecha`. Guardalo en un archivo del scratchpad.
2. `gh release create vX.Y.Z --target main --title vX.Y.Z --notes-file <archivo>`. Esto crea también el tag y dispara el workflow `Release`, que publica en npm.
3. Buscá el run con `gh run list --workflow release.yml --limit 1` y seguilo con `gh run watch <id> --exit-status`. Cuando `build` termina, `publish` espera la aprobación del environment `npm`: avisale al usuario que la apruebe en Actions ("Review deployments"). No la apruebes vos.
4. Confirmá con `npm view arcli version`, que tiene que devolver `X.Y.Z`. Puede tardar unos minutos en propagarse.

Si el workflow falla, mostrá el log (`gh run view <id> --log-failed`) y frená. No borres el tag ni la release sin que el usuario lo pida.

**Listo cuando:** la release de GitHub `vX.Y.Z` existe, el run de Release terminó en verde y npm sirve `X.Y.Z`.

## 7. Gate 4: `main` vuelve a `dev`

El squash deja en `main` un commit que `dev` no tiene. Hasta que `main` vuelva a `dev`, el próximo PR a `main` choca. Va siempre, también después de un hotfix.

1. `gh pr create --base dev --head main --title "chore: main → dev después de vX.Y.Z"`, con un cuerpo de una línea que diga por qué.
2. Si GitHub marca conflictos (pasa si en `dev` se tocó el CHANGELOG mientras tanto), cerrá ese PR. Armá `sync/vX.Y.Z` desde `origin/dev`, corré `git merge origin/main`, resolvé los conflictos (las secciones publicadas salen de `main`, lo nuevo de "Sin publicar" queda) y abrí el PR desde esa rama.
3. Esperá el CI, pedí el ok y mergeá con **merge commit**: `gh pr merge <N> --merge`. Nunca con squash, porque volvería a dejar a `dev` sin el commit de `main`. Tampoco con `--delete-branch` si el head es `main`.
4. `git switch dev && git pull`.

**Listo cuando:** `git merge-base --is-ancestor origin/main origin/dev` da 0 y `src/cli/version.ts` de `dev` dice `X.Y.Z`.

## 8. Cierre

Reportá el link al PR, a la release, al run y al PR `main` → `dev`, y la versión que sirve npm. Si en el camino quedó algo pendiente (docs, GIF o entradas que faltaban en el CHANGELOG), listalo.
