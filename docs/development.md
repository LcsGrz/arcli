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

Para que `Release` pueda publicar, el repo necesita este secret en GitHub:

- `NPM_TOKEN`

Ruta sugerida:

1. GitHub repo
2. `Settings`
3. `Secrets and variables`
4. `Actions`
5. `New repository secret`

Valor:

- un token válido de npm con permisos para publicar `arcli`

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
