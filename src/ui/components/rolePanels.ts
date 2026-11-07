import { renderPanel } from '../primitives/renderPanel';
import type { UiTextColor } from '../primitives/text';
import type { UiBorderType, UiWidthPreset } from '../theme/theme';

// Un panel por rol (docs/design-system.md, "Paneles"): cada uno fija su borde, ancho y color, asi el mismo
// contenido se ve igual en todos los comandos.

type PanelContent = string | readonly string[];

/** El estado al pie (`APROBADO`, `TODO LISTO`) y su color, que tambien toma el titulo. */
export interface PanelStatus {
  readonly footer?: string;
  /** Color del pie cuando no es el del titulo, por ejemplo una nota atenuada. */
  readonly footerTone?: UiTextColor;
  readonly tone?: UiTextColor;
}

function statusPanelFor(
  borderType: UiBorderType,
  width: UiWidthPreset,
  title: string,
  content: PanelContent,
  { footer, footerTone, tone }: PanelStatus = {},
): string {
  return renderPanel({
    borderType,
    content,
    contentAlign: 'left',
    footer,
    footerColor: footerTone ?? tone,
    footerDivider: Boolean(footer),
    title,
    titleColor: tone,
    width,
  });
}

function messagePanelFor(borderType: UiBorderType, color: UiTextColor, title: string, content: PanelContent): string {
  return renderPanel({ borderType, content, contentAlign: 'left', title, titleColor: color, width: 'wide' });
}

/** Comprobante: vista previa y resultado. Mas angosto, como un ticket, y centrado. */
export function ticketPanel(title: string, content: PanelContent, status?: PanelStatus): string {
  return statusPanelFor('ticket', 'ticket', title, content, status);
}

/** Ficha de consulta: config, padrón, FCE, parámetros, plugin de PDF. */
export function sheetPanel(title: string, content: PanelContent, status?: PanelStatus): string {
  return statusPanelFor('sheet', 'standard', title, content, status);
}

/** Revisión con veredicto al pie, como `config revisar`. */
export function checklistPanel(title: string, content: PanelContent, status: PanelStatus): string {
  return statusPanelFor('checklist', 'wide', title, content, status);
}

/** Listado en tabla, como los últimos comprobantes. Sin color. */
export function listingPanel(title: string, content: PanelContent): string {
  return statusPanelFor('listing', 'wide', title, content);
}

/** Observaciones y avisos. */
export function attentionPanel(title: string, content: PanelContent): string {
  return messagePanelFor('attention', 'warning', title, content);
}

/** Sugerencias. */
export function tipPanel(title: string, content: PanelContent): string {
  return messagePanelFor('tip', 'warning', title, content);
}

/** Errores como lista, por ejemplo los que devuelve ARCA. Para un error del CLI, `errorPanel`. */
export function errorListPanel(title: string, content: PanelContent): string {
  return messagePanelFor('error', 'danger', title, content);
}

/** JSON y respuesta bruta. */
export function dataPanel(title: string, content: PanelContent): string {
  return messagePanelFor('data', 'subtle', title, content);
}
