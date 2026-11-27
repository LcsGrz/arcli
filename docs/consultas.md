[← Documentación](README.md)

# Consultas sin emitir

Comandos de solo lectura: no emiten nada y se pueden correr en testing o en producción. Todos aceptan `--json`.

## Comprobantes emitidos

```bash
arcli ultimos fb                  # últimas 15 facturas B del punto de venta configurado
arcli consultar fb 14             # detalle de la factura B número 14
```

`consultar` muestra también el comprobante asociado de una nota, el período de servicio, el vencimiento del pago, si se cobra en la misma moneda y los datos de FCE. `ultimos` acepta `--cantidad` (hasta 50) y los dos, `--pv` para otro punto de venta. También con la factura de exportación (`fe`, `nce`, `nde`). Detalle en la [referencia](cli-reference.md#consultar-comprobantes-emitidos).

## Estado de ARCA y tablas

```bash
arcli estado                      # si ARCA responde y si el punto de venta está habilitado
arcli parametros alicuotas        # una tabla de ARCA
arcli parametros cotizacion USD   # la cotización oficial del día
```

Tablas disponibles y lo que devuelve cada una: [estado y parámetros](cli-reference.md#comandos-arcli-estado-y-arcli-parametros).

## Datos de un CUIT

```bash
arcli padron 20201797064          # nombre, domicilio y condición frente al IVA
arcli fce-obligado 30546689979    # si está obligado a recibir FCE y desde qué monto
```

Los dos necesitan autorizar servicios aparte de `wsfe` ([cuáles](certificado-testing.md#qué-servicios-autorizar)). Detalle: [padrón](cli-reference.md#consultar-el-padrón) y [régimen FCE](cli-reference.md#consultar-el-régimen-fce).

## Un comprobante que recibiste

```bash
arcli constatar fa 3-1234 --emisor 30709965812 -f 10/11/2026 -m 12.100 --cae 76463926585341 --cuit 20111111112
arcli constatar --qr "https://www.arca.gob.ar/fe/qr/?p=…"   # con la dirección que trae su QR
```

ARCA dice si existe y coincide con lo que te entregaron: sale `0` si está constatado y `2` si no. Necesita autorizar `wscdc` ([cuáles](certificado-testing.md#qué-servicios-autorizar)). Detalle: [constatar](cli-reference.md#constatar-un-comprobante-recibido).
