import { uiSymbol } from '../primitives/symbols';

/**
 * Una fila de una lista del asistente: "❯ Opción" la marcada, resaltada con `highlight`, y "  Opción" las demas. La
 * usan todas las listas (las de opciones, la que se filtra, la de seleccion multiple y la de acciones por fila).
 */
export function pointerRow(label: string, isActive: boolean, highlight?: (text: string) => string): string {
  const line = `${isActive ? uiSymbol('pointer') : ' '} ${label}`;

  return isActive && highlight ? highlight(line) : line;
}
