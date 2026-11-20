---
name: planificar-tarea
description: Arma el plan de una tarea de código de arcli antes de implementarla - nivel de riesgo, qué reutilizar, paridad entre familias y superficies, si toca contrato, criterios de aceptación y pruebas. Usala al empezar cualquier tarea que no sea trivial (nivel 1 o más de docs/estandares.md), antes de lanzar a nucleo, interfaz o tester.
---

# Planificar una tarea

El plan es el brief del especialista y lo que el revisor usa para verificar. Tiene que alcanzar para que alguien sin esta conversación haga la tarea bien. Proporcional: en nivel 1 son diez líneas; en nivel 2 o 3, lo que haga falta.

## 1. Entender

Leé el ticket en `docs/backlog/` (y en `descartado.md` si suena a algo ya analizado), las decisiones de quien mantiene el proyecto en esta conversación y en la memoria, y el historial de los archivos que se van a tocar (`git log -5 -- <archivo>`).

**Listo cuando:** podés decir en una frase qué cambia para quien usa el CLI, o "nada, es interno".

## 2. Nivel de riesgo

Con la tabla de [docs/estandares.md](../../../docs/estandares.md#cuánto-control-lleva-cada-cambio). Ante la duda, el más alto. El nivel decide el recorrido:

- **1:** un especialista, con los criterios de este plan.
- **2:** `tester` escribe primero los tests de aceptación, después el especialista, después `revisar-cambio`.
- **3:** el diseño lo aprueba la persona antes; después tandas como el nivel 2, y al final `node scripts/agent/stryker.mjs --desde origin/dev`.

## 3. Buscar qué reutilizar

Hacelo vos, no se lo dejes al especialista: con grep o el grafo de código, por nombre y por concepto; en los catálogos (`VOUCHER_KIND_MAP`, `arca-codes.ts`, tablas de ARCA); y en las otras familias y superficies. Anotá lo encontrado con `archivo:línea`, incluido lo duplicado que convendría unificar.

**Listo cuando:** el plan dice qué se reutiliza, qué se extiende y qué es nuevo, con el motivo.

## 4. Paridad

Recorré la matriz y marcá cada celda como "cambia", "no cambia" o "no aplica (motivo)":

- **Familias:** A/B/C, FCE, E (WSFEX), recibos, notas de crédito y débito, "Repetir".
- **Superficies:** comando y flags, asistente, `--cargar`, `--json`, vista previa, comando equivalente, PDF, ayuda y docs.

## 5. Contrato

Si el cambio saca o renombra un comando, flag, clave de config o campo de `--json`, o cambia lo que hace uno existente (también un default): **frená** y planteale a la persona el tradeoff y la transición, como dice `AGENTS.md`. El plan sigue con lo que decida.

## 6. Criterios de aceptación y pruebas

Criterios observables: lo que ve quien usa el CLI, lo que recibe ARCA o lo que devuelve `--json`, con entradas concretas. Cada criterio dice con qué test o comando se verifica. Incluí los bordes y las otras familias de la paridad.

## Plan (lo que se le pasa al especialista)

```markdown
## Plan: <ticket> <título>

**Nivel:** <0-3> — <por qué>
**Qué cambia para quien usa el CLI:** <una frase, o "nada">
**Rama:** <tipo>/<ticket>-<tema>, desde origin/dev

### Reutilizar

- <archivo:línea> — <qué es y cómo se usa>

### Paridad

| Familia o superficie | Cambia | Nota |

### Criterios de aceptación

1. <criterio> — se verifica con <test o comando>

### Fuera de alcance

- <lo que no se hace y por qué>

### Decisiones tomadas

- <decisión> — <quién y cuándo>
```

El especialista recibe este bloque, el ticket y nada de tu razonamiento previo que no esté acá.
