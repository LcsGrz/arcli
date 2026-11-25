import type { Command } from 'commander';

import { resolveRowsPerList } from '../../modules/config/config.schemas';
import {
  formatExportVoucherDetailAsText,
  formatExportVoucherListAsText,
  serializeExportVoucherDetail,
  serializeExportVoucherList,
} from '../../modules/export/export.history.presenter';
import { MAX_RECENT_VOUCHERS, RECENT_VOUCHERS_LIMIT } from '../../modules/vouchers/voucher-history';
import {
  formatUnreadableVouchers,
  formatVoucherDetailAsText,
  formatVoucherListAsText,
  serializeVoucherDetail,
  serializeVoucherList,
} from '../../modules/vouchers/voucher-history.presenter';
import {
  getVoucher,
  listVouchers,
  parseQueriedNumber,
  type QueryableVoucher,
  resolveQueryableVoucher,
  resolveQueryPointOfSale,
  validateVoucherQuantity,
  type VoucherDetail,
  type VoucherList,
  type VoucherSource,
} from '../../modules/vouchers/voucher-query';
import { ArcaVoucherHistoryGateway } from '../../services/arca/arca-voucher-history.gateway';
import { writeTerminalNotice } from '../../ui';
import { createArcaQuery, createExportQuery, withQuerySpinner, writeQueryOutput } from '../arca-query';
import type { CliArcaRuntime } from '../arca-runtime';
import { outputState, settleOutput } from '../closed-output';
import { registerQueryOptions } from '../global-options';
import { configureSpanishHelp, createVoucherQueryHelp } from '../help';
import { integerOption } from '../option-parsers';

interface PointOfSaleOptions {
  readonly pv?: number;
  readonly puntoVenta?: number;
}

function requestedPointOfSale({ pv, puntoVenta }: PointOfSaleOptions, runtime: CliArcaRuntime): number {
  return resolveQueryPointOfSale(pv ?? puntoVenta, runtime.pointOfSale);
}

type QueryOutput = Parameters<typeof writeQueryOutput>[1];

// Lo unico que cambia con el servicio: el perfil con su gateway y los presenters.

function openVoucherQuery(
  command: Command,
  voucher: QueryableVoucher,
): { readonly runtime: CliArcaRuntime; readonly source: VoucherSource } {
  if (voucher.service === 'wsfex') {
    const { gateway, runtime } = createExportQuery(command);

    return { runtime, source: { ...voucher, gateway } };
  }

  const { gateway, runtime } = createArcaQuery(command, (arca) => new ArcaVoucherHistoryGateway(arca));

  return { runtime, source: { ...voucher, gateway } };
}

function listOutput(list: VoucherList): QueryOutput {
  return list.service === 'wsfex'
    ? { json: () => serializeExportVoucherList(list), text: () => formatExportVoucherListAsText(list) }
    : { json: () => serializeVoucherList(list), text: () => formatVoucherListAsText(list) };
}

function detailOutput(detail: VoucherDetail): QueryOutput {
  return detail.service === 'wsfex'
    ? { json: () => serializeExportVoucherDetail(detail), text: () => formatExportVoucherDetailAsText(detail) }
    : { json: () => serializeVoucherDetail(detail), text: () => formatVoucherDetailAsText(detail) };
}

/** Con `--json` el aviso va a stderr, como el del certificado. Si fallo stdout, ahi va el JSON que lo dice. */
async function warnUnreadableInJson(runtime: CliArcaRuntime, { pointOfSale, vouchers }: VoucherList): Promise<void> {
  if (!runtime.outputJson || !formatUnreadableVouchers(pointOfSale, vouchers)) {
    return;
  }

  await settleOutput('stdout');

  if (!outputState.failures.has('stdout')) {
    writeTerminalNotice(() => formatUnreadableVouchers(pointOfSale, vouchers));
  }
}

function addPointOfSaleOptions(command: Command): Command {
  return command
    .option('--pv <numero>', 'punto de venta; por defecto el de la config', integerOption('--pv'))
    .option('--punto-venta <numero>', 'punto de venta; por defecto el de la config', integerOption('--punto-venta'));
}

export function registerVoucherQueryCommands(program: Command): void {
  const recent = addPointOfSaleOptions(
    program
      .command('ultimos')
      .argument('<tipo>', 'atajo del comprobante, por ejemplo fb, fc, nca o fe')
      .description('listar los últimos comprobantes emitidos en ARCA')
      .option(
        '--cantidad <numero>',
        `cuántos comprobantes mostrar (1 a ${MAX_RECENT_VOUCHERS}; por defecto config.filasPorLista o ${RECENT_VOUCHERS_LIMIT})`,
        integerOption('--cantidad'),
      ),
  ).addHelpText('after', createVoucherQueryHelp());

  registerQueryOptions(recent);
  configureSpanishHelp(recent);

  recent.action(async (shortcut: string, options: PointOfSaleOptions & { cantidad?: number }, self: Command) => {
    const voucher = resolveQueryableVoucher(shortcut);

    validateVoucherQuantity(options.cantidad);

    const { runtime, source } = openVoucherQuery(self, voucher);
    const limit = options.cantidad ?? resolveRowsPerList(runtime.config);
    const pointOfSale = requestedPointOfSale(options, runtime);
    const list = await withQuerySpinner(runtime, () =>
      listVouchers(source, { environment: runtime.environment, limit, pointOfSale }),
    );

    writeQueryOutput(runtime, listOutput(list));

    await warnUnreadableInJson(runtime, list);
  });

  const detail = addPointOfSaleOptions(
    program
      .command('consultar')
      .argument('<tipo>', 'atajo del comprobante, por ejemplo fb, fc, nca o fe')
      .argument('<numero>', 'número del comprobante')
      .description('ver el detalle de un comprobante emitido en ARCA'),
  ).addHelpText('after', createVoucherQueryHelp());

  registerQueryOptions(detail);
  configureSpanishHelp(detail);

  detail.action(async (shortcut: string, rawNumber: string, options: PointOfSaleOptions, self: Command) => {
    const voucher = resolveQueryableVoucher(shortcut);
    const number = parseQueriedNumber(rawNumber);
    const { runtime, source } = openVoucherQuery(self, voucher);
    const pointOfSale = requestedPointOfSale(options, runtime);
    const detailed = await withQuerySpinner(runtime, () =>
      getVoucher(source, { environment: runtime.environment, number, pointOfSale }),
    );

    writeQueryOutput(runtime, detailOutput(detailed));
  });
}
