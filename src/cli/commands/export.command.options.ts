import { type Command, Option } from 'commander';

import { InputValidationError } from '../../lib/errors/app-error';
import { EXCHANGE_RATE_DECIMALS } from '../../lib/numbers/argentine-amount';
import { parseStrictInteger } from '../../lib/numbers/strict-integer';
import { parseExportItemArgument } from '../../modules/export/export.items';
import type { ExportItemInput, ExportType } from '../../modules/export/export.types';
import { amountOption, integerOption } from '../option-parsers';

function exportTypeOption(value: string): ExportType {
  const parsed = parseStrictInteger(value);

  if (parsed !== 1 && parsed !== 2 && parsed !== 4) {
    throw new InputValidationError(`--tipo-expo "${value}" no es válido: usá 1 (bienes), 2 (servicios) o 4 (otros).`);
  }

  return parsed;
}

function repeatable<T>(parse: (value: string) => T): (value: string, previous: unknown) => unknown {
  return (value, previous) => [...(Array.isArray(previous) ? (previous as T[]) : []), parse(value)];
}

interface ExportOptionDefinition {
  readonly description: string;
  readonly flags: string;
  /** Alias: se aceptan pero no se listan, como en A, B y C. El flag principal los nombra. */
  readonly hidden?: boolean;
  readonly parser?: (value: string, previous: unknown) => unknown;
}

const EXPORT_OPTIONS: readonly ExportOptionDefinition[] = [
  {
    description: 'importe total del comprobante, por ejemplo 15000 o 1.500,50',
    flags: '-m, --monto <numero>',
    parser: amountOption('--monto'),
  },
  { description: 'nombre o razón social del cliente del exterior', flags: '--cliente <texto>' },
  { description: 'domicilio del cliente en el exterior', flags: '--domicilio-cliente <texto>' },
  {
    description: 'país de destino por código o nombre, por ejemplo 203 o Brasil',
    flags: '--pais-destino <codigo|nombre>',
  },
  { description: 'ID impositivo del cliente en su país', flags: '--id-impositivo <texto>' },
  {
    description: 'CUIT del país del cliente; sin este flag se resuelve desde el país de destino',
    flags: '--cuit-pais <numero>',
    parser: integerOption('--cuit-pais'),
  },
  {
    description: 'tipo de exportación: 1 bienes, 2 servicios (por defecto), 4 otros',
    flags: '--tipo-expo <1|2|4>',
    parser: exportTypeOption,
  },
  {
    description:
      'código de la tabla de actividades de WSFEX, por ejemplo 620100; sin flag, exportacion.actividad de la config',
    flags: '--actividad <codigo>',
    parser: integerOption('--actividad'),
  },
  { description: 'código de incoterm, por ejemplo FOB', flags: '--incoterm <codigo>' },
  { description: 'descripción del incoterm; por defecto la de la tabla de ARCA', flags: '--incoterms-desc <texto>' },
  {
    description: 'código de idioma del comprobante: 1 español (por defecto), 2 inglés, 3 portugués',
    flags: '--idioma <codigo>',
    parser: integerOption('--idioma'),
  },
  { description: 'forma de pago; por defecto "Transferencia Internacional"', flags: '--forma-pago <texto>' },
  {
    description: 'permiso de embarque ya existente; repetible. Requiere --permiso-existente y --tipo-expo 1',
    flags: '--permiso <id>',
    parser: repeatable((value: string) => value),
  },
  {
    description: 'el permiso de embarque informado ya existe en ARCA',
    flags: '--permiso-existente',
  },
  {
    description:
      'item del comprobante: "codigo|descripcion|cantidad|precio|unidad". Repetible; la suma tiene que dar --monto',
    flags: '--item <partes>',
    parser: repeatable<ExportItemInput>((value) => parseExportItemArgument(value)),
  },
  {
    description: 'número del comprobante; por defecto el siguiente de ARCA',
    flags: '--numero <numero>',
    parser: integerOption('--numero'),
  },
  {
    description: 'ID de la solicitud; por defecto el siguiente de ARCA',
    flags: '--id-solicitud <numero>',
    parser: integerOption('--id-solicitud'),
  },
  {
    description: 'punto de venta (alias: --pv)',
    flags: '--punto-venta <numero>',
    parser: integerOption('--punto-venta'),
  },
  { description: 'alias de --punto-venta', flags: '--pv <numero>', hidden: true, parser: integerOption('--pv') },
  { description: 'fecha del comprobante; acepta D, D/M, D/M/YY o D/M/YYYY con - o /', flags: '-f, --fecha <fecha>' },
  { description: 'fecha de pago; por defecto la del comprobante', flags: '--fecha-pago <fecha>' },
  { description: 'código de moneda: USD o DOL (por defecto), ARS o PES (alias: --mda)', flags: '--moneda <codigo>' },
  { description: 'alias de --moneda', flags: '--mda <codigo>', hidden: true },
  {
    description: 'cotización de la moneda; sin este flag se usa la de aduana que publica ARCA (alias: --cm)',
    flags: '--cotizacion-moneda <numero>',
    parser: amountOption('--cotizacion-moneda', EXCHANGE_RATE_DECIMALS),
  },
  {
    description: 'alias de --cotizacion-moneda',
    flags: '--cm <numero>',
    hidden: true,
    parser: amountOption('--cm', EXCHANGE_RATE_DECIMALS),
  },
  { description: 'el pago se cancela en la misma moneda extranjera', flags: '--misma-moneda' },
  { description: 'observaciones del comprobante', flags: '--observaciones <texto>' },
  { description: 'observaciones comerciales del comprobante', flags: '--obs-comerciales <texto>' },
  {
    description: 'descripción del comprobante cuando no se informan items; también va al PDF',
    flags: '--descripcion <texto>',
  },
  { description: 'cargar los datos desde un archivo JSON', flags: '--cargar <ruta>' },
  {
    description: 'generar el PDF del comprobante emitido, aunque la config diga otra cosa (alias: --pdf)',
    flags: '--exportar-pdf',
  },
  { description: 'alias de --exportar-pdf', flags: '--pdf', hidden: true },
  { description: 'no generar el PDF, aunque la config diga otra cosa', flags: '--sin-pdf' },
  { description: 'mostrar el payload antes de emitir en ARCA', flags: '--previsualizar' },
  { description: 'emitir realmente en ARCA', flags: '--emitir' },
];

/** Los flags largos que aplican a la factura E, incluidos los que comparte con A, B y C (`--monto`, `--fecha`...). */
export const EXPORT_OPTION_FLAGS: ReadonlySet<string> = new Set(
  EXPORT_OPTIONS.map((definition) => new Option(definition.flags).long).filter((flag): flag is string => Boolean(flag)),
);

/**
 * Registra las opciones de la factura E. `hidden` las registra sin mostrarlas: `arcli factura <letra>` las acepta
 * para la letra E. Las que el comando ya tiene (`--monto`, `--fecha`...) se reusan. Devuelve las que agrego.
 */
export function registerExportOptions(command: Command, options: { readonly hidden?: boolean } = {}): Option[] {
  const existing = new Set(
    command.options.flatMap((option) => [option.short, option.long]).filter((flag): flag is string => Boolean(flag)),
  );
  const added: Option[] = [];

  for (const definition of EXPORT_OPTIONS) {
    const option = new Option(definition.flags, definition.description);
    const flags = [option.short, option.long].filter((flag): flag is string => Boolean(flag));

    if (flags.some((flag) => existing.has(flag))) {
      continue;
    }

    if (definition.parser) {
      option.argParser(definition.parser);
    }

    if (options.hidden || definition.hidden) {
      option.hideHelp();
    }

    command.addOption(option);
    added.push(option);
  }

  return added;
}
