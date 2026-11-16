[← Volver a la documentación](README.md)

# Comandos y flags

Todos los comandos de ARCLI. Cada uno tiene su ayuda en la terminal: `arcli <comando> --ayuda`.

## Facturar

Un atajo por comprobante: `arcli fc` es lo mismo que `arcli factura c`. Cada uno lleva a su página, con todas sus opciones.

| Familia                       | A                                            | B                                            | C                                            | E                                       |
| ----------------------------- | -------------------------------------------- | -------------------------------------------- | -------------------------------------------- | --------------------------------------- |
| `factura`                     | [`fa`](comprobantes/factura-a.md)            | [`fb`](comprobantes/factura-b.md)            | [`fc`](comprobantes/factura-c.md)            | [`fe`](comprobantes/factura-e.md)       |
| `nota-credito`                | [`nca`](comprobantes/nota-credito-a.md)      | [`ncb`](comprobantes/nota-credito-b.md)      | [`ncc`](comprobantes/nota-credito-c.md)      | [`nce`](comprobantes/nota-credito-e.md) |
| `nota-debito`                 | [`nda`](comprobantes/nota-debito-a.md)       | [`ndb`](comprobantes/nota-debito-b.md)       | [`ndc`](comprobantes/nota-debito-c.md)       | [`nde`](comprobantes/nota-debito-e.md)  |
| `factura-credito-electronica` | [`fcea`](comprobantes/fce-a.md)              | [`fceb`](comprobantes/fce-b.md)              | [`fcec`](comprobantes/fce-c.md)              | –                                       |
| `nota-credito-electronica`    | [`ncea`](comprobantes/nota-credito-fce-a.md) | [`nceb`](comprobantes/nota-credito-fce-b.md) | [`ncec`](comprobantes/nota-credito-fce-c.md) | –                                       |
| `nota-debito-electronica`     | [`ndea`](comprobantes/nota-debito-fce-a.md)  | [`ndeb`](comprobantes/nota-debito-fce-b.md)  | [`ndec`](comprobantes/nota-debito-fce-c.md)  | –                                       |
| `recibo`                      | –                                            | –                                            | [`rc`](comprobantes/recibo-c.md)             | –                                       |

¿No sabés cuál? [¿Qué comprobante me toca?](comprobantes/README.md)

## Consultar

No emiten nada.

| Comando                           | Qué hace                                             |
| --------------------------------- | ---------------------------------------------------- |
| `arcli ultimos <tipo>`            | Los últimos comprobantes emitidos en ARCA            |
| `arcli consultar <tipo> <número>` | El detalle de un comprobante emitido                 |
| `arcli padron <cuit>`             | Nombre, domicilio y condición IVA de un CUIT         |
| `arcli fce-obligado <cuit>`       | Si un receptor está obligado a recibir FCE           |
| `arcli estado`                    | Si ARCA responde y tu punto de venta está habilitado |
| `arcli parametros [tabla]`        | Tablas de ARCA: puntos de venta, monedas, cotización |

Con ejemplos, en [consultas sin emitir](consultas.md).

## Preparar

Se usan una vez, o cada tanto.

| Comando                | Qué hace                                                                                     |
| ---------------------- | -------------------------------------------------------------------------------------------- |
| `arcli config`         | Guardar valores por defecto y revisar si está todo listo ([configuración](configuration.md)) |
| `arcli certificado`    | Pedir el certificado de ARCA y cargarlo ([certificado de testing](certificado-testing.md))   |
| `arcli pdf`            | Instalar o revisar el plugin de PDF ([PDF](pdf-en-corto.md))                                 |
| `arcli acceso-directo` | Un ícono para abrir ARCLI con doble clic                                                     |
| `arcli completado`     | Autocompletado con Tab en bash, zsh o fish                                                   |

## Ayuda

| Comando             | Qué hace                                                                         |
| ------------------- | -------------------------------------------------------------------------------- |
| `arcli interactivo` | El [asistente](formas-de-uso/asistente.md) paso a paso; también con `arcli` solo |
| `arcli ejemplos`    | Ejemplos listos para copiar de todos los comprobantes                            |
| `arcli ayuda`       | Todos los comandos; `--ayuda` en cualquiera                                      |

## Al ejecutar

Sirven en casi todos los comandos.

| Flags                           | Qué hacen                                                                          |
| ------------------------------- | ---------------------------------------------------------------------------------- |
| `--previsualizar` \| `--emitir` | Solo la vista previa, o emitir sin preguntar. Sin ninguno, vista previa y pregunta |
| `--testing` \| `--produccion`   | El entorno, si no es el de la config                                               |
| `--json` \| `--bruto`           | Salida en JSON para scripts e IAs; `--bruto` suma la respuesta cruda de ARCA       |

Todos los flags en un solo lugar, con sus valores y reglas, en la [referencia completa del CLI](cli-reference.md).
