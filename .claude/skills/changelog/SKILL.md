---
name: changelog
description: Formato de CHANGELOG.md de arcli. Usala al escribir la entrada de un cambio en "Sin publicar" (en cada PR que le afecta a quien usa el CLI) y en /release, para ordenar las entradas y armar el resumen, el nombre, los destacados y el aviso de la versión.
---

# Changelog

`CHANGELOG.md` lo leen tres cosas además de una persona: el aviso de actualización del CLI (`src/modules/update-check/`), "Novedades" del sitio (`site/scripts/`) y el test de formato del CHANGELOG (`src/cli/__tests__/changelog-format.test.ts`), que falla si algo de lo que sigue no se cumple. Por eso el formato es estricto.

## Formato de una versión

````md
## [2.6.0] - 2026-11-21 · Monotributo y recibos

El monotributo en la terminal, Recibo A y B y fechas relativas. También un asistente que ya no pierde lo que respondiste.

#### El monotributo en la terminal

Las 11 categorías con topes y cuotas, con la tuya marcada. Si tu tope es otro, `monotributo.tope`.

```sh
arcli monotributo
```

> [!WARNING]
> **Puede afectar scripts**
>
> - Una moneda que no existe sale con `INPUT_VALIDATION_ERROR`, antes `ARCA_QUOTATION_ERROR`.
>
> No se saca ni se renombra ningún comando, flag ni clave de config o de `--json`.

---

### ✨ Agregado

- **Monotributo:** `arcli monotributo` con categorías, topes y cuotas, y la clave `monotributo.tope` (#210).

<details><summary>Detalle</summary>

**`arcli monotributo`.** El texto largo, completo.

</details>

### 🐛 Corregido

…
````

1. **Título:** `## [X.Y.Z] - AAAA-MM-DD`. Las X.Y.0 y X.0.0 con funciones nuevas suman ` · Nombre` (punto medio U+00B7 entre espacios): 2 a 4 palabras con lo más importante, como "Factura de exportación" o "Modo interactivo", sin nombres ingeniosos. Un patch va sin nombre. "Sin publicar" queda `## [Sin publicar]`, sin nombre.
2. **Resumen:** 1 o 2 oraciones en la primera línea después del título, que no empiece con `#`, `>`, `<` ni `-`. La primera oración se lee sola (el aviso de actualización muestra solo esa) y nombra las 2 o 3 cosas más importantes. Si no hay aviso, el resumen cierra con qué del contrato no cambia cuando eso aporta.
3. **Destacados:** 3 a 5 `####` (2 a 4 en una versión chica; ninguno en un patch de arreglos), elegidos por lo que le sirve a quien usa ARCLI. Cada uno con 1 o 2 oraciones y, si existe, un comando real en un bloque `sh`. Sin íconos. El comando y sus flags tienen que existir en esa versión: copialo de `docs/comprobantes/` o probalo con `yarn dev`.
4. **Aviso** `> [!WARNING]` con `> **Puede afectar scripts**` sola en la línea siguiente, cuando la versión cambia un código de error, rechaza algo que antes pasaba, cambia o saca un campo de `--json`, un flag, un comando o una clave de config, o cambia un default. Lista corta y una última línea con lo que no cambia. En una versión mayor, explicá cómo pasar a la nueva. Si no hay nada que afecte, no va.
5. Los destacados van antes del aviso, y después del aviso (o de los destacados) va `---`.
6. **Secciones**, solo estas y en este orden: `### ✨ Agregado`, `### 🔧 Cambiado`, `### ⏳ Deprecado`, `### 🧹 Eliminado`, `### 🐛 Corregido`, `### 🔒 Seguridad`. Los íconos sin el selector de variante U+FE0F. Una sección sin entradas no va.
7. **Entradas:** `- **Área:** texto (#N).` en una sola línea, sin sub-viñetas, hasta 25 palabras sin contar `(#N)`, y qué cambia para quien usa ARCLI. Áreas: Asistente, Facturas, Recibos, Notas, FCE, Factura E, Monotributo, Consultas, PDF, Config, Certificados, Salida, Errores, Fechas, Instalación, Docs. Lo más importante primero en cada sección: el aviso de actualización muestra las primeras 6 de la versión, en orden. `(#N)` es el número del PR; sin PR claro, sin número.
8. **Detalle:** al final de cada sección, `<details><summary>Detalle</summary>`, línea en blanco, un párrafo `**Título.** texto` por entrada que lo necesite, línea en blanco y `</details>`, cada etiqueta en su línea. Dentro no hay viñetas (`- `): el lector del CLI las contaría como entradas; una lista se escribe como oraciones del párrafo. Si la entrada de una línea ya dice todo, no hace falta detalle. Los links relativos (`docs/...`) se mantienen.
9. **Nada interno:** tests, refactors, CI, agentes, el sitio como desarrollo o dependencias que no cambian nada para quien usa ARCLI no van, salvo que se noten afuera.

## En cada PR

Si el cambio le afecta a quien usa el CLI, sumá en `## [Sin publicar]`, en la sección que corresponde:

- la entrada de una línea, con el área y el número del PR (si todavía no lo tenés, agregalo cuando abras el PR);
- el párrafo en el `<details>` de esa sección: qué hacía antes, qué hace ahora, con qué flags, claves o campos de `--json`, y qué no cambia.

Si el cambio cae en el aviso (punto 4), sumá la línea a la caja de "Sin publicar" o creala. El resumen, el nombre y los destacados se arman en la release, aunque puede haber un borrador.

**Listo cuando:** la entrada y su detalle están en "Sin publicar" y el test de formato pasa (`yarn vitest run src/cli/__tests__/changelog-format.test.ts`).

## En /release

En el paso 3 de la skill `release`, con todas las entradas de "Sin publicar" a la vista:

1. Ordená cada sección por importancia para quien usa ARCLI: lo que habilita algo nuevo o puede romper un script arriba, los arreglos de detalle abajo.
2. Escribí el resumen (punto 2) y, si es una X.Y.0 o X.0.0 con funciones nuevas, el nombre (punto 1).
3. Elegí los destacados (punto 3) y verificá cada comando con `yarn dev`.
4. Armá o revisá el aviso (punto 4) leyendo las entradas, no los títulos de commit: códigos de error, rechazos nuevos, campos de `--json`, flags, claves y defaults.
5. Mostrale al usuario el título, el resumen, los destacados y el aviso, y esperá su ok antes del Gate 1.

**Listo cuando:** la versión tiene título, resumen, destacados, aviso si corresponde y secciones ordenadas, el usuario los vio y el test de formato pasa.
