# AGENTS.md

Instrucciones para agentes que modifican el código de este repo. Para usar el CLI desde un agente, ver [llms.txt](llms.txt).

## Proyecto

`arcli` es un CLI de TypeScript (ESM, Node.js) para previsualizar y emitir comprobantes ARCA, publicado en npm. Usa `@arcasdk/core` para hablar con ARCA. Tiene dos formas de uso: comandos con flags y un modo interactivo (`arcli` sin argumentos).

Alcance de comprobantes (no ampliar sin pedido explícito): Factura, Nota de Crédito y Nota de Débito A, B y C, sus versiones de Factura de Crédito Electrónica (FCE), la Factura de exportación E (WSFEX) con sus notas de crédito y débito, y Recibo A, B y C.

## Mapa del código

- `src/cli/`: registro de comandos, ayuda y modo interactivo (`interactive/`). Sin lógica de negocio: las reglas del modo interactivo van en `src/modules/interactive/`.
- `src/modules/`: lógica por dominio (`billing`, `config`, `pdf`, `parameters`, `vouchers`, `fce`, etc.).
- `src/services/`: adaptadores sobre `@arcasdk/core` (`arca/`) y el plugin de PDF (`pdf/`).
- `src/ui/`: primitivas, componentes y presenters de terminal.
- `src/lib/`: utilidades puras.
- Tests colocados en `src/**/__tests__/`.
- `site/`: sitio de documentación (Starlight, GitHub Pages) con su propio `package.json`. Sus páginas se generan desde `docs/`: se edita `docs/`, nunca lo generado en `site/`.

Detalle de capas y cómo extender: [docs/architecture.md](docs/architecture.md).

Reglas de la salida en terminal (paneles, colores, símbolos, formatos y textos): [docs/design-system.md](docs/design-system.md). Las del sitio (tokens, componentes, marcas `<!-- arcli: … -->` y CSS): [docs/design-system-sitio.md](docs/design-system-sitio.md).

El núcleo (`modules` y `lib`) no sabe quién lo llama y devuelve datos, no texto: ver [Núcleo y adaptadores](docs/architecture.md#núcleo-y-adaptadores). Las fronteras entre capas las hace cumplir ESLint; un `warn` es deuda con ticket, no un patrón para copiar.

## Comandos

Gestor de paquetes: `yarn` (no mezclar lockfiles).

- `yarn dev <comando>`: correr el CLI desde `src/`. `yarn dev storybook` muestra la UI sin llamar a ARCA.
- `yarn open-source:check`: lo mismo que el CI. Los scripts están en `package.json` y [docs/development.md](docs/development.md#scripts).

Antes de dar por terminado un cambio: `yarn typecheck`, `yarn lint` y `yarn test`. En Claude Code, un hook al terminar cada respuesta ya corre typecheck, ESLint y los tests relacionados si cambió `src/`, así que no hace falta correrlos a mano después de cada edición. Antes de abrir un PR: `yarn lint` y `yarn open-source:check` (incluye build y e2e). Detalle en [docs/development.md](docs/development.md#trabajar-con-agentes).

- Editá archivos con la herramienta de edición del agente. `sed` o scripts solo para reemplazos mecánicos en muchos archivos: fallan sin aviso y no se ven en el diff hasta el final.
- Para esperar el CI de un PR, `gh pr checks <N> --watch` en segundo plano, no `sleep` en loop.

## Ramas

`main` es lo publicado en npm (y la rama default de GitHub, para que quien entra al repo vea lo publicado) y `dev`, donde se trabaja. Detalle en [docs/development.md](docs/development.md#ramas).

- Todo cambio sale de `dev` y vuelve con un PR a `dev` (squash): `gh pr create --base dev`, porque sin `--base` va a `main`. La base es siempre `dev`, nunca la rama de otro PR.
- Un PR a `main` es solo una release (`release/vX.Y.Z` desde `dev`, con la skill `release`) o un hotfix de algo ya publicado (rama desde `main`). Si un PR de trabajo apunta a `main`, cambiá la base a `dev` antes de mergear.
- Después de cada release o hotfix, `main` vuelve a `dev` con merge commit (ver la skill `release`).

## Convenciones de código

Cómo se decide (reutilizar antes de escribir, cuándo abstraer, cuánto control lleva cada cambio y cuándo está terminado): [docs/estandares.md](docs/estandares.md).

- Validar explícitamente toda entrada del usuario.
- Mantener el parseo de la CLI separado de las llamadas a ARCA y de las reglas de negocio.
- Preferir funciones puras en `lib` y `modules`.
- Modelar tipos de comprobante y flags con constantes tipadas o uniones discriminadas, no con números mágicos.
- No hardcodear CUITs, certificados, rutas de tickets, puntos de venta ni defaults de comprobantes en módulos reutilizables.
- Antes de agregar una dependencia, revisar si `@arcasdk/core` o el toolchain actual ya lo cubre.
- El CLI tiene que seguir corriendo después de cada paso.

## Contrato público

Comandos, flags, claves de config y formatos JSON son contrato público y no cambian en silencio.

- Si un cambio saca o renombra un comando, flag, clave de config o campo de `--json`, o cambia lo que hace un comando existente (también un default), frená y planteale a la persona el tradeoff y la transición antes de implementarlo: hay usuarios externos, y lo viejo queda deprecado hasta la próxima versión mayor.
- La salida humana no es contrato; `--json` sí.
- Un cambio visible actualiza las filas que le tocan de la tabla de [CONTRIBUTING.md](CONTRIBUTING.md#documentación) (en Claude Code, skill `sincronizar-docs`) y, si afecta a quien usa el CLI, [CHANGELOG.md](CHANGELOG.md). `docs-sync.test.ts` controla que cada comando, flag y clave aparezca en `docs/` y `llms.txt`, y `examples-valid.test.ts` pasa por el parser real los ejemplos de facturación y los JSON de `--cargar`; el resto de los ejemplos se prueban con `yarn dev`. Si Prettier falla por tablas desalineadas, `yarn lint:prettier:fix`.
- Las decisiones de arquitectura se registran en [docs/architecture.md](docs/architecture.md).

## Seguridad

- No commitear certificados, claves privadas, tokens ni `.env`.
- Los secretos se resuelven desde rutas de archivo configuradas por el usuario, nunca desde el código.
- La salida y los logs muestran las respuestas crudas de ARCA solo con `--bruto`, y nunca el contenido de certificados, claves ni tickets.
- `testing` es el entorno por defecto y `emitir` es `false`: sin `--emitir`, en una terminal se pregunta antes de emitir. Con `entorno produccion` y `emitir true` en la config se emite en producción sin flags; es a propósito, para usuarios que no quieren confirmar cada vez.
