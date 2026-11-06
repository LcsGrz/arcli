# Criterios de revisión de arcli

Lo que miramos en un PR. Las reglas generales están en [AGENTS.md](../../../AGENTS.md) y [CONTRIBUTING.md](../../../CONTRIBUTING.md): leelos primero y aplicalos también. Acá están las que no se ven en esos archivos y salieron de revisar PRs reales.

Un hallazgo es un caso concreto que se rompe o una regla concreta que no se cumple, con archivo, línea y forma de comprobarlo. Las preferencias de estilo que no están escritas acá ni en el código de al lado no son hallazgos.

## El problema

- **Causa real:** el diagnóstico del PR se sostiene con evidencia y el cambio ataca la causa, no el síntoma. Buscá en `@arcasdk/core` y en la documentación de ARCA si el problema es de ellos (en #67, el error 1606 era del SDK).
- **Medida justa:** el efecto del cambio alcanza lo que el problema necesita. Si relaja una protección, afloja una validación o amplía un default, tiene que estar justificado que no alcanzaba con menos.
- **Todos los caminos:** buscá cada lugar que comparte el comportamiento que se cambia. Los comprobantes pasan por varios servicios (`wsfe`, `wsfex`, `wsfecred`, constancia, padrón) y entornos (testing y producción): cada uno se arregla o se justifica por qué no.
- **Alcance:** el diff no trae cambios ajenos al problema, y los comprobantes siguen dentro del alcance de `AGENTS.md`.

## Paridad entre superficies

Todo lo que el CLI hace por flags existe también en lo demás. Es lo que más veces faltó (#67, #78). Por cada comando, flag o comprobante nuevo o cambiado, recorré:

- Modo interactivo (`src/cli/interactive/`), incluidos "repetir" y los selectores de comprobante asociado.
- `--json`, la vista previa y `--cargar` (lote y comprobante suelto).
- `--ayuda`, la tabla de atajos, `arcli ejemplos` y el autocompletado.
- PDF: datos, plantilla y QR, comparados con el comprobante real de ARCA cuando se pueda.
- Lo que asume todas las letras: descripciones, errores y reglas de ayuda que dicen "A, B o C" (`arcli recibo` solo tiene C).

## Diseño

- **Una sola fuente:** los datos salen del mapa o catálogo que ya existe, sin tablas paralelas (#78).
- **Sin defaults inventados:** nada específico del emisor hardcodeado; va a una clave de config más un flag (`620900` en #67).
- **Capas:** el parseo en `src/cli/`, las reglas en `src/modules/`, ARCA en `src/services/`, y los barrels de UI.
- **Precedencia completa:** flag, JSON y config, y una forma de omitir el valor configurado para un comprobante puntual (#74).
- **Flags que no aplican:** en `factura <letra>` se saltean con aviso; en los atajos estrictos son opción desconocida (#67).
- **Dependencias:** revisá antes si `@arcasdk/core` o el toolchain ya lo cubren.

## Errores

- Código de error estable y sugerencia que dice qué hacer. La falta de autorización a un servicio tiene su `*_SERVICE_NOT_AUTHORIZED`, no `UNEXPECTED_ERROR` (#67).
- Si falla una llamada que emite, `EMISSION_UNCERTAIN`, nunca una invitación a reintentar que pueda duplicar.
- Español con tildes y voseo, igual que el resto de la salida.

## Tests

- Cubren el comportamiento nuevo y el caso límite, y fallan sin el arreglo.
- Afirman lo que ve quien usa el CLI o lo que recibe ARCA, antes que detalles de implementación. Un mock de ARCA solo prueba lo que el mock supone: el cambio que depende de ARCA también se prueba contra ARCA.
- Datos ficticios: sin CUITs, certificados ni respuestas reales.
- Andan en Linux, Windows y macOS: rutas, permisos y saltos de línea.

## Docs

- Recorré la tabla de `CONTRIBUTING.md` por cada cambio visible, como hace la skill `sincronizar-docs`. Un cambio suele caer en varias filas.
- Las decisiones de diseño y las capas, en `docs/architecture.md`. Lo que le puede pasar a quien usa el CLI, en `docs/troubleshooting.md`.
- **CHANGELOG:** la entrada está en `[Sin publicar]`, nunca en una versión ya publicada (#78). Va una entrada por funcionalidad, y los bugs del propio PR no llevan "Corregido" (#67). Dice qué cambia para quien usa el CLI, en su idioma. Si fue un aporte grande, lleva crédito.
- Lo que el comando dice en los docs coincide con lo que hace: corré los ejemplos nuevos.
