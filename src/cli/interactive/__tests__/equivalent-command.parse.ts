import type { Command } from 'commander';
import { expect } from 'vitest';

import type { VoucherShortcut } from '../../../modules/billing/billing.types';
import type { ExportVoucherKind } from '../../../modules/export/export.types';
import { createProgram } from '../../program';

/**
 * Pegar el comando equivalente en la terminal, sin emitir: lo separa como la shell y lo pasa por el programa real de
 * commander. El archivo de tests reemplaza `executeBillingCommand` y `executeExportCommand` con `vi.mock` para que
 * guarden aca el comando parseado en lugar de llamar a ARCA (ver `equivalent-command.roundtrip.test.ts`).
 */
export const captured: Array<{ command: Command; exportKind?: ExportVoucherKind; shortcut?: VoucherShortcut }> = [];

/** En PowerShell las comillas tipograficas tambien abren y cierran una cadena simple. */
const POWERSHELL_QUOTE = /['‘’‚‛]/;

/**
 * Separa un comando como la shell: comillas simples de POSIX (`'\''`) o de PowerShell (adentro, dos comillas
 * seguidas son una).
 */
function splitCommand(line: string, platform: 'linux' | 'win32'): string[] {
  const words: string[] = [];
  let current: string | null = null;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index] as string;

    if (platform === 'win32' && POWERSHELL_QUOTE.test(char)) {
      let quoted = '';

      for (index += 1; ; index += 1) {
        const inner = line[index];

        if (inner === undefined) throw new Error(`comillas sin cerrar en ${line}`);

        if (POWERSHELL_QUOTE.test(inner)) {
          if (!POWERSHELL_QUOTE.test(line[index + 1] ?? '')) break;

          quoted += inner;
          index += 1;
        } else {
          quoted += inner;
        }
      }

      current = (current ?? '') + quoted;
    } else if (char === "'") {
      const close = line.indexOf("'", index + 1);

      if (close === -1) throw new Error(`comillas sin cerrar en ${line}`);

      current = (current ?? '') + line.slice(index + 1, close);
      index = close;
    } else if (platform === 'linux' && char === '\\') {
      current = (current ?? '') + (line[index + 1] ?? '');
      index += 1;
    } else if (char === ' ') {
      if (current !== null) words.push(current);
      current = null;
    } else {
      current = (current ?? '') + char;
    }
  }

  if (current !== null) words.push(current);

  return words;
}

/** El comando de facturacion que llega a commander con `line`, escrita en la shell de `platform`. */
export async function parseWithProgram(line: string, platform: 'linux' | 'win32') {
  const [arcli, ...args] = splitCommand(line, platform);
  const program = createProgram();
  const silence = (command: Command) => {
    command.exitOverride().configureOutput({ writeErr: () => {}, writeOut: () => {} });
    command.commands.forEach(silence);
  };

  expect(arcli).toBe('arcli');
  silence(program);
  captured.length = 0;
  await program.parseAsync(['node', 'arcli', ...args]);

  const call = captured[0];

  if (!call) throw new Error(`"${line}" no llego a un comando de facturacion`);

  return call;
}
