import { BACK } from '../../modules/interactive/wizard';
import { extractChangelog, fetchChangelog } from '../../modules/update-check/changelog';
import { resolveUpdateCommand } from '../../modules/update-check/package-manager';
import { renderUpdateDetails } from '../../modules/update-check/update-check.presenter';
import type { UpdateCheckResult } from '../../modules/update-check/update-check.service';
import { copyToClipboard } from '../../services/clipboard/clipboard';
import { noticePanel, writeTerminalOutput } from '../../ui';
import { startSpinner } from '../spinner';

import { chooseStep } from './prompts';

/**
 * Muestra la version nueva y sus novedades. Con "Cerrar para actualizar" copia el comando al portapapeles y
 * devuelve `true` para que el modo interactivo termine: arcli no se puede reemplazar a si mismo mientras corre.
 */
export async function runUpdateFlow(update: UpdateCheckResult): Promise<boolean> {
  const spinner = startSpinner('Buscando las novedades...');
  const markdown = await fetchChangelog(update.latestVersion);

  spinner?.stop();
  writeTerminalOutput(
    renderUpdateDetails(
      update,
      markdown === undefined ? undefined : extractChangelog(markdown, update.currentVersion, update.latestVersion),
    ),
  );

  // "← Volver" (o Esc) lo agrega chooseStep, igual que en el resto de los menus.
  if ((await chooseStep('¿Actualizamos?', [{ name: 'Cerrar para actualizar', value: 'cerrar' }])) === BACK) {
    return false;
  }

  const command = resolveUpdateCommand();

  // Abierto con el acceso directo, la ventana se cierra al terminar: hay que decir donde pegarlo y esperar a que se lea.
  const where = 'Abrí una terminal nueva (Terminal en Mac, PowerShell en Windows)';

  writeTerminalOutput(
    copyToClipboard(command)
      ? noticePanel(
          `Comando copiado. ${where}, pegalo y apretá Enter:\n${command}\nCuando termine, volvé a abrir ARCLI.`,
          'success',
        )
      : noticePanel(
          `No se pudo copiar el comando. ${where} y escribí:\n${command}\nCuando termine, volvé a abrir ARCLI.`,
          'warning',
        ),
  );

  // "← Volver" sigue en ARCLI sin actualizar.
  return (await chooseStep('¿Cerramos ARCLI?', [{ name: 'Cerrar ARCLI', value: 'cerrar' }])) !== BACK;
}
