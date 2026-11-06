[← Documentación](README.md)

# Desarrollo

Cómo trabajar en ARCLI localmente, probarlo y publicar una versión. Para entender el código, ver [Arquitectura](architecture.md). Para el flujo de contribución, [CONTRIBUTING](../CONTRIBUTING.md).

## Entorno

Requiere Node.js 22.22.1 o superior y [Yarn 1](https://classic.yarnpkg.com/). No mezcles gestores de paquetes ni lockfiles.

```bash
git clone https://github.com/LcsGrz/arcli.git
cd arcli
yarn install
yarn dev --ayuda
```

`yarn dev <comando>` corre el CLI desde `src/` sin compilar. Por ejemplo: `yarn dev fc -m 1000 --cs --cfinal`.

## Scripts

| Script                   | Qué hace                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------ |
| `yarn dev`               | Corre el CLI desde el código fuente                                                        |
| `yarn build`             | Compila TypeScript a `dist/`                                                               |
| `yarn typecheck`         | Chequeo de tipos de código y tests                                                         |
| `yarn test`              | Suite de Vitest                                                                            |
| `yarn test:coverage`     | Suite con cobertura (falla si baja de los pisos configurados)                              |
| `yarn lint`              | ESLint y Prettier (`yarn lint:eslint`, `yarn lint:prettier`)                               |
| `yarn lint:eslint:fix`   | Corrige lo que ESLint puede arreglar solo                                                  |
| `yarn lint:prettier:fix` | Formatea con Prettier                                                                      |
| `yarn pack:check`        | Empaqueta `dist`, lo instala en una carpeta temporal y corre `arcli --version` y `--ayuda` |
| `yarn open-source:check` | `typecheck`, `test:coverage`, `build` y `pack:check`                                       |

Husky corre `lint-staged` en cada commit: chequeo de tipos, ESLint y los tests relacionados con lo modificado.

## Tests

Los tests unitarios viven junto al código, en carpetas `__tests__` (por ejemplo `src/modules/billing/__tests__/`). `build` no los publica y `typecheck` sí los valida.

`src/__tests__/setup.ts` corre antes de cada archivo de tests: le da un `HOME` temporal (así ningún test lee ni escribe tu config real) y saca `FORCE_COLOR`, `NO_COLOR` y `ARCLI_ASCII`, para que la suite dé lo mismo en cualquier terminal.

Antes de cerrar un cambio:

```bash
yarn typecheck
yarn lint
yarn test
```

Para cambios de empaquetado o publicación, `yarn open-source:check`.

`src/cli/__tests__/docs-sync.test.ts` recorre el programa de commander y falla si un comando no aparece en `docs/` o en `llms.txt`, si un flag no aparece en `docs/cli-reference.md` o en `llms.txt`, o si una clave pública de config no aparece en `docs/configuration.md` o en `llms.txt`. Solo verifica que se mencione, no que la descripción esté bien. Lo que no se documenta a propósito va en `UNDOCUMENTED_FLAGS`, con el motivo.

`src/cli/__tests__/examples-valid.test.ts` toma cada ejemplo de facturación de la ayuda (`--ayuda` de cada atajo y familia), de `arcli ejemplos` y de los bloques `bash` de `docs/`, `README.md` y `llms.txt`, más los JSON de entrada para `--cargar`, y los pasa por el parser real hasta armar la solicitud a ARCA, con una config mínima (CUIT y punto de venta), un padrón falso y un reloj fijo, sin red. En un bloque de los docs, los `arcli config establecer` anteriores al ejemplo cuentan como config. Si falla, lista el archivo y la línea de cada ejemplo con su error. Un ejemplo inválido a propósito va en `EXCLUDED_EXAMPLES`, con el motivo.

## Verificación manual

Los tests no llaman a ARCA. Para cambios en emisión, consultas o salida, probá a mano contra `testing` y con montos chicos:

```bash
yarn dev config revisar
yarn dev fc -m 1000 --cs --cfinal              # vista previa
yarn dev fc -m 1000 --cs --cfinal --emitir     # emisión en testing
yarn dev fc -m 1000 --cs --cfinal --emitir --json --bruto
```

Revisá según lo que tocaste: la salida humana y la `--json` de los casos que cambian, los errores de validación (flags incompatibles, monto faltante, PEM inválido) y que `--produccion` sin `--emitir` no emita.

Para iterar la UI sin llamar a ARCA hay un storybook de terminal:

```bash
yarn dev storybook              # todas las escenas
yarn dev storybook colores      # o: bordes, componentes, comprobantes, configuracion, errores, json
```

## CI y publicación

Hay dos workflows en `.github/workflows/`:

- **CI** (`ci.yml`): en cada push y pull request instala sin scripts de dependencias (`--ignore-scripts`) y corre lint, typecheck, tests con cobertura, build y `pack:check`. En Linux con Node 22 (el mínimo de `engines`), 24 y 26; en Windows y macOS con Node 24.
- **Release** (`release.yml`): se dispara al publicar una release de GitHub y publica en npm lo que apunta su tag. Falla si el tag no coincide con la versión de `package.json` o no está en `main`. Tiene dos jobs: `build` valida, empaqueta y prueba el `.tgz` sin permiso para publicar; `publish` solo baja ese `.tgz` y lo publica. No usa cache y no corre scripts de dependencias.

  `publish` corre en el environment `npm`, que solo acepta tags `v*` y espera tu aprobación en Actions ("Review deployments"). Los tags `v*` están protegidos por un ruleset ("Tags de release"): solo un admin del repo los puede crear, mover o borrar.

- **Dependabot** (`dependabot.yml`): una vez por mes, PRs agrupados para las actions y las dependencias de npm.

Las actions están fijadas por SHA (con la versión en un comentario), para que un tag movido no cambie lo que corre. Para actualizarlas, reemplazá el SHA por el del tag nuevo. Los dos workflows tienen permisos mínimos (`contents: read`; solo el job `publish` del release suma `id-token: write`).

`Release` publica con [npm Trusted Publishers](https://docs.npmjs.com/trusted-publishers) (OIDC), sin `NPM_TOKEN`. El paquete `arcli` en npm tiene que tener este repo y `release.yml` como publicador de confianza. El job `publish` necesita `id-token: write` y npm 11.5.1 o superior (Node 24).

### Sacar una versión

1. Crear la rama `release/vX.Y.Z`.
2. En `CHANGELOG.md`, pasar las entradas de "Sin publicar" a una sección `[X.Y.Z] - AAAA-MM-DD` y actualizar los links de comparación del final.
3. Subir la versión en `package.json` y en `src/cli/version.ts` (un test verifica que coincidan).
4. Abrir el PR, esperar el CI y mergear.
5. Crear la release de GitHub `vX.Y.Z` sobre `main`, con las notas del changelog: crea el tag y dispara `Release`. Cuando `build` termina, aprobá el deploy al environment `npm` en Actions y `publish` publica en npm.
6. Si `Release` falla, arreglar la causa y usar "Re-run jobs" en Actions: vuelve a correr sobre el mismo tag.

Versionado: cambios que rompen el contrato del CLI → mayor; flags, comandos o claves nuevas y validaciones que adelantan rechazos de ARCA → menor; correcciones sin cambio de contrato → patch.

## Trabajar con agentes

Las instrucciones para agentes están en [AGENTS.md](../AGENTS.md) y la referencia para quien usa el CLI desde un agente, en [llms.txt](../llms.txt). Para Claude Code, el repo trae además `.claude/settings.json`, las skills de `.claude/skills/` y los agentes de `.claude/agents/`. Quien mantiene arcli revisa los PRs de terceros con `/revisar-pr <N>`. Tu config personal para este repo va en `.claude/settings.local.json`, que está ignorado.

### Verificación al terminar (hook Stop)

`scripts/agent/stop-check.mjs` corre cada vez que Claude termina una respuesta:

- Si `src/` no cambió desde la última verificación verde de la sesión, sale enseguida (~0,1 s).
- Si cambió, corre `eslint --fix` y `vitest related` sobre los archivos cambiados y `tsc` sobre todo el proyecto (~3 s). Si algo falla, le pasa a Claude las primeras 40 líneas de cada error y Claude sigue trabajando.
- Nunca bloquea dos veces por el mismo diff: si Claude vuelve a terminar sin cambiar nada, solo te muestra un aviso.
- Si cambió `src/cli/` o `src/modules/config/` y en la rama no se tocó ningún doc (`docs/`, `README.md`, `llms.txt`, `CHANGELOG.md`), le recuerda a Claude la [tabla de documentación](../CONTRIBUTING.md#documentación). Una vez por sesión.

Ve todos los cambios, también los hechos por Bash, porque compara contra `git diff HEAD`. No reemplaza a `yarn test` completo ni al CI. Lo que ya está commiteado no lo vuelve a mirar (eso lo cubre lint-staged).

Para probarlo a mano, con un error en un archivo de `src/`:

```bash
echo '{"session_id":"prueba","cwd":"'"$PWD"'"}' | node scripts/agent/stop-check.mjs; echo "exit $?"
```

Sale con 2 y muestra el error; sin cambios en `src/`, sale con 0 sin imprimir nada. El sello de la sesión está en `$TMPDIR/arcli-stop-check-<sesión>.json`; borralo para forzar otra verificación.

Para desactivarlo: `"disableAllHooks": true` en `.claude/settings.local.json`, o `/hooks` dentro de la sesión.

### Permisos

`.claude/settings.json` le impide a Claude leer o editar certificados, claves y tickets de ARCA (`*.key`, `*.pem`, `*.p12`, `*.pfx`, `TA-*.json`, en el repo y en tu home) y correr `npm publish` o `yarn publish`: se publica solo con el workflow `Release`. Las reglas de lectura frenan las herramientas de archivos de Claude, no a un script que los abra, así que no es una barrera completa. El repo no habilita mergear PRs ni publicar sin confirmación: si mantenés arcli y lo querés, sumalo en tu `.claude/settings.local.json`.

## Imágenes y GIF del README

Están en `docs/assets/demo/` y se regeneran con scripts para que no queden desactualizados:

- **GIF** (`interactivo.gif`, `consultar.gif`, `comandos.gif`) y **video promocional** (`promo.mp4`, 16:9 para redes): los graba [VHS](https://github.com/charmbracelet/vhs) a partir de los guiones de `docs/assets/tapes/`. `scripts/demo/record.sh` usa un `HOME` temporal con una copia de tu config sin las credenciales de producción, así la grabación no muestra tus rutas ni el aviso de vencimiento de ese certificado, y **emite comprobantes reales en testing**. Es para quien mantiene el repo. El certificado de testing siempre es del CUIT de quien lo genera, así que `scripts/demo/mask-cuit.mjs` lo reemplaza por `20-11111111-2` en todo lo que arcli escribe en la terminal.

  ```bash
  brew install vhs
  ARCLI_DEMO_CONFIG=~/Library/Preferences/arcli/config.json scripts/demo/record.sh
  ```

  Para grabar solo algunos, pasá los guiones: `scripts/demo/record.sh docs/assets/tapes/consultar.tape`. `consultar.tape` solo lee; `interactivo.tape`, `comandos.tape` y `promo.tape` emiten.

- **PDF de ejemplo** (`pdf-factura.png`): `scripts/demo/pdf-sample.mts` arma una Factura B con datos ficticios, sin consultar ARCA. Necesita el plugin de PDF instalado y macOS (`qlmanage`).

  ```bash
  node --import tsx scripts/demo/pdf-sample.mts
  ```

El README las enlaza con URLs absolutas de `raw.githubusercontent.com` porque npmjs.com no muestra imágenes con rutas relativas.
