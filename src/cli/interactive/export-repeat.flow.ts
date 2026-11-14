import { parseStrictInteger } from '../../lib/numbers/strict-integer';
import { formatMoneyLabel } from '../../modules/billing/billing.labels';
import { resolveExportClientCountryCuit } from '../../modules/export/export.mappers';
import {
  EXPORT_VOUCHER_KIND,
  type ExportCountry,
  type ExportCountryCuit,
  type ExportGateway,
  type ExportIssuedVoucher,
  type ExportVoucherInput,
} from '../../modules/export/export.types';
import { parseAmountInput } from '../../modules/interactive/amount-input';
import { copyExportInvoice, type ExportInvoiceCopy } from '../../modules/interactive/export-copy';
import { BACK, requireStepValue, runWizard, type WizardStep } from '../../modules/interactive/wizard';
import { ArcaClientFactory } from '../../services/arca/arca-client.factory';
import { noticePanel, writeTerminalOutput } from '../../ui';
import { withSpinner } from '../spinner';

import { askPermitsStep, emitExportVoucher } from './export.flow';
import { askCountryCuit, askExportOptions, type ExportOptions, isCountryCuitMissing } from './export-options';
import { pickExportVoucher } from './invoice-picker';
import { askTextStep, chooseStep } from './prompts';
import type { InteractiveSession } from './session';
import { validateAmount, validateDate } from './validators';

export interface ExportRepeatState {
  /** Lo copiado de la factura, con el monto y los items ya ajustados si se cambio el monto. */
  readonly copy?: ExportInvoiceCopy['input'];
  readonly country?: ExportCountry;
  readonly original?: ExportIssuedVoucher;
  readonly options?: ExportOptions;
  readonly paymentDate?: string;
  readonly permits?: readonly string[];
}

/** Las tablas de WSFEX para el destino de la factura y su CUIT, como en "Emitir factura". */
export interface ExportRepeatTables {
  readonly countries: readonly ExportCountry[];
  readonly countryCuits: readonly ExportCountryCuit[];
}

function optionalDate(value: string): string | true {
  return value.trim() ? validateDate(value) : true;
}

function validateActivity(value: string): string | true {
  const number = parseStrictInteger(value);

  return number !== undefined && number >= 1 ? true : 'La actividad tiene que ser un número entero mayor a 0.';
}

/** El CUIT que ARCA publica para el destino, o `undefined` si no tiene. */
function defaultCountryCuit(country: ExportCountry, countryCuits: readonly ExportCountryCuit[]): number | undefined {
  try {
    return resolveExportClientCountryCuit({ country, countries: countryCuits });
  } catch {
    return undefined;
  }
}

/** Lo que se copia en `options` (los opcionales de la E), para que la seleccion de opcionales lo muestre. */
function optionsOf(copy: ExportInvoiceCopy['input']): ExportOptions {
  return {
    clientCountryCuit: copy.clientCountryCuit,
    incotermDescription: copy.incotermDescription,
    items: copy.items,
    language: copy.language,
  };
}

/**
 * Pasos para repetir una factura E: se elige una de las ultimas y se copian cliente, destino, moneda, incoterm e
 * items. Las fechas son nuevas, la cotizacion es la de hoy, y se preguntan el monto, los permisos de embarque y la
 * fecha de pago, que son de cada operacion.
 */
export function exportRepeatSteps(
  session: InteractiveSession,
  gateway: Pick<ExportGateway, 'getLanguages' | 'getLastVoucherNumber' | 'getUnits' | 'getVoucher'>,
  tables: ExportRepeatTables,
  pointOfSale: number,
): Array<WizardStep<ExportRepeatState>> {
  const configuredActivity = session.runtime.config.exportacion?.actividad;

  return [
    {
      name: 'factura',
      run: async () => {
        const picked = await pickExportVoucher(session, gateway, {
          message: '¿Cuál repetimos?',
          pointOfSale,
          voucherKind: EXPORT_VOUCHER_KIND,
        });

        if (picked === BACK) {
          return BACK;
        }

        const original = picked.invoice;
        const country = tables.countries.find((entry) => entry.code === original.destinationCountry);

        if (!country) {
          writeTerminalOutput(
            noticePanel(
              `El destino de la factura (${original.destinationCountry}) ya no está en la tabla de países de ARCA. Usá \`arcli fe\` con otro destino.`,
              'warning',
            ),
          );

          return BACK;
        }

        const { input, limitation } = copyExportInvoice(original, defaultCountryCuit(country, tables.countryCuits));

        writeTerminalOutput(
          noticePanel(
            `Se copian el cliente ${original.clientName}, ${country.name}, la moneda, el incoterm y los ítems. Las fechas son nuevas y la cotización, la de hoy.`,
            'info',
          ),
        );

        if (limitation) {
          writeTerminalOutput(noticePanel(limitation, 'warning'));
        }

        return { copy: input, country, options: optionsOf(input), original };
      },
    },
    {
      name: 'monto',
      run: async (state) => {
        const original = requireStepValue(state.original, 'original');
        const copy = requireStepValue(state.copy, 'copy');
        const scope = await chooseStep('¿Mismo monto?', [
          { name: `Sí, ${formatMoneyLabel(original.total, original.currencyCode)}`, value: 'mismo' as const },
          { name: 'No, ingresar otro monto', value: 'otro' as const },
        ]);

        if (scope === BACK) {
          return BACK;
        }

        if (scope === 'mismo') {
          // Si antes se habia elegido otro monto, vuelven los items de la factura.
          const { items } = copyExportInvoice(original).input;

          return { copy: { ...copy, amount: original.total, items }, options: { ...state.options, items } };
        }

        const answer = await askTextStep(`Monto total en ${original.currencyCode}:`, { validate: validateAmount });

        if (answer === BACK) {
          return BACK;
        }

        const amount = parseAmountInput(answer);

        if (!copy.items || amount === original.total) {
          return { copy: { ...copy, amount } };
        }

        // Los items copiados suman el monto de la factura: con otro monto se cargan de nuevo en los opcionales.
        writeTerminalOutput(
          noticePanel(
            'Con otro monto los ítems de la factura no suman: sale un renglón con el monto total. Si querés, cargá los ítems en los opcionales.',
            'warning',
          ),
        );

        return { copy: { ...copy, amount, items: undefined }, options: { ...state.options, items: undefined } };
      },
    },
    {
      name: 'misma-moneda',
      // FEXGetCMP casi siempre trae `CanMisMonExt`; si no, se pregunta como en "Emitir factura".
      run: async (state) => {
        const sameCurrency = await chooseStep('¿Te pagan en la moneda de la factura?', [
          { description: 'ARCA lo registra como cancelación en la misma moneda', name: 'Sí', value: true },
          { name: 'No, en pesos', value: false },
        ]);

        return sameCurrency === BACK ? BACK : { copy: { ...requireStepValue(state.copy, 'copy'), sameCurrency } };
      },
      skip: (state) => state.copy?.sameCurrency !== undefined,
    },
    {
      // La factura no trae CUIT del pais y ARCA no publica uno para el destino: sin esto ARCA la rechaza.
      name: 'cuit-pais',
      run: async (state) => {
        const country = requireStepValue(state.country, 'country');
        const cuit = await askCountryCuit(
          { country, countryCuits: tables.countryCuits },
          `ARCA no tiene un CUIT publicado para ${country.name}. Escribí el CUIT del país o buscalo por nombre:`,
        );

        return cuit === BACK ? BACK : { options: { ...state.options, clientCountryCuit: cuit } };
      },
      skip: (state) =>
        !state.country ||
        state.options?.clientCountryCuit !== undefined ||
        !isCountryCuitMissing({ country: state.country, countryCuits: tables.countryCuits }),
    },
    {
      // Los permisos son de cada embarque: no se copian.
      name: 'permisos',
      run: askPermitsStep,
      skip: (state) => state.copy?.exportType !== 1,
    },
    {
      name: 'fecha-pago',
      run: async () => {
        const answer = await askTextStep('Fecha de pago (Enter para la fecha del comprobante):', {
          validate: optionalDate,
        });

        return answer === BACK ? BACK : { paymentDate: answer.trim() || undefined };
      },
    },
    {
      // La factura siempre tiene actividad; esto es por si ARCA no la devolvio y tampoco esta en la config.
      name: 'actividad',
      run: async (state) => {
        const answer = await askTextStep('Código de actividad de WSFEX (por ejemplo 620100):', {
          validate: validateActivity,
        });

        return answer === BACK
          ? BACK
          : { copy: { ...requireStepValue(state.copy, 'copy'), activity: parseStrictInteger(answer) } };
      },
      skip: (state) => state.copy?.activity !== undefined || configuredActivity !== undefined,
    },
    {
      name: 'opcionales',
      run: async (state) => {
        const copy = requireStepValue(state.copy, 'copy');
        const country = requireStepValue(state.country, 'country');
        const currencyCode = copy.currencyCode ?? 'DOL';
        const options = await askExportOptions(state.options ?? {}, {
          amount: requireStepValue(copy.amount, 'amount'),
          countryCuit: { country, countryCuits: tables.countryCuits },
          currencyCode,
          defaultExchangeRate: currencyCode === 'PES' ? undefined : 'la de aduana que publica ARCA',
          defaultLanguage: 'Español',
          // Sin descripcion por defecto: la copiada ya esta en las opciones y Enter la mantiene.
          incoterm: copy.incoterm ? { code: copy.incoterm } : undefined,
          languages: () => gateway.getLanguages(),
          sameCurrency: copy.sameCurrency,
          units: () => gateway.getUnits(),
        });

        return options === BACK ? BACK : { options };
      },
    },
  ];
}

/** La entrada de `arcli fe` con lo copiado y lo respondido. */
export function buildExportRepeatInput(state: ExportRepeatState, configuredActivity?: number): ExportVoucherInput {
  const copy = requireStepValue(state.copy, 'copy');
  const country = requireStepValue(state.country, 'country');

  return {
    ...copy,
    ...state.options,
    activity: copy.activity ?? configuredActivity,
    destinationCountry: country.name,
    emit: false,
    paymentDate: state.paymentDate,
    permits: state.permits,
    permitsExisting: state.permits ? true : undefined,
  };
}

/**
 * Repetir una factura E. Usa ExportService igual que `arcli fe`, asi que valida y emite exactamente lo mismo.
 * Devuelve BACK si se vuelve desde el primer paso, para volver al selector de comprobantes.
 */
export async function runExportRepeatFlow(
  session: InteractiveSession,
  pointOfSale: number,
): Promise<typeof BACK | void> {
  const gateway = new ArcaClientFactory().createExportGateway(session.runtime);
  const tables = await withSpinner('Consultando las tablas de WSFEX...', async () => ({
    countries: await gateway.getDestinationCountries(),
    countryCuits: await gateway.getDestinationCountryCuits(),
  }));
  const state = await runWizard<ExportRepeatState>(exportRepeatSteps(session, gateway, tables, pointOfSale), {});

  if (!state) {
    return BACK;
  }

  const configuredActivity = session.runtime.config.exportacion?.actividad;
  const input = buildExportRepeatInput(state, configuredActivity);

  await emitExportVoucher(session, gateway, input, input.activity);
}
