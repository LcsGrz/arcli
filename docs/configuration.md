[← Volver al README](../README.md)

# Configuración

Cómo funciona la configuración persistente de ARCLI y qué conviene dejar guardado.

## Propósito

La config persistente existe para guardar:

- credenciales por entorno
- defaults funcionales
- defaults de salida

Eso evita repetir siempre el mismo `cuit`, `puntoVenta`, concepto, IVA receptor o flags de salida.

## Ubicación del archivo

ARCLI usa `conf` con:

- `projectName: arcli`
- `configName: config`

La ubicación exacta depende del sistema operativo. Para verla:

```bash
arcli config ruta
```

Si el archivo no existe, `arcli config` lo crea automáticamente.

## Claves soportadas

| Clave             | Tipo                    | Valor por defecto | Descripción                            |
| ----------------- | ----------------------- | ----------------- | -------------------------------------- |
| `cert.testing`    | string                  | ninguno           | Ruta al certificado de testing         |
| `cert.produccion` | string                  | ninguno           | Ruta al certificado de producción      |
| `key.testing`     | string                  | ninguno           | Ruta a la clave privada de testing     |
| `key.produccion`  | string                  | ninguno           | Ruta a la clave privada de producción  |
| `cuit`            | string                  | ninguno           | CUIT del emisor                        |
| `concepto`        | string                  | ninguno           | Concepto por defecto                   |
| `cotizacion`      | number                  | `1`               | Cotización por defecto                 |
| `entorno`         | `testing \| produccion` | `testing`         | Entorno por defecto                    |
| `emitir`          | boolean                 | `false`           | Emisión por defecto                    |
| `ivaReceptor`     | string                  | ninguno           | IVA receptor por defecto               |
| `json`            | boolean                 | `false`           | Salida JSON por defecto                |
| `moneda`          | string                  | `ARS`             | Moneda por defecto                     |
| `bruto`           | boolean                 | `false`           | Respuesta bruta por defecto            |
| `puntoVenta`      | number                  | ninguno           | Punto de venta por defecto             |
| `ticketPath`      | string                  | ver abajo         | Carpeta donde se guarda el ticket WSAA |

> Para claves booleanas, ARCLI acepta `true` / `false`, `sí` / `no` o `1` / `0`.

### Ticket WSAA (`ticketPath`)

Para autenticarse contra ARCA, el SDK pide un ticket de acceso (WSAA) que dura 12 horas y tiene rate limit estricto (1 request cada 2 minutos en producción, cada 10 minutos en testing). Ese ticket se guarda en disco para reutilizarlo entre corridas.

Por defecto, ARCLI lo guarda en una carpeta `tickets/` junto al `config.json` (ver `arcli config ruta`), para que sobreviva a reinstalaciones o actualizaciones del paquete. Si preferís otra ubicación:

```bash
arcli config establecer ticketPath /ruta/que/prefieras
arcli config eliminar ticketPath
```

## Prioridad de fuentes

ARCLI resuelve los datos en este orden:

1. flags
2. JSON cargado con `--cargar`
3. config persistente
4. defaults internos

Ejemplo:

- si pasás `--moneda USD`, gana eso
- si no pasás `--moneda` pero el JSON trae `codigoMoneda`, gana el JSON
- si no hay JSON, usa `moneda` de config
- si tampoco hay config, cae en el default interno

## Comandos de configuración

### Ver configuración actual

```bash
arcli config
```

### Ver ruta del archivo

```bash
arcli config ruta
```

### Revisar configuración activa

```bash
arcli config revisar
arcli config revisar --testing
arcli config revisar --produccion
```

`config revisar` combina:

- el estado de la config persistente
- la validación real del entorno que ARCLI intentaría usar

### Guardar o eliminar valores

```bash
arcli config establecer puntoVenta 3
arcli config eliminar puntoVenta
```

### Validación al guardar credenciales

Cuando se guarda `cert.*` o `key.*`, ARCLI valida:

- que la ruta exista
- que el archivo tenga formato PEM válido

¿Todavía no tenés el certificado y la clave? Ver
[Cómo obtener los certificados de ARCA](obtencion-certificados.md).

## Cuándo usar config vs flags

Usá config para defaults que se repiten en el flujo diario:

- `cuit`
- `puntoVenta`
- `concepto`
- `ivaReceptor`
- `moneda`
- `cotizacion`

Si un valor aparece en flags, pisa lo que venga de JSON, config o defaults internos.

## Ejemplo completo real

Un setup razonable para uso diario en testing:

```bash
arcli config
arcli config establecer cuit 20168598204
arcli config establecer puntoVenta 3
arcli config establecer concepto servicios
arcli config establecer ivaReceptor consumidor-final
arcli config establecer moneda ARS
arcli config establecer cotizacion 1
arcli config establecer emitir false
arcli config establecer bruto false
arcli config establecer cert.testing /ruta/al/certificado.crt
arcli config establecer key.testing /ruta/a/la/clave.key
arcli config revisar
```

## Advertencias

### `emitir=true`

Si guardás:

```bash
arcli config establecer emitir true
```

ARCLI va a asumir emisión real por defecto cuando no pases `--previsualizar`. Eso puede ser cómodo, pero también hace más fácil emitir sin querer en flujos repetitivos.

Si no estás muy seguro, dejalo en `false`.
