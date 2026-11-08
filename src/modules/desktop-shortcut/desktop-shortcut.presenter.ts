import { noticePanel } from '../../ui/components';

import type { DesktopShortcutResult } from './installer';

const FROM_SOURCE_NOTE =
  'Se creó desde el código fuente: abre el `arcli` instalado, no el de este repo. Si no lo tenés, instalalo con `npm install -g arcli`.';

export function formatDesktopShortcutAsText({ path, replaced, usesInstalledArcli }: DesktopShortcutResult): string {
  const created = `Acceso directo ${replaced ? 'actualizado' : 'creado'}: ${path}`;

  return noticePanel(usesInstalledArcli ? `${created}\n${FROM_SOURCE_NOTE}` : created, 'success');
}

export function formatDesktopShortcutAsJson({ path, replaced, usesInstalledArcli }: DesktopShortcutResult): string {
  return JSON.stringify({ reemplazado: replaced, ruta: path, usaArcliInstalado: usesInstalledArcli }, null, 2);
}
