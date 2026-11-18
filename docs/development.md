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

| Script                     | Qué hace                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------ |
| `yarn dev`                 | Corre el CLI desde el código fuente                                                        |
| `yarn build`               | Compila TypeScript a `dist/`                                                               |
| `yarn typecheck`           | Chequeo de tipos de código y tests                                                         |
| `yarn test`                | Suite de Vitest                                                                            |
| `yarn test:coverage`       | Suite con cobertura (falla si baja de los pisos configurados)                              |
| `yarn test:e2e`            | Tests de punta a punta sobre el `dist/` compilado (antes, `yarn build`)                    |
| `yarn test:arca`           | Tests contra ARCA testing con tu config; solo local (antes, `yarn build`)                  |
| `yarn lint`                | ESLint y Prettier (`yarn lint:eslint`, `yarn lint:prettier`)                               |
| `yarn lint:eslint:fix`     | Corrige lo que ESLint puede arreglar solo                                                  |
| `yarn lint:prettier:fix`   | Formatea con Prettier                                                                      |
| `yarn docs:comprobantes`   | Escribe `docs/comprobantes/` desde `scripts/docs/comprobantes.ts`                          |
| `yarn contrato:actualizar` | Regenera la lista del contrato público (`src/cli/__tests__/public-contract.txt`)           |
| `yarn pack:check`          | Empaqueta `dist`, lo instala en una carpeta temporal y corre `arcli --version` y `--ayuda` |
| `yarn open-source:check`   | `typecheck`, `test:coverage`, `build`, `test:e2e` y `pack:check`                           |

Husky corre `lint-staged` en cada commit: chequeo de tipos, ESLint y los tests relacionados con lo modificado.

## Tests

Los tests unitarios viven junto al código, en carpetas `__tests__` (por ejemplo `src/modules/billing/__tests__/`). `build` no los publica y `typecheck` sí los valida.

`src/__tests__/setup.ts` corre antes de cada archivo de tests: le da un `HOME` temporal (así ningún test lee ni escribe tu config real) y saca `FORCE_COLOR`, `NO_COLOR`, `TERM` y `ARCLI_ASCII`, para que la suite dé lo mismo en cualquier terminal.

Antes de cerrar un cambio:

```bash
yarn typecheck
yarn lint
yarn test
```

Para cambios de empaquetado o publicación, `yarn open-source:check`.

### De punta a punta

`src/cli/__tests__/e2e/*.e2e.ts` corre el `arcli` compilado (`dist/cli/index.js`) como un proceso aparte y compara lo que ve quien lo usa: la salida, que `--json` sea un solo documento JSON, el código de salida y lo que queda en la config. Cada test usa una carpeta de config vacía con `ARCLI_CONFIG_DIR`, sin red ni certificados, así que corre en el CI en los tres sistemas operativos. Van con `yarn test:e2e` después de `yarn build`; `yarn test` no los toma (no terminan en `.test.ts`).

Sirven para lo que los tests unitarios no ven: el empaquetado de ESM, los errores de uso de commander, que nada escriba texto alrededor del JSON. Lo que necesita a ARCA (emitir, consultar) sigue en los unitarios, con ARCA simulado.

### Contra ARCA testing

`src/cli/__tests__/e2e/*.arca.ts` corre el `arcli` compilado contra ARCA testing, con tu config y tu certificado: `estado`, una tabla de `parametros`, `padron` y `fce-obligado` con los CUITs de prueba, una vista previa y una Factura C de prueba que después busca con `consultar`. Todo va con `--testing`, que el helper agrega siempre, así que no puede tocar producción. Los comprobantes de testing no tienen validez fiscal.

```bash
yarn build && yarn test:arca
# con un punto de venta de exportación, también la E: últimos, número siguiente y notas
yarn build && ARCLI_ARCA_PV_E=4 yarn test:arca
```

No corre en el CI (necesita credenciales y se niega si encuentra `CI`) ni con `yarn test`. Se corre antes de cada release (la skill `release` frena si falla) y conviene correrlo después de tocar algo que hable con ARCA: atrapa lo que los tests con ARCA simulado no ven, como una respuesta con otra forma o un error nuevo del SDK.

`arca-rules.arca.ts` prueba las reglas que ARCLI copia de ARCA (ver [De dónde sale cada regla](validation-rules.md#de-dónde-sale-cada-regla)). ARCLI corta el caso límite antes de llamar a ARCA, así que cada caso arma la solicitud de un comprobante válido con la vista previa del CLI compilado (el campo `solicitud` del `--json`), comprueba que ARCLI bloquea el caso con los flags (si hay un comando equivalente), cambia en la solicitud solo el dato de la regla y la manda a ARCA testing con los gateways de `src/services/arca`, sin la validación local. Espera el rechazo con el código del manual:

- si ARCA lo aprueba, el test falla con el número y el CAE: la regla local quedó más estricta que ARCA y hay que decidir si se afloja;
- si lo rechaza con otro código, el test falla con los códigos: el manual cambió o la regla cita mal el código.

También compara las tablas que ARCLI copia (IVA receptor por letra y alícuotas) con las que devuelve ARCA. Un caso que pasa no emite nada; uno que falla por aprobación deja un comprobante de prueba, que el test lista al final. Para la `E` usa una factura de servicios y una de bienes del punto de venta de `ARCLI_ARCA_PV_E`, y una NC y una ND E: si no hay, emitilas antes.

`src/cli/__tests__/docs-sync.test.ts` recorre el programa de commander y falla si un comando no aparece en `docs/` o en `llms.txt`, si un flag no aparece en `docs/cli-reference.md` o en `llms.txt`, o si una clave pública de config no aparece en `docs/configuration.md` o en `llms.txt`. Solo verifica que se mencione, no que la descripción esté bien. Lo que no se documenta a propósito va en `UNDOCUMENTED_FLAGS`, con el motivo.

`src/cli/__tests__/public-contract.test.ts` mira el contrato en la otra dirección. `src/cli/__tests__/public-contract.txt` es la lista commiteada de comandos, flags (también los alias ocultos, como `--pv`, `--mda` o `--pdf`, y los cortos, como `-m`) y claves de config (también las deprecadas), una por línea, generada desde el programa de commander y el esquema de config. El test falla si algo de la lista ya no está en el código, con un mensaje que recuerda que es contrato público y que lo viejo sigue andando, deprecado, hasta la próxima versión mayor (ver [AGENTS.md](../AGENTS.md#contrato-público)). También falla si hay algo nuevo que no está en la lista: `yarn contrato:actualizar` la regenera, y el cambio queda en el diff del PR. Sacar una línea a propósito (en una versión mayor) se hace con el mismo script y se explica en el PR y en `CHANGELOG.md`.

El mismo test compara los códigos de error: cada código de la tabla de [códigos de error](input-output.md#códigos-de-error) tiene que existir en `src/`, y cada código que se asigna en `src/`, estar en la tabla. No hay una lista única de códigos, así que el test los toma de donde se asignan: `code: '…'` o `codigo: '…'`, el primer argumento de un `…Error('…')` (`PdfError`, `certificateError`) y las uniones `type …ErrorCode` (`ERROR_CODE_SITES`); otras constantes en mayúsculas no cuentan. La fila `PDF_*` cubre los que lista [Errores del PDF](input-output.md#errores-del-pdf).

Los comandos internos (`__completar`, `storybook`) quedan fuera de la lista, en `INTERNAL_COMMANDS`; los atajos y familias, aunque estén ocultos en la ayuda, son públicos y están.

`src/cli/__tests__/json-golden.test.ts` congela la salida completa del `--json` (stdout, stderr y exit code, byte a byte) de facturación A, B, C, FCE y E, lotes y cada código de error, con el SDK de ARCA simulado y reloj fijo; cada caso es un archivo de `src/cli/__tests__/__golden__/`. Un cambio en esos archivos es un cambio de contrato: si es a propósito, se regeneran con `yarn test src/cli/__tests__/json-golden.test.ts -u` y el diff va en el PR (y en `CHANGELOG.md`).

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

Las reglas de la salida están en el [design system](design-system.md). Para iterar la UI sin llamar a ARCA hay un storybook de terminal:

```bash
yarn dev storybook              # todas las escenas
yarn dev storybook colores      # o: bordes, certificados, componentes, comprobantes, configuracion, consultas, errores, json
```

## Ramas

- **`dev`**: donde se trabaja. Cada cambio sale de `dev` en una rama corta y vuelve con un PR a `dev`, mergeado con squash.
- **`main`**: lo publicado en npm y rama default de GitHub, para que quien entra al repo vea el código y las docs de la versión que instaló. Cada commit es una versión (`vX.Y.Z (#N)`) o un hotfix, así que siempre se puede sacar un arreglo sin arrastrar lo que está a medio hacer en `dev`. Exige historia lineal.

Las dos están protegidas: piden PR y el CI en verde (`validate`) y no aceptan force push ni borrado, tampoco a admins.

**Release:** `release/vX.Y.Z` sale de `dev` y entra a `main` con squash (ver [Sacar una versión](#sacar-una-versión)). Si `main` no vuelve a `dev`, el próximo squash a `main` trae conflictos. Por eso después de cada release se abre un PR `main` → `dev` y se mergea con **merge commit**, nunca con squash (`dev` no exige historia lineal justamente para esto).

**Hotfix:** para un bug de una versión publicada que no puede esperar a la próxima. Rama `fix/<tema>` desde `main`, PR a `main` (squash) y release patch desde `main`. Después, el mismo PR `main` → `dev` con merge commit.

Como `main` es la default, GitHub y `gh pr create` proponen `main` como base: los PRs de trabajo se abren con `--base dev`, y Dependabot tiene `target-branch: dev`. Si un PR de trabajo llega apuntando a `main`, se le cambia la base a `dev` (`gh pr edit <N> --base dev`) antes de mergear.

## CI y publicación

Hay tres workflows en `.github/workflows/`:

- **CI** (`ci.yml`): en cada push a `main` o `dev` y en cada pull request instala sin scripts de dependencias (`--ignore-scripts`) y corre lint, typecheck, tests con cobertura, build, los tests de punta a punta y `pack:check`. En Linux con Node 22 (el mínimo de `engines`), 24 y 26; en Windows y macOS con Node 24.
- **Release** (`release.yml`): se dispara al publicar una release de GitHub y publica en npm lo que apunta su tag. Falla si el tag no coincide con la versión de `package.json` o no está en `main`. Tiene dos jobs: `build` valida, empaqueta y prueba el `.tgz` sin permiso para publicar; `publish` solo baja ese `.tgz` y lo publica. No usa cache y no corre scripts de dependencias.

  `publish` corre en el environment `npm`, que solo acepta tags `v*` y espera tu aprobación en Actions ("Review deployments"). Los tags `v*` están protegidos por un ruleset ("Tags de release"): solo un admin del repo los puede crear, mover o borrar.

- **Docs** (`docs.yml`): construye el [sitio de documentación](#sitio-de-documentación) en los PRs que tocan docs (falla si hay links internos rotos) y lo publica en GitHub Pages al publicar una release o a mano desde `main`.

- **Dependabot** (`dependabot.yml`): una vez por mes, PRs agrupados para las actions y las dependencias de npm.

Las actions están fijadas por SHA (con la versión en un comentario), para que un tag movido no cambie lo que corre. Para actualizarlas, reemplazá el SHA por el del tag nuevo. Los dos workflows tienen permisos mínimos (`contents: read`; solo el job `publish` del release suma `id-token: write`).

`Release` publica con [npm Trusted Publishers](https://docs.npmjs.com/trusted-publishers) (OIDC), sin `NPM_TOKEN`. El paquete `arcli` en npm tiene que tener este repo y `release.yml` como publicador de confianza. El job `publish` necesita `id-token: write` y npm 11.5.1 o superior (Node 24).

### Sacar una versión

1. Crear la rama `release/vX.Y.Z` desde `dev` (desde `main` si es un hotfix).
2. En `CHANGELOG.md`, pasar las entradas de "Sin publicar" a una sección `[X.Y.Z] - AAAA-MM-DD` y actualizar los links de comparación del final.
3. Subir la versión en `package.json` y en `src/cli/version.ts` (`yarn test:e2e` y `pack:check` verifican que coincidan).
4. Abrir el PR contra `main`, esperar el CI y mergear con squash.
5. Crear la release de GitHub `vX.Y.Z` sobre `main`, con las notas del changelog: crea el tag y dispara `Release`. Cuando `build` termina, aprobá el deploy al environment `npm` en Actions y `publish` publica en npm.
6. Si `Release` falla, arreglar la causa y usar "Re-run jobs" en Actions: vuelve a correr sobre el mismo tag.
7. Abrir el PR `main` → `dev` y mergearlo con merge commit (ver [Ramas](#ramas)).

Versionado: cambios que rompen el contrato del CLI → mayor; flags, comandos o claves nuevas y validaciones que adelantan rechazos de ARCA → menor; correcciones sin cambio de contrato → patch.

## Trabajar con agentes

Las instrucciones para agentes están en [AGENTS.md](../AGENTS.md) y la referencia para quien usa el CLI desde un agente, en [llms.txt](../llms.txt). Para Claude Code, el repo trae además `.claude/settings.json`, las skills de `.claude/skills/` y los agentes de `.claude/agents/`. Quien mantiene ARCLI revisa los PRs de terceros con `/revisar-pr <N>`. Tu config personal para este repo va en `.claude/settings.local.json`, que está ignorado.

### Verificación al terminar (hook Stop)

`scripts/agent/stop-check.mjs` corre cada vez que Claude termina una respuesta:

- Si `src/` no cambió desde la última verificación verde de la sesión, sale enseguida (~0,1 s).
- Si cambió, corre `eslint --fix` y `vitest related` sobre los archivos cambiados y `tsc` sobre todo el proyecto (~3 s). Si algo falla, le pasa a Claude las primeras 40 líneas de cada error y Claude sigue trabajando.
- Nunca bloquea dos veces por el mismo diff: si Claude vuelve a terminar sin cambiar nada, solo te muestra un aviso.
- Si cambió `src/cli/` o `src/modules/` (salvo tests, `storybook/` y `*.internal.ts`) y en la rama no se tocó ningún doc (`docs/`, `README.md`, `llms.txt`, `CHANGELOG.md`), le recuerda a Claude la [tabla de documentación](../CONTRIBUTING.md#documentación). Una vez por sesión.

Ve todos los cambios, también los hechos por Bash, porque compara contra `git diff HEAD`. No reemplaza a `yarn test` completo ni al CI. Lo que ya está commiteado no lo vuelve a mirar (eso lo cubre lint-staged).

Para probarlo a mano, con un error en un archivo de `src/`:

```bash
echo '{"session_id":"prueba","cwd":"'"$PWD"'"}' | node scripts/agent/stop-check.mjs; echo "exit $?"
```

Sale con 2 y muestra el error; sin cambios en `src/`, sale con 0 sin imprimir nada. El sello de la sesión está en `$TMPDIR/arcli-stop-check-<sesión>.json`; borralo para forzar otra verificación.

Para desactivarlo: `"disableAllHooks": true` en `.claude/settings.local.json`, o `/hooks` dentro de la sesión.

### Permisos

`.claude/settings.json` le impide a Claude leer o editar certificados, claves y tickets de ARCA (`*.key`, `*.pem`, `*.p12`, `*.pfx`, `TA-*.json`, en el repo y en tu home) y correr `npm publish` o `yarn publish`: se publica solo con el workflow `Release`. Las reglas de lectura frenan las herramientas de archivos de Claude, no a un script que los abra, así que no es una barrera completa. El repo no habilita mergear PRs ni publicar sin confirmación: si mantenés ARCLI y lo querés, sumalo en tu `.claude/settings.local.json`.

## Sitio de documentación

[arcli.com.ar](https://arcli.com.ar) es un sitio de [Starlight](https://starlight.astro.build) que vive en `site/`, con su propio `package.json`: Astro no entra a las dependencias del CLI ni al paquete de npm.

Las páginas **no se editan en `site/`**: `site/scripts/sync-docs.mjs` las genera desde `docs/`, `README.md` (el prompt para instalar con IA, que copian la portada y "Instalar y configurar") y `CHANGELOG.md`, y lo generado está en el `.gitignore` de `site/`. Así `docs/` sigue siendo la única fuente, los links de GitHub no se rompen y los tests de docs no cambian. El script saca el título al frontmatter, cambia los links entre docs por los del sitio, manda a GitHub los que apuntan a archivos que no están en el sitio (arquitectura, desarrollo, design system) y apunta "Editar esta página" al archivo original en `dev`. Lo que es solo del sitio, como la portada (`site/src/components/landing/`, con los textos en `site/src/data/landing.ts`), sí se edita ahí.

`sync-docs.mjs` solo orquesta: las páginas están en `site/scripts/pages.mjs`; cada cambio al Markdown, en un archivo de `site/scripts/transforms/` (el orden en que corren, en `transforms/index.mjs`), y lo que se escribe aparte (menú, `brand.json`, `llms-full.txt`, imágenes), en `site/scripts/outputs/`. Las transformaciones son funciones de Markdown a Markdown y tienen tests en `__tests__/` (los corre `yarn test`); para cambiar una, sumá el caso a su test. `yarn lint` también revisa `site/scripts/`, los `.ts` de `site/src/` y el formato de `site/astro.config.mjs` (los `.astro` no pasan por ESLint), y los `scripts/` de la raíz.

Para sumar una página, agregala a `PAGES` en `site/scripts/pages.mjs`: el orden de esa lista es el del menú. Su descripción (la de los buscadores y la vista previa al compartir el link) sale del primer párrafo después del título: las oraciones enteras que entran en 160 caracteres, y en los comprobantes, antes, "Cómo emitir una Factura A con ARCLI.". Si ese párrafo no dice para qué sirve la página, escribí una oración en `description` dentro de `PAGES`. El build falla si una página queda sin descripción, pasa de 160 caracteres o repite la de otra. Los avisos de GitHub (`> [!TIP]`, `> [!CAUTION]`…) se convierten en los avisos de colores del sitio. `obtencion-certificados.md` y `usage-patterns.md` quedan en `docs/` como índice, porque hay links que ya circulan y las versiones publicadas del CLI imprimen el de los certificados; en el sitio, sus links van a la página que tiene el contenido (`ALIASES`).

Lo que en el sitio se ve distinto que en GitHub se marca en `docs/` con un comentario, que GitHub no muestra:

| Comentario                                        | En el sitio                                                                                    |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `<!-- arcli: pasos -->`                           | Los `### 1. …` hasta el próximo `##`, como pasos numerados unidos por una línea                |
| `<!-- arcli: opciones=req\|opt\|run -->`          | Cada `### opción` (tabla Largo \| Corto \| Qué es) como tarjeta; lo genera `docs:comprobantes` |
| `<!-- arcli: familia="…" icono="…" orden="…" -->` | La familia arriba del título y el lugar en el menú de comprobantes                             |
| `<!-- arcli: chat -->`                            | La cita con **Vos:** y **Tu asistente:** como una conversación                                 |
| `<!-- arcli: muestra=error\|vista -->`            | El bloque de texto siguiente como un cartel chico                                              |
| `<!-- arcli: formas -->`                          | La tabla siguiente como filas que llevan a cada forma de uso                                   |
| `<!-- arcli: pestañas=grupo -->`                  | Los `### …` hasta el próximo `##` como pestañas; la elección se recuerda por grupo             |
| `<!-- arcli: atajos -->`                          | La tabla siguiente como la grilla de atajos por letra                                          |
| `<!-- arcli: prompt-instalacion -->`              | La línea siguiente pasa a ser el prompt de instalación del README, para copiar                 |

Un ejemplo de cada una, y los tokens, componentes y reglas de CSS del sitio, en el [design system del sitio](design-system-sitio.md). `site/scripts/transforms/__tests__/markers-docs.test.mjs` falla si una marca de los transforms no está en esta tabla o en esa página.

Además, Problemas frecuentes pasa cada problema a un desplegable con buscador y Novedades pliega las versiones viejas. Las páginas con `hidden: true` en `PAGES` (las guías completas) se generan pero no van en el menú: se llega desde el link de su versión corta. El menú y sus iconos salen de `PAGES` (`src/generated/sidebar.json`), y el comportamiento de esas páginas (pestañas, desplegables y el buscador) está en `site/src/lib/docs/`, que carga `site/src/components/MarkdownContent.astro`.

El sitio también publica `robots.txt` (permite todo y apunta a `sitemap-index.xml`, que arma Starlight), `site.webmanifest` y los íconos de respaldo del favicon (ver [Ícono](#imágenes-y-gif-del-readme)); esos están en `site/public/` y se commitean. Las visitas se cuentan con Cloudflare Web Analytics (sin cookies): el script va en `head` de `astro.config.mjs` y solo sale en el build, no en `yarn dev`.

Para asistentes de IA, el build publica en la raíz del sitio `llms.txt` (el mismo del repo), `llms-full.txt` (todas las páginas juntas) y cada página en Markdown (`/referencia/comandos.md`).

```bash
cd site
yarn install
yarn dev       # genera las páginas y abre el sitio en localhost:4321
yarn build     # genera, construye y revisa los links internos y las descripciones (scripts/check-links.mjs)
```

Se publica desde `main` con la release, así que el sitio muestra lo que está en npm. Para publicarlo sin release: Actions → Docs → Run workflow sobre `main`.

## Imágenes y GIF del README

Están en `docs/assets/demo/` y se regeneran con scripts para que no queden desactualizados:

- **GIF** (`interactivo.gif`, `consultar.gif`, `comandos.gif`) y **video promocional** (`promo.mp4`, 16:9 para redes): los graba [VHS](https://github.com/charmbracelet/vhs) a partir de los guiones de `docs/assets/tapes/`. `scripts/demo/record.sh` usa un `HOME` temporal con una copia de tu config sin las credenciales de producción, así la grabación no muestra tus rutas ni el aviso de vencimiento de ese certificado, y **emite comprobantes reales en testing**. Es para quien mantiene el repo. El certificado de testing siempre es del CUIT de quien lo genera, así que `scripts/demo/mask-cuit.mjs` lo reemplaza por `20-11111111-2` en todo lo que ARCLI escribe en la terminal.

  ```bash
  brew install vhs
  ARCLI_DEMO_CONFIG=~/Library/Preferences/arcli/config.json scripts/demo/record.sh
  ```

  Para grabar solo algunos, pasá los guiones: `scripts/demo/record.sh docs/assets/tapes/consultar.tape`. `consultar.tape` solo lee; `interactivo.tape`, `comandos.tape` y `promo.tape` emiten.

- **PDF de ejemplo** (`pdf-factura.png`): `scripts/demo/pdf-sample.mts` arma una Factura C de $ 15.000 a consumidor final, con datos ficticios, sin consultar ARCA. Necesita el plugin de PDF instalado y macOS (`qlmanage`).

  ```bash
  node --import tsx scripts/demo/pdf-sample.mts
  ```

- **Ícono** (`docs/assets/imagenes/arcliIcon.*`, los de `assets/acceso-directo/` que usa `arcli acceso-directo` y los del sitio en `site/public/`: `favicon.ico`, `apple-touch-icon.png`, `icon-192.png` e `icon-512.png`): `scripts/icono/generar.py` los arma a partir del logo ASCII. Necesita macOS (`iconutil`) y `rsvg-convert` (`brew install librsvg`).

  ```bash
  python3 scripts/icono/generar.py
  ```

El README las enlaza con URLs absolutas de `raw.githubusercontent.com` porque npmjs.com no muestra imágenes con rutas relativas.

En `docs/` van en PNG o GIF, que es lo que muestra GitHub. El sitio sirve de cada una un WebP sin pérdida (los mismos píxeles y cuadros, con la mitad o menos de peso): lo genera `site/scripts/outputs/assets.mjs` con sharp al construirlo y lo guarda en `site/node_modules/.cache/arcli-webp/`, así `yarn dev` no lo rehace si la imagen no cambió. Una captura nueva va a unos 1400 px de ancho, no a la resolución de una pantalla retina.
