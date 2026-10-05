[← Volver al README](../README.md)

# Desarrollo

Guía para contributors y para cualquiera que quiera tocar el código sin romper el contrato público del CLI.

## Por dónde empezar

Si recién caés al repo, este orden suele rendir bastante bien:

1. `README.md`
2. `docs/mental-model.md`
3. `docs/cli-reference.md`
4. `src/cli/program.ts`
5. `src/modules/billing/`

Con eso ya ves:

- qué promete el CLI
- cómo fluye la ejecución
- dónde vive cada responsabilidad

## Setup

```bash
yarn install
```

## Filosofía del proyecto

- CLI-first: el flujo principal se piensa desde terminal, no desde una UI gráfica.
- contrato estable: cambiar nombres o formas de uso cuesta más que sumar una mejora interna.
- claridad antes que magia: si algo importante está pasando, idealmente el usuario debería poder verlo en el payload, en la ayuda o en la salida.

## Scripts útiles

| Script                   | Qué hace                                                     |
| ------------------------ | ------------------------------------------------------------ |
| `yarn dev --ayuda`       | Ejecuta la ayuda principal del CLI en modo desarrollo        |
| `yarn build`             | Compila TypeScript a `dist`                                  |
| `yarn typecheck`         | Corre chequeo de tipos sobre código y tests                  |
| `yarn test`              | Corre la suite de Vitest                                     |
| `yarn test:coverage`     | Corre la suite con cobertura (falla si baja el piso)         |
| `yarn lint`              | Ejecuta ESLint + Prettier check                              |
| `yarn pack:check`        | Simula el empaquetado npm                                    |
| `yarn open-source:check` | `typecheck`, `test:coverage`, `build` y `npm pack --dry-run` |

## Arquitectura actual

El flujo principal hoy es:

```text
CLI (commander)
  -> parseo y validación inicial
  -> resolución de config y entorno ARCA
  -> billing service
  -> gateway ARCA
  -> presenters / stream de salida
```

En términos de carpetas:

- `src/cli/`
  - contrato del programa
  - registro de comandos
  - help
- `src/modules/billing/`
  - parseo específico de comprobantes
  - reglas de negocio
  - construcción de payload
  - serialización y presenters de billing
- `src/modules/config/`
  - schema
  - storage persistente
  - reporte de revisión
- `src/services/arca/`
  - resolución del runtime
  - cliente y gateway contra ARCA
- `src/ui/`
  - primitives, components, presenters y stream de salida

Convención importante de imports:

- fuera de `src/ui`, consumí la UI desde `src/ui` o sus sub-barrels públicos
- dentro de `src/ui`, mantené imports directos entre archivos para no abrir dependencias circulares innecesarias
- evitá volver a importar desde rutas largas como `src/ui/primitives/...` fuera del propio módulo UI

## Tests

Los tests unitarios viven colocalizados con el código, dentro de carpetas `__tests__`.

Ejemplos:

- `src/modules/billing/__tests__/`
- `src/modules/config/__tests__/`
- `src/services/arca/__tests__/`
- `src/ui/primitives/__tests__/`

La idea es simple:

- código y tests del mismo módulo quedan cerca
- `build` no publica tests
- `typecheck` sí los valida

### Antes de cerrar cambios

```bash
yarn typecheck
yarn test
```

Para cambios de publicación o empaquetado:

```bash
yarn open-source:check
```

## Cómo agregar comandos sin romper el contrato

### Comandos de comprobantes

Los comprobantes no se registran “a mano” uno por uno. El mapa central está en:

- `src/modules/billing/voucher-kind-map.ts`

Si agregás un nuevo comprobante dentro del alcance del proyecto:

1. actualizá el mapa tipado
2. mantené consistencia entre shortcut, familia, letra y tipo ARCA
3. no metas lógica de negocio en `src/cli/`

### Ejemplo real: agregar una nueva familia o tipo

El patrón correcto hoy sería:

1. definir el comprobante en `voucher-kind-map.ts`
2. asegurarte de que `registerBillingShortcutCommands` y `registerBillingFamilyCommands` lo tomen automáticamente desde el mapa
3. agregar o ajustar reglas en `billing.service.ts` si cambia algo de negocio
4. actualizar tests y documentación

### Comandos de configuración

Si agregás una nueva clave pública:

1. actualizá `configPublicKeySchema`
2. actualizá el mapeo interno en `ConfigService`
3. documentala en:
   - `docs/configuration.md`
   - `docs/cli-reference.md`

## CI y publicación

El repo tiene dos workflows de GitHub Actions:

- `CI`
  - corre en push y pull request
  - ejecuta `yarn lint`, `yarn typecheck`, `yarn test:coverage` y `yarn build`
- `Release`
  - se ejecuta manualmente desde GitHub Actions con `workflow_dispatch`
  - vuelve a correr validaciones y después publica a npm

`Release` publica con [npm Trusted Publishers](https://docs.npmjs.com/trusted-publishers) (OIDC): no usa `NPM_TOKEN`. El paquete `arcli` en npm tiene que tener configurado este repo y el workflow `release.yml` como publicador de confianza. El job necesita `id-token: write` y npm 11.5.1 o superior (Node 24).

### Cómo sacar una versión

1. Crear una rama `release/vX.Y.Z`.
2. Pasar las entradas de "Sin publicar" en `CHANGELOG.md` a una sección `[X.Y.Z] - AAAA-MM-DD` y actualizar los links de comparación al final.
3. Subir la versión en `package.json` y en `src/cli/version.ts`. Un test verifica que coincidan.
4. Abrir el PR, esperar el CI y mergear.
5. Crear el tag `vX.Y.Z` sobre el commit mergeado y la release de GitHub con las notas del changelog.
6. Correr el workflow `Release` desde GitHub Actions.

Versionado: cambios que rompen el contrato del CLI → mayor; flags, comandos o claves nuevas, y validaciones que adelantan rechazos de ARCA → menor; correcciones sin cambio de contrato → patch.

Para cambios visuales de terminal:

```bash
yarn dev storybook
```

Y como complemento:

- [Checklist visual](ui-smoke-checklist.md)

## Cómo no romper el contrato del CLI

- No renombres comandos ni flags sin una decisión explícita.
- No cambies claves públicas de config sin actualizar docs, help y tests.
- No uses la salida humana como contrato de automatización.
- Si tocás JSON, revisá:
  - `docs/input-output.md`
  - tests de presenter/serialización
- Si tocás validaciones, revisá:
  - `docs/validation-rules.md`
  - tests de billing/config

## Storybook de terminal

Sirve para iterar la UI sin pegarle a ARCA:

```bash
yarn dev storybook
yarn dev storybook colores
yarn dev storybook componentes
yarn dev storybook comprobantes
yarn dev storybook configuracion
yarn dev storybook errores
yarn dev storybook json
```

## Documentación pública

- [README](../README.md)
- [Modelo mental](mental-model.md)
- [Glosario](glossary.md)
- [Referencia del CLI](cli-reference.md)
- [Patrones de uso](usage-patterns.md)
- [Configuración](configuration.md)
- [Entrada y salida](input-output.md)
- [Reglas de validación](validation-rules.md)
- [Troubleshooting](troubleshooting.md)
- [Limitaciones actuales](limitations.md)
- [Checklist visual](ui-smoke-checklist.md)

## Imágenes y GIF del README

Están en `docs/assets/demo/` y se regeneran con scripts, para que no queden desactualizados:

- **GIF** (`interactivo.gif`, `comandos.gif`): los graba [VHS](https://github.com/charmbracelet/vhs) a partir de los guiones de `docs/assets/tapes/`. `scripts/demo/record.sh` usa un `HOME` temporal con una copia de tu config, así la grabación no muestra tus rutas, y **emite comprobantes reales en testing**.

  ```bash
  brew install vhs
  ARCLI_DEMO_CONFIG=~/Library/Preferences/arcli/config.json scripts/demo/record.sh
  ```

- **PDF de ejemplo** (`pdf-factura.png`): `scripts/demo/pdf-sample.mts` arma una Factura B con datos ficticios (no consulta ARCA). Necesita el plugin de PDF instalado y macOS (`qlmanage`).

  ```bash
  node --import tsx scripts/demo/pdf-sample.mts
  ```

El README las enlaza con URLs absolutas de `raw.githubusercontent.com`, porque npmjs.com no muestra imágenes con rutas relativas.
