[← Volver a la documentación](README.md)

# Design system de la terminal

Reglas para la salida humana de `arcli`: qué panel, color, símbolo y formato usar. Son para quien agrega o cambia una pantalla. La salida humana no es contrato y puede cambiar; el contrato es `--json`, que estas reglas no tocan.

El código vive en `src/ui`: tokens en [`theme/theme.ts`](../src/ui/theme/theme.ts), piezas básicas en `primitives/` y paneles en `components/`. Fuera de `src/ui`, importá desde los barrels. Para ver todo sin llamar a ARCA: `yarn dev storybook`.

## Principios

1. **Primero el dato.** Lo que no aporta no se muestra: una fila en cero que nadie cargó, un contador vacío, una etiqueta que repite el título.
2. **Se lee sin color.** El color refuerza, nunca es el único aviso. Con `NO_COLOR`, redirigida o en ASCII, la salida tiene que decir lo mismo.
3. **Un dato, un formato.** El mismo CUIT o importe se ve igual en todos los comandos.
4. **Funciona en cualquier terminal.** De 40 a 140 columnas, fondo claro u oscuro, Unicode o ASCII.

## Color

Solo tokens de `UI_THEME.colors`, cada uno con un significado. No se usan como adorno ni para distinguir cosas que no tienen ese significado.

| Token        | Significa                                             |
| ------------ | ----------------------------------------------------- |
| `success`    | Salió bien: aprobado, chequeo correcto                |
| `danger`     | Error o rechazo                                       |
| `warning`    | Requiere atención: observaciones, avisos, sugerencias |
| `info`       | Títulos de sección y barra de comandos                |
| `muted`      | Secundario: etiquetas de config, datos sin cargar     |
| `subtle`     | Títulos de datos crudos: se ven, sin competir         |
| `neutral`    | Color por defecto de la terminal                      |
| `highlight`  | Invita a una acción, como actualizar arcli            |
| `testing`    | El entorno de testing                                 |
| `production` | El entorno de producción                              |
| `debug`      | Solo storybook                                        |

## Paneles

Se elige por lo que se muestra, no por cómo se ve. Cada rol tiene su borde y distingue el panel aunque no haya color.

| Contenido                                  | Borde       | Color            |
| ------------------------------------------ | ----------- | ---------------- |
| Comprobante: vista previa y resultado      | `ticket`    | Según estado     |
| Errores del CLI o de ARCA                  | `error`     | `danger`         |
| Observaciones y avisos                     | `attention` | `warning`        |
| Sugerencias                                | `tip`       | `warning`        |
| Fichas de consulta: config, padrón, FCE    | `sheet`     | Según estado     |
| Revisión con veredicto al pie              | `checklist` | Según veredicto  |
| Listados en tabla                          | `listing`   | Sin color        |
| Aviso de una o dos líneas                  | `note`      | `muted` o `info` |
| Banner de entorno o certificado por vencer | `warning`   | `warning`        |
| Nueva versión                              | `info`      | `info`           |
| JSON y respuesta bruta                     | `data`      | `subtle`         |
| Comando para copiar                        | `command`   | `info`           |

- **Un comando va en `command`**, sin borde a la derecha: así se copia sin arrastrar caracteres.
- **Títulos** en mayúscula, los pone el panel. El pie lleva el estado o el veredicto.
- **Mensajes de ARCA** como lista (`formatArcaMessages`), nunca JSON crudo. El JSON es para `--bruto`.

## Layout

- **Ancho:** los paneles miden 92 columnas y se achican con la terminal, con un mínimo de 24. El comprobante mide entre 68 y 80, según su contenido, y va centrado.
- **Filas etiqueta/valor:** el valor en una columna alineada. Si una fila no entra y su columna no deja lugar, todas las de esa columna ponen la etiqueta arriba y el valor debajo (`wrapPanelLines`).
- **Listas:** `• texto` o `1. texto`. Al partirse, la línea sigue alineada al texto.
- **Barra de estado:** una línea; en una terminal angosta, una por lado. Nunca esconde el entorno.

## Símbolos

Se piden con `uiSymbol('check')`, nunca escritos a mano en un presenter. Cada uno tiene su respaldo para `ARCLI_ASCII=1`, que cambia bordes y símbolos pero no las tildes ni la `ñ`. Un símbolo nuevo se agrega en `UI_THEME.symbols`.

| Nombre       | Unicode | ASCII          | Para                   |
| ------------ | ------- | -------------- | ---------------------- |
| `check`      | `✓`     | `v`            | Chequeo correcto       |
| `done`       | `✔`     | `v`            | Pregunta respondida    |
| `bullet`     | `•`     | `-`            | Listas                 |
| `separator`  | `·`     | `-`            | Datos en una línea     |
| `ellipsis`   | `…`     | `...`          | Texto recortado        |
| `arrow`      | `→`     | `->`           | Ruta en un menú        |
| `back`       | `←`     | `<`            | Volver                 |
| `pointer`    | `❯`     | `>`            | Cursor en una lista    |
| `rule`       | `┈`     | `-`            | Regla de un listado    |
| `selected`   | `◉`     | `[x]`          | Opción seleccionada    |
| `unselected` | `◯`     | `[ ]`          | Opción sin seleccionar |
| `keysMove`   | `↑↓`    | `arriba/abajo` | Ayuda de teclas        |
| `keyEnter`   | `⏎`     | `enter`        | Ayuda de teclas        |

## Formatos

Cada dato tiene su helper. Antes de escribir un formato, buscá si ya existe.

| Dato              | Se ve                         | Helper                   |
| ----------------- | ----------------------------- | ------------------------ |
| Pesos             | `$ 1.500`, `$ 1.500,50`       | `formatMoneyLabel`       |
| Moneda extranjera | `1.500,50 USD`                | `formatMoneyLabel`       |
| Cotización        | `1.250,50`, hasta 6 decimales | `formatExchangeRate`     |
| Porcentaje        | `21%`, `10,5%`                | `resolveIvaRateLabel`    |
| CUIT o CUIL       | `20-33333333-4`               | `formatCuit`             |
| DNI               | `12.345.678`                  | `formatNumericLabel`     |
| Comprobante       | `00001-00001234`              | `formatVoucherNumber`    |
| Fecha             | `20/03/2026`                  | `formatDateLabel`        |
| Entorno           | `producción`, `testing`       | `formatEnvironmentLabel` |

- **Centavos:** si hay, siempre dos (`12,50`, nunca `12,5`); si no hay, ninguno. El PDF queda aparte: su plantilla imprime siempre `$ 1.500,00`.
- **Punto de venta y número de comprobante:** sin separador de miles.

**Dato ausente:**

| Situación                                 | Qué hacer          |
| ----------------------------------------- | ------------------ |
| Nadie lo cargó y queda en cero o vacío    | No mostrar la fila |
| Viene de una flag, la config o un default | Mostrarlo          |
| Falta en la config                        | `sin configurar`   |
| ARCA no lo informa                        | `N/D`              |

## Textos

- **Voseo y tildes:** `Revisá`, `Usá`, `¿Emitimos?`. Sí/no con tilde: `sí`.
- **Letra del comprobante en mayúscula:** `factura C`. Los atajos van en minúscula: `fc`.
- **Comandos, opciones y argumentos entre backticks:** `` `arcli config revisar` ``, `` `--monto` ``, no entre comillas.
- **Monto al pedir, importe al mostrar.** "Comprobante" donde también puede ser un recibo.
- **Un error dice qué pasó y qué hacer,** sin repetir: lo que va en la sugerencia no va en el mensaje.

## Salida

- **Resultados a stdout, errores y avisos a stderr.** Con `--json`, stdout queda solo para el JSON.
- **Siempre por `writeTerminal*`:** sanitizan el texto de afuera (observaciones de ARCA, datos del usuario). No uses `process.stdout.write` para contenido.
- **Para stderr se pasa una función:** `writeTerminalError(() => formatCliError(error, false))`. El color depende de si stderr es una terminal, y eso se decide mientras se arma el panel.

## Antes de sumar una pantalla

- [ ] Usa un panel por rol, tokens de color, `uiSymbol` y los helpers de formato.
- [ ] Se ve bien en `yarn dev storybook` y está agregada ahí.
- [ ] Se probó con 40 columnas, con `NO_COLOR` y con `ARCLI_ASCII=1`.
- [ ] Oculta lo que no aporta y `--json` sigue trayendo todo.
- [ ] Si le afecta a quien usa el CLI, está en `CHANGELOG.md`.

## Lo que todavía no se cumple

Estas reglas son el objetivo. Quedan excepciones conocidas:

- `contentPanel` y `keyValuePanel` reciben borde y color por parámetro; faltan los paneles por rol y unificar factura con exportación.
- `UiTextColor` acepta cualquier string y ningún lint prohíbe `boxen` o `styleText` fuera de `src/ui`.
- `prompts.ts` usa `styleText` en lugar de tokens y `arcli ejemplos` usa `debug`.
- El header del modo interactivo escribe directo a stdout.
- Los colores `production`, `testing` y `highlight` se leen mal sobre fondo claro, y el banner de testing usa `warning`.
- Al storybook le faltan padrón, estado, listados, certificados y prompts.
