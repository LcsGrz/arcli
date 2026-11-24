# Estándares de ingeniería

Cómo se decide en ARCLI, para personas y agentes. Son criterios para aplicar con juicio, no reglas para cumplir al pie de la letra: cuando dos chocan, la tabla dice cuál pesa más. Las reglas concretas del repo están en [AGENTS.md](../AGENTS.md) y lo que se mira al revisar, en [criterios.md](../.claude/skills/revisar-pr/criterios.md).

## Antes de escribir código, buscá

> Antes de implementar, buscá si ya existe algo reutilizable. Si existe, extendelo o reutilizalo. Si no, evaluá si corresponde una abstracción compartida antes de escribir la solución.

Buscar es concreto:

- **Por nombre y por concepto**, no solo por el nombre que pensás usar: `currency`, `receiver`, `optional`, `exchange`. Con grep o con el grafo de código.
- **En los catálogos**: `VOUCHER_KIND_MAP`, las tablas de ARCA, los códigos de error, las constantes de `arca-codes.ts`.
- **En las otras familias**: lo que estás por hacer para A, B o C casi siempre existe, o falta, en FCE, E, recibos, notas y "Repetir". Lo mismo entre superficies: comando, asistente, `--cargar`, `--json`, vista previa, comando equivalente, PDF y ayuda.

Si trabajás con un agente, su informe dice qué buscó y qué encontró.

## Principios

| Principio                         | En ARCLI significa                                                                                                                                      | Cuando choca                                                                                                                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Una sola fuente**               | Una regla de ARCA, un catálogo, una validación o un texto viven en un lugar. Las familias comparten lo común y difieren solo donde ARCA difiere.        | Con "no anticipar": se abstrae a la segunda copia real del **mismo conocimiento** (la misma regla de ARCA). Si dos códigos se parecen pero cambian por razones distintas, quedan separados. |
| **Capas con una responsabilidad** | `cli` pregunta y muestra, `modules` decide, `services` habla con ARCA, `lib` es puro. Detalle en [architecture.md](architecture.md).                    | Con "simple": no se crea una interfaz o un puerto sin un segundo uso o un test que lo necesite.                                                                                             |
| **Simple**                        | La solución más directa que cumple los criterios de aceptación.                                                                                         | Simple no es duplicar: copiar una regla es simple hoy y caro mañana.                                                                                                                        |
| **No anticipar**                  | Nada de opciones, flags ni configuración "por si acaso".                                                                                                | Lo que es contrato (comandos, flags, claves, `--json`) se diseña pensando en la próxima versión mayor, porque cambiarlo después cuesta una deprecación.                                     |
| **Consistencia**                  | Seguir el patrón del código de al lado y el [design system](design-system.md).                                                                          | Un patrón nuevo se justifica; si es estructural, queda como decisión en `architecture.md`.                                                                                                  |
| **Paridad entre superficies**     | Lo que hace el CLI lo hace igual el asistente, `--cargar`, `--json`, la vista previa, el comando equivalente, el PDF y la ayuda, en todas las familias. | No choca: si una superficie no aplica, se dice por qué, y en comandos y asistente lo exige `surface-parity.test.ts`.                                                                        |
| **ARCA manda**                    | Cada regla copiada de ARCA lleva su código de error y la sección del manual. Lo que testing acepta y producción no, se marca `TESTING LAXO`.            | Si el manual y lo que responde testing difieren, decide quien mantiene el proyecto.                                                                                                         |
| **Tests que prueban**             | Un test falla sin el cambio y afirma lo que ve quien usa el CLI o lo que recibe ARCA. Compilar no es funcionar.                                         | Más tests no es mejor: cada uno cubre un comportamiento o un borde distinto.                                                                                                                |
| **Defensivo en los bordes**       | Validar toda entrada del usuario y toda respuesta de ARCA; errores con código estable; si no se sabe si se emitió, `EMISSION_UNCERTAIN`.                | Adentro se confía en los tipos: no se revalida en cada función.                                                                                                                             |
| **Mantenible**                    | Nombres del dominio ([glosario](glossary.md)), funciones chicas y puras donde se pueda, comentarios que dicen el porqué.                                | —                                                                                                                                                                                           |

## Cuánto control lleva cada cambio

Proporcional al riesgo. Un typo no pasa por el mismo camino que un cambio en la emisión.

| Nivel               | Ejemplos                                                                | Qué lleva además de typecheck, lint y tests                                                                              |
| ------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **0 · Trivial**     | Un texto, un typo, un doc                                               | Nada más.                                                                                                                |
| **1 · Normal**      | Un bug acotado o una mejora en una capa, sin contrato ni reglas de ARCA | Criterios de aceptación escritos antes de empezar.                                                                       |
| **2 · Importante**  | Cruza capas o toca el asistente, reglas de ARCA, la emisión o `--json`  | Tests de aceptación antes del código, revisión independiente y recorrido de paridad por familia y superficie.            |
| **3 · Estructural** | Un refactor como el navegador, seguridad, certificados o producción     | Diseño aprobado antes de empezar, entrega por tandas con lo del nivel 2 en cada una, y mutation testing sobre lo tocado. |

Ante la duda, el nivel más alto.

## Terminado

Un cambio de código está terminado cuando:

- Cada criterio de aceptación está cumplido y se dice cómo se verificó.
- Typecheck, lint y la suite completa pasan, y los tests nuevos fallan sin el cambio.
- La paridad está recorrida, o dice "no aplica" con el motivo.
- Docs y CHANGELOG están al día según la tabla de [CONTRIBUTING.md](../CONTRIBUTING.md#documentación), si hay un cambio visible.
- Si apareció una clase de error nueva, quedó como criterio de revisión, test genérico o regla de lint, para que no vuelva.
