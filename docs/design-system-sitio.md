[← Volver a la documentación](README.md)

# Design system del sitio

Reglas para [arcli.com.ar](https://arcli.com.ar): qué token, componente, marca o archivo de CSS usar. Son para quien cambia una página, la portada o el estilo del sitio. Lo de la terminal está en el [design system de la terminal](design-system.md); las dos comparten los colores de la marca y el logo.

El sitio vive en `site/` (Astro + Starlight). Cómo se genera desde `docs/` y cómo correrlo, en [Sitio de documentación](development.md#sitio-de-documentación).

## Reglas

1. **Nada de colores literales.** Ni `#hex`, ni `rgb()`, ni nombres: un `var(--arcli-…)` o `var(--sl-color-…)`. Si falta uno, se agrega a `tokens.css` con un comentario de para qué es. La única excepción es `codeBackground` de expressive-code en `astro.config.mjs`, que con `var()` no puede calcular el contraste (ver [Código](#código)).
2. **Nada de `!important`.** Starlight pone sus estilos en `@layer starlight.*`, así que una regla sin capa ya gana. Quedan dos, cada uno con su comentario: la opacidad de "Copiar" en `codigo.css` (expressive-code no usa capas) y `transition: none` con movimiento reducido en `landing.css`.
3. **Los textos de la portada van en `site/src/data/landing.ts`**, no en los componentes. Los de las docs van en `docs/`, nunca en lo generado (`site/src/content/docs/`, `site/src/generated/`).
4. **Lo que en el sitio se ve distinto se marca en `docs/`** con un comentario `<!-- arcli: … -->` (ver [Marcas](#marcas-de-markdown)), no con HTML en el Markdown: así la página se sigue leyendo bien en GitHub.
5. **Un componente antes que HTML repetido.** Si un ícono, chip o logo ya tiene componente, se usa ese.
6. **Se lee sin color.** Como en la terminal: el color refuerza (la letra del comprobante, la severidad), pero el texto dice lo mismo.
7. **Claro y oscuro.** Las docs tienen los dos temas; la portada y los paneles de terminal son siempre oscuros. Cada cambio se mira en los dos temas, a 1440 y a 390 px.
8. **Con teclado.** Lo que se toca con el mouse se toca con el teclado, con el foco visible (`:focus-visible`, celeste, en `marco.css` para todo el sitio) y sin foco al hacer clic. Lo que se desplaza de costado (una tabla en el celular, un bloque de la portada) también entra con Tab.

## Tokens

Están en [`site/src/styles/tokens.css`](../site/src/styles/tokens.css), que va primero en `customCss`: los ven las docs, los componentes y la portada.

### Color

La marca cambia con el tema: en claro, cada color es una versión más oscura que mantiene el contraste sobre blanco.

| Token             | Oscuro    | Claro     | Para qué                                                                                     |
| ----------------- | --------- | --------- | -------------------------------------------------------------------------------------------- |
| `--arcli-celeste` | `#74acdf` | `#2c6aa3` | El acento: links, foco, pestaña elegida, aviso `note`, "Cambiado", la letra A, "AR" del logo |
| `--arcli-lavanda` | `#c6c9f0` | `#3d3f66` | Lo opcional (tarjetas `opt`), la letra B, "CLI" del logo                                     |
| `--arcli-verde`   | `#a6e3a1` | `#327a37` | Salió bien: aviso `tip`, "Agregado", la letra C                                              |
| `--arcli-sol`     | `#f9d77e` | `#8a5f00` | Atención: aviso `caution`, "Corregido", severidad "frecuente", la letra E                    |
| `--arcli-naranja` | `#fab387` | `#a8521a` | "Deprecado" y "Aviso" en Novedades                                                           |
| `--arcli-rojo`    | `#f38ba8` | `#b4344f` | Error o peligro: aviso `danger`, "Eliminado", "Seguridad", severidad "crítico"               |
| `--arcli-panel`   | `#11111b` | `#f4f5f9` | Un panel de las docs que sigue el tema (hoy sin uso)                                         |
| `--arcli-hdr-hi`  | `#2c2c42` | `#ffffff` | El degradé del encabezado (arriba); `--arcli-hdr-lo`, abajo                                  |
| `--sl-color-*`    |           |           | Los de Starlight: el acento y los grises (`gray-1` a `gray-6`) del tema                      |

Los grises del texto y las líneas son los de Starlight (`--sl-color-white`, `--sl-color-gray-2`, `--sl-color-gray-5`…): siguen el tema solos. En oscuro, `--sl-color-gray-3` (el texto secundario) es más claro que el de Starlight para llegar a 4,5:1 también sobre una pestaña o un desplegable abierto.

**Contraste.** Todo texto llega a 4,5:1 contra su fondo, en claro y en oscuro, también dentro de un desplegable abierto o un chip. Un color nuevo se prueba en los dos temas (por ejemplo, con axe o Lighthouse).

**Terminal** (`--arcli-term-*`, Catppuccin Mocha): iguales en los dos temas, porque un panel de terminal es siempre oscuro. Para todo lo que imita la terminal: la demo, el chat, las muestras, los bloques de código. Si el panel es de terminal, va `--arcli-term-red`, no `--arcli-rojo`, que en claro perdería contraste sobre el fondo oscuro.

| Token                                                | Para qué                                    |
| ---------------------------------------------------- | ------------------------------------------- |
| `--arcli-term-bg`, `-raised`                         | Fondo del panel y de lo que va encima       |
| `--arcli-term-line`, `-line-dim`                     | Bordes y separadores                        |
| `--arcli-term-fg`, `-fg-soft`, `-fg-mute`, `-strong` | Texto: normal, secundario, apagado y blanco |
| `--arcli-term-blue`, `-green`, `-teal`, `-red`       | Los colores de la salida de `arcli`         |
| `--arcli-term-user`                                  | La burbuja de quien escribe en el chat      |

**Portada** (`--arcli-portada-*`, `--arcli-celeste-strong`, `--arcli-celeste-glow`, `--arcli-on-accent`): la portada es siempre oscura, así que no cambian con el tema. `landing.css` los usa con alias cortos (`--fg`, `--line`, `--celeste`…) definidos en `.arcli-landing`; dentro de la portada se usan esos alias.

**Fijos**: `--arcli-estrella` (la estrella de GitHub) y `--arcli-papel` (el fondo del PDF de ejemplo).

### Tipografía

- `--sl-font`: Geist, para todo el texto. `--sl-font-mono`: JetBrains Mono, para código, comandos, atajos, chips y etiquetas. Se cargan en `astro.config.mjs` con `display=optional`.
- Títulos de las docs: `--sl-text-h1` a `--sl-text-h4`; el texto, `--sl-line-height` (1.65).
- Mono chico: `--arcli-text-mono-sm` (fechas, texto mono al lado de texto normal), `--arcli-text-overline` (etiquetas en mayúscula) y `--arcli-text-2xs` (chips del menú).
- Portada: la escala `--step--1` a `--step-4` de `landing.css` (de notas al `h1`).

### Radios

| Token                 | Valor   | Para qué                                                  |
| --------------------- | ------- | --------------------------------------------------------- |
| `--arcli-radius-sm`   | 0.4rem  | Piezas chicas dentro de otra: campos, etiquetas, botones  |
| `--arcli-radius-md`   | 0.5rem  | Carteles y burbujas chicas                                |
| `--arcli-radius-lg`   | 0.6rem  | Cajas de las docs: tablas, avisos, pestañas, desplegables |
| `--arcli-radius-xl`   | 0.75rem | Paneles y tarjetas de la portada (su `--radius`)          |
| `--arcli-radius-pill` | 99px    | Chips y píldoras                                          |

Hoy solo la portada usa `--radius`; las docs todavía escriben esos mismos valores a mano (y algunos intermedios, como 0.3 o 0.55rem). Un radio nuevo usa el token, y uno existente se pasa al token cuando se toca esa regla. Lo mismo con los tamaños de mono chico de la sección anterior.

### Espacios y anchos

- Docs: `--sl-sidebar-width` (19rem, entra "Responsable inscripto" en una línea), `--sl-content-width` (56rem), `--arcli-toc-width` (15rem) y `--arcli-gutter` (todo el sitio hasta 96rem). Los espacios internos de las docs siguen los de Starlight.
- Portada: la escala de `.arcli-landing` en `landing.css`, cada una con su comentario: `--space-section` entre secciones, `--space-eyebrow`, `--space-lead` y `--space-content` dentro del encabezado de una sección, `--gap-sm` a `--gap-col` entre tarjetas y columnas, y `--pad-card`, `--pad-row` y `--pad-item` adentro. Se usan esos en vez de valores sueltos.

### Sombras

- `--arcli-shadow-glow`: el brillo celeste debajo de los paneles de terminal y los GIF de las docs.
- `--arcli-shadow-pdf`: el PDF de ejemplo solo (en las docs y en la portada).
- `--arcli-shadow-pdf-portada` y `--arcli-shadow-panel`: el PDF y el panel de la terminal de la portada, que se superponen.

## Componentes

En `site/src/components/`. Los de la portada, en `landing/`.

| Componente            | Props                                                                                    | Cuándo                                                                                                                                                                            |
| --------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Chip`                | `color` (un `var(--…)`; sin él, gris), `as` (`span`, `a`, `p`), `class`                  | Una etiqueta de color: la familia del comprobante, la letra del menú, la versión. El tamaño lo pone cada lugar con `class`. En HTML generado, la clase `.arcli-chip` con `--chip` |
| `Icon`                | `name` (de `icons.ts`), `size` (`1rem`), `filled`, atributos del `<svg>`                 | Un ícono decorativo, del color del texto: lo nombra el texto de al lado. Un ícono nuevo se agrega a `icons.ts` (trazo de 24×24)                                                   |
| `AsciiLogo`           | `variant`: `header`, `footer` o `hero`                                                   | El logo como texto, igual que en la terminal (sale de `generated/brand.json`). No se dibuja a mano                                                                                |
| `landing/LandingIcon` | Las de `Icon`                                                                            | Un ícono en la portada (puntas rectas, como la maqueta)                                                                                                                           |
| `landing/Section`     | `eyebrow`, `title`, `lead`, `id`; el contenido en el slot                                | Cada sección de la portada, con su encabezado y espacios                                                                                                                          |
| `landing/Button`      | `link` (`{ href, text }`), `variant`: `primary` (con flecha) o `ghost`                   | Las acciones de la portada. `href` es una ruta del sitio sin `/` adelante                                                                                                         |
| `landing/Tabs`        | `items` (`{ key, label, badge? }`), `label`, `class`, `tabClass`, `idPrefix`, `controls` | Pestañas de la portada. Avisan con el evento `tabchange` y cada sección muestra lo suyo                                                                                           |
| `landing/Snippet`     | `lines` (`{ cmd, comment }`)                                                             | Un bloque de comandos con el `$` y las flags de color                                                                                                                             |
| `landing/TermPanel`   | `title`, `titleClass`, `rows` (`[etiqueta, valor]`), `label`, `class`; el pie en el slot | Un panel de terminal con filas, como la vista previa y el resultado                                                                                                               |
| `landing/Step`        | `n`, `title`, `text`, `link`, `reverse`; el visual en el slot                            | Un paso de "Cómo es facturar"                                                                                                                                                     |
| `landing/Rich`        | `text`                                                                                   | Un texto de `landing.ts` con formato: `ARCLI` como marca, `**negrita**`, `[link](ruta/)` y `{ia}` (el nombre que rota, `Roll`). Lo parsea `lib/rich.ts`                           |

**Pestañas.** Las de la portada (`landing/Tabs`) y las de las docs (la marca `pestañas`) usan [`site/src/lib/tabs.ts`](../site/src/lib/tabs.ts): botones `role="tab"`, solo la elegida entra con Tab, y las flechas, Inicio y Fin cambian de pestaña. Las de las docs suman en `lib/docs/tabs.ts` que la elección se recuerda por grupo en todas las páginas. Unas pestañas nuevas usan `connectTabs`, no otro script.

**Chat.** La conversación de "Con IA" en las docs (marca `chat`) y la demo de la portada (`landing/Demo`) comparten forma y colores en `styles/docs/chat.css`; la portada solo las agranda y las anima. Un chat nuevo usa esas clases (`.arcli-chat` y `.arcli-msg user|bot`).

**Utilidades** en `site/src/lib/`: `site.ts` (`url()` para las rutas con la base, `escapeHtml`, `isHome` y los links del repo, npm, issues y cafecito), `familia.ts` (la letra y el color de cada familia de comprobantes) y `rich.ts`. Un link o un color de familia no se escribe a mano.

## Marcas de Markdown

Son la forma de usar los componentes de las docs desde `docs/`: un comentario que GitHub no muestra y `site/scripts/transforms/` convierte. Cada una tiene su archivo y su test en `transforms/__tests__/`. La tabla corta está en [development.md](development.md#sitio-de-documentación); un test controla que cada marca de los transforms esté acá y allá.

### `pasos`

Los `### 1. …` hasta el próximo `##`, como pasos numerados unidos por una línea (`pasos.css`).

```markdown
<!-- arcli: pasos -->

### 1. Generá la clave

…

### 2. Pedí el certificado
```

### `pestañas`

Los `### …` hasta el próximo `##`, como pestañas (`pestanas.css`, `lib/docs/tabs.ts`). La palabra después del `=` es el grupo: la elección se recuerda en todas las páginas con ese grupo, y en `so` la primera vez se elige el sistema de quien mira.

```markdown
<!-- arcli: pestañas=so -->

### Windows

1. Abrí PowerShell.

### macOS
```

### `opciones`

Cada `### opción` con su tabla Largo | Corto | Qué es, como tarjeta (`opciones.css`): `req` con barra celeste (obligatorio), `opt` lavanda (opcional) y `run` gris (de la corrida). Lo genera `yarn docs:comprobantes`; no se escribe a mano.

```markdown
<!-- arcli: opciones=req -->
```

### `familia`

En las páginas de `docs/comprobantes/`: la familia arriba del título (un `Chip` con el color de la letra), el ícono y el lugar en el menú. También la genera `yarn docs:comprobantes`.

```markdown
<!-- arcli: familia="Monotributo · C" icono="factura" orden="1" -->
```

### `atajos`

La tabla siguiente como la grilla de atajos por letra, con las letras centradas y cada atajo como link (`atajos.css`).

```markdown
<!-- arcli: atajos -->

| Comprobante | A                    | B                    | C                    |
| ----------- | -------------------- | -------------------- | -------------------- |
| Factura     | [`fa`](factura-a.md) | [`fb`](factura-b.md) | [`fc`](factura-c.md) |
```

### `chat`

La cita siguiente, con **Vos:** y **Tu asistente:**, como una conversación (`chat.css`). Lo que no empieza con uno de los dos no se muestra.

```markdown
<!-- arcli: chat -->

> **Vos:** Facturale $ 15.000 a Juan.
>
> **Tu asistente:** Listo, la Factura C 0001-00000042 tiene CAE.
```

### `muestra`

El bloque de texto siguiente como un cartel chico de terminal (`muestra.css`): la primera línea es el título y las demás, filas etiqueta / valor. Con `error`, el título y el borde van en `--arcli-term-red`.

````markdown
<!-- arcli: muestra=vista -->

```text
Factura C · vista previa
Importe total    $ 15.000
```
````

### `formas`

Una tabla "Si querés | Escribís | Forma" como filas que llevan a cada forma de uso, como en la portada (`formas.css`).

```markdown
<!-- arcli: formas -->

| Si querés               | Escribís | Forma                                   |
| ----------------------- | -------- | --------------------------------------- |
| Que me guíe paso a paso | `arcli`  | [Asistente](formas-de-uso/asistente.md) |
```

### `prompt-instalacion`

Reemplaza la línea siguiente por el prompt de "Que lo instale tu IA" del README, en un bloque para copiar. En GitHub queda la línea, con el link al README.

```markdown
<!-- arcli: prompt-instalacion -->

El texto para copiar está en el [README](../README.md#empezar).
```

Además, sin marca: los avisos de GitHub (`> [!TIP]`, `> [!CAUTION]`…) pasan a los avisos de colores, Problemas frecuentes a desplegables con buscador y Novedades pliega las versiones viejas.

Novedades, también sin marca, sigue el formato de `CHANGELOG.md` (ver la skill `changelog`). El nombre de una versión (lo que va después de `·` en el título) se muestra al lado del número, en `.arcli-ver-name`. Los destacados (`####`) pasan a tarjetas `.arcli-highlight` dentro de una grilla `.arcli-highlights`, que termina en el primer `:::` o `---`. La caja `> [!WARNING]` con `> **Título**` en su primera línea pasa a `:::caution[Título]`. Cada sección es un chip con el ícono del tipo de cambio en `data-icon`, y su ancla queda sin el ícono (`#agregado`, `#corregido`).

Para una marca nueva: un archivo en `transforms/` con su test, su lugar en el orden de `transforms/index.mjs`, su CSS en `styles/docs/` y una fila acá y en la tabla de `development.md`.

## Dónde va cada archivo de CSS

| Archivo                       | Qué tiene                                                                                                               |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `site/src/styles/tokens.css`  | Solo variables. Primero en `customCss`                                                                                  |
| `site/src/styles/docs/*.css`  | Las docs, un archivo por parte, en el orden de `customCss` en `astro.config.mjs`. Una parte nueva, un archivo nuevo ahí |
| `site/src/styles/landing.css` | La portada, todo dentro de `.arcli-landing` para no tocar las docs. Lo importa `Landing.astro`                          |
| `<style>` de un componente    | Solo lo de ese componente (`Header`, `PageSidebar`…)                                                                    |
| `astro.config.mjs`            | Los colores y bordes de los bloques de código (`expressiveCode.styleOverrides`)                                         |

Los de `docs/`, por parte: `marco` (encabezado, anchos, índice, la portada de borde a borde), `contenido` (links, código en línea, tablas, avisos, imágenes), `codigo` (bloques de código), `opciones`, `desplegables`, `chat`, `pasos`, `muestra`, `formas`, `chip`, `problemas`, `novedades`, `pestanas` y `atajos`. Un estilo que comparten las docs y la portada (como el chat o el chip) va en `docs/` y lo toman las dos.

### Código

Los bloques de código son de expressive-code y se configuran en `astro.config.mjs`. Usan solo el tema oscuro (`themes: ['starlight-dark']`): son paneles de terminal, oscuros también en el tema claro. `codeBackground` queda en `#11111b` (el valor de `--arcli-term-bg`): con `var()`, expressive-code no puede calcular el contraste y en el tema claro aclaraba el texto. Si cambia `--arcli-term-bg`, cambia ahí también.
