import type { Command } from 'commander';

import { AppError, InputValidationError } from '../../lib/errors/app-error';
import { parseStrictInteger } from '../../lib/numbers/strict-integer';
import { formatVoucherWithArticle } from '../../modules/billing/billing.mappers';
import type { VoucherKindDefinition } from '../../modules/billing/billing.types';
import { getVoucherKindByShortcut, VOUCHER_SHORTCUTS } from '../../modules/billing/voucher-kind-map';
import { formatEnvironmentLabel } from '../../modules/config/config.schemas';
import { listRecentExportVouchers } from '../../modules/export/export.history';
import {
  formatExportVoucherDetailAsJson,
  formatExportVoucherDetailAsText,
  formatExportVoucherListAsJson,
  formatExportVoucherListAsText,
} from '../../modules/export/export.history.presenter';
import {
  EXPORT_VOUCHER_KINDS,
  type ExportVoucherKind,
  getExportVoucherKindByShortcut,
} from '../../modules/export/export.types';
import { listRecentVouchers, MAX_RECENT_VOUCHERS, RECENT_VOUCHERS_LIMIT } from '../../modules/vouchers/voucher-history';
import {
  formatVoucherDetailAsJson,
  formatVoucherDetailAsText,
  formatVoucherListAsJson,
  formatVoucherListAsText,
  formatVoucherNumber,
} from '../../modules/vouchers/voucher-history.presenter';
import type { ResolvedArcaRuntime } from '../../services/arca/arca-context.resolver';
import { ArcaVoucherHistoryGateway } from '../../services/arca/arca-voucher-history.gateway';
import { type ArcaQuery, createArcaQuery, createExportQuery, withQuerySpinner, writeQueryOutput } from '../arca-query';
import { registerQueryOptions } from '../global-options';
import { configureSpanishHelp, createVoucherQueryHelp } from '../help';
import { integerOption } from '../option-parsers';

interface PointOfSaleOptions {
  readonly pv?: number;
  readonly puntoVenta?: number;
}

/** A, B y C van por wsfe; la E (`fe`, `nde`, `nce`), por wsfex. */
type QueryVoucherKind =
  | { readonly kind: VoucherKindDefinition; readonly service: 'wsfe' }
  | { readonly kind: ExportVoucherKind; readonly service: 'wsfex' };

function requireVoucherKind(shortcut: string): QueryVoucherKind {
  const normalized = shortcut.trim().toLowerCase();
  const voucherKind = getVoucherKindByShortcut(normalized);

  if (voucherKind) {
    return { kind: voucherKind, service: 'wsfe' };
  }

  const exportKind = getExportVoucherKindByShortcut(normalized);

  if (exportKind) {
    return { kind: exportKind, service: 'wsfex' };
  }

  throw new InputValidationError(
    `El tipo "${shortcut}" no es válido. Usá un atajo: ${[...VOUCHER_SHORTCUTS, ...EXPORT_VOUCHER_KINDS.map((kind) => kind.shortcut)].join(', ')}.`,
  );
}

function voucherNotFound(
  kind: VoucherKindDefinition | ExportVoucherKind,
  pointOfSale: number,
  number: number,
  environment: ResolvedArcaRuntime['environment'],
): AppError {
  return new AppError(
    `No existe ${formatVoucherWithArticle(kind)} N° ${formatVoucherNumber(pointOfSale, number)} en ARCA (${formatEnvironmentLabel(environment)}).`,
    { code: 'VOUCHER_NOT_FOUND' },
  );
}

function requirePointOfSale(options: PointOfSaleOptions, runtime: ResolvedArcaRuntime): number {
  const pointOfSale = options.pv ?? options.puntoVenta ?? runtime.pointOfSale;

  if (!pointOfSale || !Number.isInteger(pointOfSale) || pointOfSale <= 0) {
    throw new InputValidationError(
      'Falta el punto de venta. Usá `--pv <numero>` o configuralo con `arcli config establecer puntoVenta <numero>`.',
    );
  }

  return pointOfSale;
}

function createContext(command: Command): ArcaQuery<ArcaVoucherHistoryGateway> {
  return createArcaQuery(command, (arca) => new ArcaVoucherHistoryGateway(arca));
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
        `cuántos comprobantes mostrar (1 a ${MAX_RECENT_VOUCHERS}; por defecto config.comprobantesPorLista o ${RECENT_VOUCHERS_LIMIT})`,
        integerOption('--cantidad'),
      ),
  ).addHelpText('after', createVoucherQueryHelp());

  registerQueryOptions(recent);
  configureSpanishHelp(recent);

  recent.action(async (shortcut: string, options: PointOfSaleOptions & { cantidad?: number }, self: Command) => {
    const query = requireVoucherKind(shortcut);
    const { cantidad } = options;

    if (cantidad !== undefined && (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > MAX_RECENT_VOUCHERS)) {
      throw new InputValidationError(`\`--cantidad\` tiene que ser un número entre 1 y ${MAX_RECENT_VOUCHERS}.`);
    }

    if (query.service === 'wsfex') {
      const { gateway, runtime } = createExportQuery(self);
      const limit = cantidad ?? runtime.config.comprobantesPorLista ?? RECENT_VOUCHERS_LIMIT;
      const pointOfSale = requirePointOfSale(options, runtime);
      const vouchers = await withQuerySpinner(runtime, () =>
        listRecentExportVouchers(gateway, pointOfSale, query.kind.arcaType, { limit }),
      );
      const report = { environment: runtime.environment, pointOfSale, voucherKind: query.kind, vouchers };

      writeQueryOutput(runtime, {
        json: () => formatExportVoucherListAsJson(report),
        text: () => formatExportVoucherListAsText(report),
      });

      return;
    }

    const voucherKind = query.kind;
    const { gateway, runtime } = createContext(self);
    const limit = cantidad ?? runtime.config.comprobantesPorLista ?? RECENT_VOUCHERS_LIMIT;
    const pointOfSale = requirePointOfSale(options, runtime);
    const vouchers = await withQuerySpinner(runtime, () =>
      listRecentVouchers(gateway, pointOfSale, voucherKind.arcaType, { limit }),
    );
    const report = { environment: runtime.environment, pointOfSale, voucherKind, vouchers };

    writeQueryOutput(runtime, {
      json: () => formatVoucherListAsJson(report),
      text: () => formatVoucherListAsText(report),
    });
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
    const query = requireVoucherKind(shortcut);
    const number = parseStrictInteger(rawNumber);

    if (number === undefined || number <= 0) {
      throw new InputValidationError(`El número "${rawNumber}" no es válido: tiene que ser un entero positivo.`);
    }

    if (query.service === 'wsfex') {
      const { gateway, runtime } = createExportQuery(self);
      const pointOfSale = requirePointOfSale(options, runtime);
      const voucher = await withQuerySpinner(runtime, () =>
        gateway.getVoucher({ arcaType: query.kind.arcaType, number, pointOfSale }),
      );

      if (!voucher) {
        throw voucherNotFound(query.kind, pointOfSale, number, runtime.environment);
      }

      const report = { environment: runtime.environment, pointOfSale, voucher, voucherKind: query.kind };

      writeQueryOutput(runtime, {
        json: () => formatExportVoucherDetailAsJson(report),
        text: () => formatExportVoucherDetailAsText(report),
      });

      return;
    }

    const voucherKind = query.kind;
    const { gateway, runtime } = createContext(self);
    const pointOfSale = requirePointOfSale(options, runtime);
    const voucher = await withQuerySpinner(runtime, () =>
      gateway.getVoucher(number, pointOfSale, voucherKind.arcaType),
    );

    if (!voucher) {
      throw voucherNotFound(voucherKind, pointOfSale, number, runtime.environment);
    }

    const report = { environment: runtime.environment, pointOfSale, voucher, voucherKind };

    writeQueryOutput(runtime, {
      json: () => formatVoucherDetailAsJson(report),
      text: () => formatVoucherDetailAsText(report),
    });
  });
}
