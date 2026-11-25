import type { Command } from 'commander';
import { expect } from 'vitest';

import type { VoucherShortcut } from '../../../modules/billing/billing.types';
import { resolveBillingCurrencyCode } from '../../../modules/billing/currency-codes';
import { EXPORT_VOUCHER_KIND, type ExportVoucherKind } from '../../../modules/export/export.kinds';
import { DEFAULT_EXPORT_PAYMENT_TERMS } from '../../../modules/export/export.payload';
import {
  DEFAULT_EXPORT_TYPE,
  DEFAULT_EXPORT_UNIT_CODE,
  type ExportItemInput,
} from '../../../modules/export/export.types';
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

/**
 * La entrada, para comparar la del asistente con la que arma el parser con el comando equivalente (la invariante 2 del
 * navegador): sin lo que dice si se emite (el comando lleva `--emitir`, el asistente lo pregunta despues) ni los campos
 * vacios, y con lo que el CLI toma solo cuando el comando no lo dice: el CUIT emisor en el asociado, `PES` por `ARS`,
 * sin `--misma-moneda`, y en la E la forma de pago, el tipo, la unidad de los items, `fe` y de donde salio el modo.
 */
export function comparableInput(input: object, issuerCuit: number): Record<string, unknown> {
  const plain = JSON.parse(
    JSON.stringify(input, (key, value: unknown) =>
      key === 'dryRun' || key === 'emit' || key === 'modeSource' ? undefined : value,
    ),
  ) as Record<string, unknown>;
  const associated = plain.associatedVoucher as Record<string, unknown> | undefined;

  return {
    ...plain,
    sameCurrency: plain.sameCurrency === true || undefined,
    ...(associated && 'puntoVenta' in associated
      ? { associatedVoucher: { cuit: String(issuerCuit), ...associated } }
      : {}),
    ...(typeof plain.currencyCode === 'string' ? { currencyCode: resolveBillingCurrencyCode(plain.currencyCode) } : {}),
    ...('amount' in plain
      ? {
          exportType: plain.exportType ?? (isExportNoteInput(plain) ? undefined : DEFAULT_EXPORT_TYPE),
          paymentTerms: plain.paymentTerms ?? (isExportNoteInput(plain) ? undefined : DEFAULT_EXPORT_PAYMENT_TERMS),
          items: (plain.items as ExportItemInput[] | undefined)?.map((item) => ({
            ...item,
            unit: item.unit ?? DEFAULT_EXPORT_UNIT_CODE,
          })),
          voucherKind:
            (plain.voucherKind as { shortcut?: string } | undefined)?.shortcut ?? EXPORT_VOUCHER_KIND.shortcut,
        }
      : {}),
  };
}

const isExportNoteInput = (input: Record<string, unknown>): boolean =>
  (input.voucherKind as { shortcut?: string } | undefined)?.shortcut !== undefined &&
  (input.voucherKind as { shortcut: string }).shortcut !== EXPORT_VOUCHER_KIND.shortcut;
