# AGENTS.md

Instrucciones para agentes que modifican el código de este repo. Para usar el CLI desde un agente, ver [llms.txt](llms.txt).

## Proyecto

`arcli` es un CLI de TypeScript (ESM, Node.js) para previsualizar y emitir comprobantes ARCA, publicado en npm. Usa `@arcasdk/core` para hablar con ARCA. Tiene dos formas de uso: comandos con flags y un modo interactivo (`arcli` sin argumentos).

Alcance de comprobantes (no ampliar sin pedido explícito): Factura, Nota de Crédito y Nota de Débito A, B y C, sus versiones de Factura de Crédito Electrónica (FCE), la Factura de exportación E (WSFEX) con sus notas de crédito y débito, y Recibo C.

## Mapa del código

- `src/cli/`: registro de comandos, ayuda y modo interactivo (`interactive/`). Sin lógica de negocio.
- `src/modules/`: lógica por dominio (`billing`, `config`, `pdf`, `parameters`, `vouchers`, `fce`, etc.).
- `src/services/`: adaptadores sobre `@arcasdk/core` (`arca/`) y el plugin de PDF (`pdf/`).
- `src/ui/`: primitivas, componentes y presenters de terminal.
- `src/lib/`: utilidades puras.
- Tests colocados en `src/**/__tests__/`.
- `site/`: sitio de documentación (Starlight, GitHub Pages) con su propio `package.json`. Sus páginas se generan desde `docs/`: se edita `docs/`, nunca lo generado en `site/`.

Detalle de capas y cómo extender: [docs/architecture.md](docs/architecture.md).

Reglas de la salida en terminal (paneles, colores, símbolos, formatos y textos): [docs/design-system.md](docs/design-system.md).

Imports de UI: `src/ui` no importa `modules`, `services` ni `cli`. En `lib`, `modules` y `services`, usá los sub-barrels (`src/ui/primitives`, `components`, `presenters`, `stream`, `theme`), no `src/ui`; `cli` puede usar `src/ui`. Dentro de `src/ui`, imports directos entre archivos. ESLint lo hace cumplir.

## Comandos

Gestor de paquetes: `yarn` (no mezclar lockfiles).

- `yarn install`
- `yarn dev --ayuda`: correr el CLI desde `src/`
- `yarn typecheck`, `yarn lint`, `yarn test`
- `yarn open-source:check`: typecheck, tests con cobertura, build y `pack:check` (instala el paquete y corre `arcli --version` y `--ayuda`)

Antes de dar por terminado un cambio significativo: `yarn typecheck`, `yarn lint` y `yarn test`. En Claude Code, un hook al terminar cada respuesta ya corre typecheck, ESLint y los tests relacionados si cambió `src/`, así que no hace falta correrlos a mano después de cada edición; la suite completa sí, antes de abrir un PR. Detalle en [docs/development.md](docs/development.md#trabajar-con-agentes).

- Editá archivos con la herramienta de edición del agente. `sed` o scripts solo para reemplazos mecánicos en muchos archivos: fallan sin aviso y no se ven en el diff hasta el final.
- Los docs también se testean: `docs-sync.test.ts` falla si un comando, flag o clave de config no aparece en `docs/` y `llms.txt`, y `examples-valid.test.ts` pasa cada bloque `bash` de `docs/`, `README.md` y `llms.txt` por el parser real. `yarn lint` corre Prettier sobre `docs/**/*.md`, `AGENTS.md` y `README.md`: si falla por tablas desalineadas, `yarn lint:prettier:fix`.
- Para esperar el CI de un PR, `gh pr checks <N> --watch` en segundo plano, no `sleep` en loop.

## Ramas

`main` es lo publicado en npm (y la rama default de GitHub, para que quien entra al repo vea lo publicado) y `dev`, donde se trabaja. Detalle en [docs/development.md](docs/development.md#ramas).

- Todo cambio sale de `dev` y vuelve con un PR a `dev` (squash): `gh pr create --base dev`, porque sin `--base` va a `main`. La base es siempre `dev`, nunca la rama de otro PR.
- Un PR a `main` es solo una release (`release/vX.Y.Z` desde `dev`, con la skill `release`) o un hotfix de algo ya publicado (rama desde `main`). Si un PR de trabajo apunta a `main`, cambiá la base a `dev` antes de mergear.
- Después de cada release o hotfix, `main` vuelve a `dev` con un PR `main` → `dev` mergeado con **merge commit**, nunca squash: con squash, la próxima release trae conflictos.

## Convenciones de código

- TypeScript estricto; validar explícitamente toda entrada del usuario.
- Mantener el parseo de la CLI separado de las llamadas a ARCA y de las reglas de negocio.
- Preferir funciones puras en `lib` y `modules`.
- Modelar tipos de comprobante y flags con constantes tipadas o uniones discriminadas, no con números mágicos.
- No hardcodear CUITs, certificados, rutas de tickets, puntos de venta ni defaults de comprobantes en módulos reutilizables.
- Antes de agregar una dependencia, revisar si `@arcasdk/core` o el toolchain actual ya lo cubre.
- Cambios incrementales y enfocados; el CLI tiene que seguir corriendo después de cada paso.

## Contrato público

Comandos, flags, claves de config y formatos JSON son contrato público y no cambian en silencio.

- Si un cambio rompería la sintaxis del CLI, pausá y documentá el tradeoff antes de implementarlo.
- La salida humana no es contrato; `--json` sí.
- Los cambios de comportamiento actualizan la documentación correspondiente (ver la tabla en [CONTRIBUTING.md](CONTRIBUTING.md#documentación)) y, si afectan a quien usa el CLI, [CHANGELOG.md](CHANGELOG.md).
- Las decisiones de arquitectura se registran en [docs/architecture.md](docs/architecture.md).

## Seguridad

- No commitear certificados, claves privadas, tokens ni `.env`.
- Los secretos se resuelven desde rutas de archivo configuradas por el usuario, nunca desde el código.
- No loguear respuestas de ARCA ni rutas sensibles sin necesidad.
- `testing` es el entorno por defecto y `emitir` es `false`: sin `--emitir`, en una terminal se pregunta antes de emitir. Con `entorno produccion` y `emitir true` en la config se emite en producción sin flags; es a propósito, para usuarios que no quieren confirmar cada vez.

## Notas

- Si el usuario pide planificar primero, no implementes: alineá antes diseño de comandos, módulos y seguridad.
- Verificá la estructura real antes de asumir que una ruta existe.
