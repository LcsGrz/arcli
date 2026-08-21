[← Volver al README](../README.md)

# Modelo mental

Si algún término te resulta desconocido (CAE, WSAA, padrón, punto de venta...), el [Glosario](glossary.md) los explica en una página.

La forma más útil de pensar ARCLI es esta:

```text
Input -> Validación -> Solicitud -> ARCA -> Output
```

## Flujo completo

### 1. Input

Los datos pueden venir de:

- flags
- JSON con `--cargar`
- config persistente
- defaults internos

### 2. Validación

ARCLI valida primero lo que puede resolver localmente:

- combinaciones de flags
- tipos y formatos
- reglas básicas del comprobante

### 3. Solicitud

Si la entrada pasa validación, ARCLI arma la solicitud que va a usar con ARCA.

Esa solicitud es la que ves en:

- la preview humana
- `--json`
- `--bruto`

### 4. ARCA

Si usás `--emitir`, ARCLI llama a ARCA.

Si usás `--previsualizar`, no llama a ARCA: solo arma y muestra la solicitud.

### 5. Output

Después de la solicitud, ARCLI puede devolver tres tipos de salida:

- humana
- JSON
- `--bruto`

## Prioridad de datos

ARCLI resuelve así:

```text
flags > JSON > config > defaults
```

Si un flag está presente, pisa lo demás.

## Modos

### `--previsualizar`

- no emite
- no llama a ARCA
- sirve para revisar la solicitud

### `--emitir`

- emite realmente
- llama a ARCA
- devuelve resultado real

## Salida humana vs JSON vs bruto

| Modo              | Para quién         | Contrato estable | Notas                                                |
| ----------------- | ------------------ | ---------------- | ---------------------------------------------------- |
| normal (no flags) | personas           | no               | paneles y texto amigable                             |
| `--json`          | scripts y sistemas | sí               | estructura serializada                               |
| `--bruto`         | inspección técnica | sí               | agrega respuesta cruda; `mensaje` si no hubo emisión |

## Idea clave

ARCLI no reemplaza las reglas de ARCA. Lo que hace es ordenar el flujo y hacerlo mucho más claro:

- primero entendés qué vas a enviar
- después decidís si emitir o no
- y recién ahí mirás la respuesta del servicio

## Errores mentales comunes

### “Si el CLI está bien, ARCA debería aprobar”

No necesariamente.

ARCLI puede estar armando bien el payload y aun así ARCA puede:

- observar el comprobante
- rechazarlo
- devolver un error transitorio

### “ARCLI reemplaza a ARCA”

No.

ARCLI ordena el flujo, valida bastante y mejora la experiencia. Pero la decisión final sobre un comprobante real la sigue teniendo ARCA.
