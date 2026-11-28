import type { Command } from 'commander';

import {
  checkVoucher,
  isChecked,
  resolveVoucherCheckRequest,
  type VoucherCheckInput,
} from '../../modules/voucher-check/voucher-check';
import { formatVoucherCheckAsText, serializeVoucherCheck } from '../../modules/voucher-check/voucher-check.presenter';
import { ArcaClientFactory } from '../../services/arca/arca-client.factory';
import { systemClock } from '../../services/time/system-clock';
import { withQuerySpinner, writeQueryOutput } from '../arca-query';
import { resolveArcaRuntime } from '../arca-runtime';
import { getGlobalOptions, registerQueryOptions } from '../global-options';
import { configureSpanishHelp, createVoucherCheckHelp } from '../help';
import { amountOption, cuitOption } from '../option-parsers';

import { REJECTED_EXIT_CODE } from './billing.command.shared';

interface VoucherCheckOptions {
  readonly cae?: string;
  readonly caea?: string;
  readonly cuil?: string;
  readonly cuit?: string;
  readonly dni?: string;
  readonly emisor?: string;
  readonly fecha?: string;
  readonly monto?: number;
  readonly qr?: string;
}

export function registerVoucherCheckCommand(program: Command): void {
  const command = program
    .command('constatar')
    .argument('[tipo]', 'atajo del comprobante (fa, fb, nca…) o su código de ARCA (1, 6, 51…)')
    .argument('[comprobante]', 'punto de venta y número, como 3-1234 o 00003-00001234')
    .description('constatar en ARCA un comprobante recibido: que exista y coincida con lo que se te entregó')
    .option('--emisor <cuit>', 'CUIT de quien emitió el comprobante', cuitOption('--emisor'))
    .option(
      '-f, --fecha <fecha>',
      'fecha del comprobante; acepta D, D/M, D/M/YY o D/M/YYYY con - o /, hoy, ayer, +N o -N (días desde hoy)',
    )
    .option(
      '-m, --monto <numero>',
      'importe total del comprobante, por ejemplo 15000 o 1.500,50 (puede ser 0)',
      amountOption('--monto', undefined, { allowZero: true }),
    )
    .option('--cae <codigo>', 'CAE del comprobante (14 dígitos)')
    .option('--caea <codigo>', 'CAEA del comprobante (14 dígitos)')
    .option('--cuit <numero>', 'CUIT del receptor; obligatorio en A y FCE', cuitOption('--cuit'))
    .option('--cuil <numero>', 'CUIL del receptor', cuitOption('--cuil'))
    .option('--dni <numero>', 'DNI del receptor')
    .option('--qr <url>', 'la dirección del QR del comprobante, en vez de los datos')
    .addHelpText('after', createVoucherCheckHelp());

  registerQueryOptions(command);
  configureSpanishHelp(command);

  command.action(
    async (kind: string | undefined, voucher: string | undefined, options: VoucherCheckOptions, self: Command) => {
      const input: VoucherCheckInput = {
        amount: options.monto,
        cae: options.cae,
        caea: options.caea,
        cuil: options.cuil,
        cuit: options.cuit,
        date: options.fecha,
        dni: options.dni,
        issuer: options.emisor,
        kind,
        qr: options.qr,
        voucher,
      };
      // Antes del runtime: un error de entrada no pide el ticket ni avisa del certificado.
      const request = resolveVoucherCheckRequest(input, systemClock.now());
      const runtime = resolveArcaRuntime(getGlobalOptions(self));
      const gateway = new ArcaClientFactory().createVoucherCheckGateway(runtime);
      const report = await withQuerySpinner(
        runtime,
        () => checkVoucher(gateway, request, runtime.environment),
        'Constatando en ARCA...',
      );

      writeQueryOutput(runtime, {
        json: () => serializeVoucherCheck(report),
        text: () => formatVoucherCheckAsText(report),
      });

      // No constatado: la consulta salió bien, pero ARCA no lo reconoce. Como un rechazo al emitir.
      if (!isChecked(report)) {
        process.exitCode = REJECTED_EXIT_CODE;
      }
    },
  );
}
