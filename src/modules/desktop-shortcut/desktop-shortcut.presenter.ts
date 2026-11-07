import { noticePanel } from '../../ui/components';

import type { DesktopShortcutResult } from './installer';

export function formatDesktopShortcutAsText({ path, replaced }: DesktopShortcutResult): string {
  return noticePanel(`Acceso directo ${replaced ? 'actualizado' : 'creado'}: ${path}`, 'success');
}

export function formatDesktopShortcutAsJson({ path, replaced }: DesktopShortcutResult): string {
  return JSON.stringify({ reemplazado: replaced, ruta: path }, null, 2);
}
