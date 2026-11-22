---
name: revisar-cambio
description: Revisión independiente de un cambio propio de arcli (de la sesión o de un agente) antes de mergearlo - lanza el agente revisor con el diff y el plan, verifica cada hallazgo y los devuelve a quien implementó. Usala en tareas de nivel 2 o 3 de docs/estandares.md, antes de mergear.
---

# Revisar un cambio propio

Para PRs de terceros está `revisar-pr`. Esta es para lo nuestro: la idea es que una segunda lectura, sin el razonamiento de quien implementó, encuentre lo que esa persona o agente dio por hecho.

## 1. Preparar

- La rama del cambio, su worktree (o el checkout) y el plan de `planificar-tarea` con los criterios de aceptación.
- El diff contra la base: `git -C <worktree> diff origin/dev...HEAD > <scratchpad>/cambio-<rama>.diff`.

**Listo cuando:** tenés las rutas del checkout, del diff y del plan.

## 2. Lanzar al revisor

Lanzá el agente `revisor` en **modo propio** con:

- la ruta del checkout con el cambio, la ruta del diff y la raíz del checkout principal;
- el plan, tal cual (criterios, paridad, fuera de alcance).

**No le pases** el informe de quien implementó ni tu opinión: si se lo pasás, va a confirmar lo que ya creés. Si el cambio es grande, un revisor por área (por ejemplo, `modules` y `cli`).

## 3. Verificar los hallazgos

El revisor puede equivocarse con la misma seguridad con la que acierta. Por cada hallazgo:

- Leé el código en `archivo:línea`.
- Si dice cómo comprobarlo, comprobalo (un test, `yarn dev` con `ARCLI_CONFIG_DIR=$(mktemp -d)`).
- Clasificalo: **confirmado**, **descartado** (con el motivo) o **decisión de la persona** (contrato o producto).

**Listo cuando:** cada hallazgo tiene una clasificación con evidencia.

## 4. Cerrar

- Los confirmados vuelven al **mismo** especialista con `SendMessage`, así conserva su contexto. Después, otra pasada del revisor solo si el arreglo fue grande.
- Las decisiones van a la persona con el tradeoff y una recomendación.
- Si un hallazgo es una clase de error que puede repetirse (se olvidó la misma familia, la misma superficie), proponé dónde fijarla: un criterio en `.claude/skills/revisar-pr/criterios.md`, un test genérico o una regla de lint.

**Listo cuando:** no quedan hallazgos confirmados abiertos, y la persona sabe qué se encontró, qué se arregló y qué se descartó.
