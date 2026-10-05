# ARCLI

[![npm version](https://img.shields.io/npm/v/arcli.svg)](https://www.npmjs.com/package/arcli)
[![CI](https://github.com/LcsGrz/arcli/actions/workflows/ci.yml/badge.svg)](https://github.com/LcsGrz/arcli/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/npm/l/arcli.svg)](LICENSE)
[![node >=22.22.1](https://img.shields.io/node/v/arcli.svg)](package.json)

```text
       d8888 8888888b.   .d8888b.  888      8888888
      d88888 888   Y88b d88P  Y88b 888        888
     d88P888 888    888 888    888 888        888
    d88P 888 888   d88P 888        888        888
   d88P  888 8888888P"  888        888        888
  d88P   888 888 T88b   888    888 888        888
 d8888888888 888  T88b  Y88b  d88P 888        888
d88P     888 888   T88b  "Y8888P"  88888888 8888888
```

Emití o previsualizá comprobantes ARCA desde tu terminal, con un flujo claro, seguro y rapido en lugar de utilizar UI.

## Características

- configuración persistente por usuario
- previsualización segura antes de emitir
- entrada por flags o JSON
- salida humana, JSON o respuesta bruta
- **modo interactivo:** `arcli` sin argumentos abre un asistente paso a paso para emitir, repetir una factura anterior, hacer notas de crédito y débito, consultar comprobantes y configurar todo sin recordar flags
- comandos para automatizar: cada paso del asistente muestra el comando equivalente
- consultas a ARCA sin emitir: últimos comprobantes, detalle de uno, estado de los servidores, tablas y cotización oficial
- integración real con ARCA
- Factura de Crédito Electrónica (FCE) completa: CBU, transferencia, anulación y consulta del régimen del receptor
- alícuotas de IVA, importes exentos y no gravados, moneda extranjera y período asociado
- validaciones locales con las reglas del manual de ARCA, para que los errores aparezcan antes de emitir
- PDF del comprobante con el QR de ARCA, con un plugin que se descarga solo si lo usás

## Dos formas de usarlo

**Modo interactivo**, para facturar de vez en cuando sin memorizar nada:

```bash
npm install -g arcli
arcli
```

La primera vez ofrece una **configuración guiada** (CUIT, certificado, punto de venta). Después, un menú:

```text
? ¿Que queres hacer?
❯ Emitir factura
  Repetir una factura anterior
  Nota de credito o debito sobre una factura
  Ver ultimos comprobantes
  Consultar un comprobante
  Estado de ARCA
  Configuracion
  Salir
```

Pregunta solo lo necesario, muestra la vista previa y el comando equivalente, y pide confirmación antes de emitir. Ver [Modo interactivo](docs/modo-interactivo.md).

**Comandos con flags**, para scripts, automatizaciones o agentes de IA:

```bash
arcli fc -m 15000 --cs --consumidor-final --ir-cf            # vista previa
arcli fc -m 15000 --cs --consumidor-final --ir-cf --emitir   # emitir
arcli fc --cargar ./facturas.json --emitir --json            # lote desde JSON, salida JSON
```

Ver [Referencia del CLI](docs/cli-reference.md).

## Inicio rápido

### 1. Instalar

Requiere Node.js 22.22.1 o superior.

```bash
npm install -g arcli
```

### 2. Configurar

La forma más simple es abrir el asistente y seguir la **configuración guiada**:

```bash
arcli
```

Si preferís hacerlo con comandos (por ejemplo, en un servidor), seguí los pasos 3 y 4. Para ver o crear la configuración:

```bash
arcli config
```

### 3. Guardar defaults útiles

```bash
arcli config establecer cuit 20168598204
arcli config establecer puntoVenta 3
arcli config establecer concepto servicios
arcli config establecer ivaReceptor consumidor-final
arcli config establecer moneda ARS
arcli config establecer cotizacion 1
arcli config establecer emitir false
arcli config establecer bruto false
```

### 4. Configurar credenciales

```bash
arcli config establecer cert.testing /ruta/al/certificado.crt
arcli config establecer key.testing /ruta/a/la/clave.key
```

Si después querés usar producción:

```bash
arcli config establecer cert.produccion /ruta/al/certificado.crt
arcli config establecer key.produccion /ruta/a/la/clave.key
```

### 5. Revisar el entorno activo

```bash
arcli config revisar
```

### 6. Previsualizar el primer comprobante

```bash
arcli fc -m 15000 --cs --consumidor-final --ir-cf
```

### 7. Emitir de verdad

```bash
arcli fc -m 15000 --cs --consumidor-final --ir-cf --emitir
```

## Cómo funciona

ARCLI toma datos por flags, JSON o config, valida lo que puede localmente, arma el payload y — si corresponde — llama a ARCA. La prioridad es `flags > JSON > config > defaults`.

Ver [docs/mental-model.md](docs/mental-model.md) para el modelo completo.

## Seguridad: testing vs producción

- Si no pasás nada, el entorno es `testing`.
- `testing` usa `cert.testing` y `key.testing`.
- `produccion` usa `cert.produccion` y `key.produccion`.
- Para emitir realmente en producción hacen falta:
  - `--produccion`
  - `--emitir`

Ejemplo:

```bash
arcli fa -m 15000 --cs --cuit 20168598204 --ir-ri \
  --produccion \
  --emitir
```

## Documentación

- [Modelo mental](docs/mental-model.md)
- [Glosario](docs/glossary.md)
- [Referencia del CLI](docs/cli-reference.md)
- [Modo interactivo](docs/modo-interactivo.md)
- [Patrones de uso](docs/usage-patterns.md)
- [Configuración](docs/configuration.md)
- [PDF de comprobantes](docs/pdf.md)
- [Cómo obtener los certificados de ARCA](docs/obtencion-certificados.md)
- [Entrada y salida](docs/input-output.md)
- [Reglas de validación](docs/validation-rules.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Limitaciones actuales](docs/limitations.md)
- [Guía de desarrollo](docs/development.md)
- [Testing](docs/ui-smoke-checklist.md)
- [Changelog](CHANGELOG.md)
- [Cómo contribuir](CONTRIBUTING.md)
- [llms.txt](llms.txt): referencia condensada para que un agente/IA con acceso a terminal ejecute el CLI directamente
- [Seguridad](SECURITY.md)

## ❤️ Agradecimientos

ARCLI existe apoyado en trabajo open source que ya resolvió partes difíciles del problema. En particular:

- [`@arcasdk/core`](https://github.com/ralcorta/arcasdk) y [`@arcasdk/pdf`](https://www.afipts.com/packages/pdf), creadas por [Rodrigo Alcorta](https://github.com/ralcorta)
- [Arpit Bhayani](https://github.com/arpitbbhayani) por cederme el paquete de npm bajo el nombre de 'arcli', estaba siendo utilizado por el.

Y la comunidad open source que mantiene herramientas de este estilo vivas y usables

## ☕ Apoyar el proyecto

ARCLI es open source. Mantenerlo, probarlo contra servicios reales y documentarlo bien lleva tiempo.

- Si queres darme un mimo: [Cafesito](https://cafecito.app/lcsgrz)
- Reporta issues claros, repros buenos y feedback real de uso
- Dejame tu estrellita ★ :)

## Licencia

MIT © [LcsGrz](https://github.com/LcsGrz). Ver [LICENSE](LICENSE).

## Proyecto

- repo: [github.com/LcsGrz/arcli](https://github.com/LcsGrz/arcli)
- issues: [github.com/LcsGrz/arcli/issues](https://github.com/LcsGrz/arcli/issues)
