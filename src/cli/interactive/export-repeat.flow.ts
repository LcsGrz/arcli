import { formatDateAsArcaDate } from '../../lib/dates/arca-date';
import { parseStrictInteger } from '../../lib/numbers/strict-integer';
import { formatMoneyLabel } from '../../modules/billing/billing.labels';
import { resolveExportClientCountryCuit } from '../../modules/export/export.mappers';
import { EXPORT_RULES, type ExportRuleContext } from '../../modules/export/export.rules';
import {
  DEFAULT_EXPORT_TYPE,
  EXPORT_VOUCHER_KIND,
  type ExportCountry,
  type ExportCountryCuit,
  type ExportGateway,
  type ExportVoucherInput,
} from '../../modules/export/export.types';
import { amountInputText, parseAmountInput } from '../../modules/interactive/amount-input';
import { completeDateInput } from '../../modules/interactive/date-input';
import { copyExportInvoice, type ExportInvoiceCopy } from '../../modules/interactive/export-copy';
import {
  type ExportOptions,
  type ExportRuleScope,
  isCountryCuitMissing,
} from '../../modules/interactive/export-optionals';
import { buildExportRepeatInput, type ExportRepeatState } from '../../modules/interactive/export-repeat-input';
import { rulesFinalize } from '../../modules/interactive/rule-validator';
import { BACK, requireStepValue, runWizard, type WizardStep } from '../../modules/interactive/wizard';
import { ArcaClientFactory } from '../../services/arca/arca-client.factory';
import { noticePanel, writeTerminalOutput } from '../../ui';
import { withSpinner } from '../spinner';

import { askPermitsStep, emitExportVoucher } from './export.flow';
import { askCountryCuit, exportOptionalsStep, validateExportPaymentDate } from './export-options';
import { withFinalizeNotice } from './finalize-notice';
import { pickExportVoucher } from './invoice-picker';
import { askTextStep, chooseStep } from './prompts';
import type { InteractiveSession } from './session';
import { validateAmount, validatePositiveInteger } from './validators';

/** Las tablas de WSFEX para el destino de la factura y su CUIT, como en "Emitir factura". */
export interface ExportRepeatTables {
  readonly countries: readonly ExportCountry[];
  readonly countryCuits: readonly ExportCountryCuit[];
}

/** El CUIT que ARCA publica para el destino, o `undefined` si no tiene. */
function defaultCountryCuit(country: ExportCountry, countryCuits: readonly ExportCountryCuit[]): number | undefined {
  return resolveExportClientCountryCuit({ country, countries: countryCuits });
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

  return withFinalizeNotice([
    {
      name: 'factura',
      run: async (_state, previous) => {
        const picked = await pickExportVoucher(session, gateway, {
          message: '¿Cuál repetimos?',
          pointOfSale,
          previous: previous?.original,
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
            `Se copian el cliente ${original.clientName}, ${country.name}, la moneda, el incoterm y los ítems. Las fechas son nuevas y la cotización, la de la fecha del comprobante.`,
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
      dependsOn: ['factura'],
      name: 'mismo-monto',
      run: async (state, previous) => {
        const original = requireStepValue(state.original, 'original');
        const copy = requireStepValue(state.copy, 'copy');
        const scope = await chooseStep(
          '¿Mismo monto?',
          [
            { name: `Sí, ${formatMoneyLabel(original.total, original.currencyCode)}`, value: 'mismo' as const },
            { name: 'No, ingresar otro monto', value: 'otro' as const },
          ],
          previous?.sameAmount === undefined ? undefined : previous.sameAmount ? 'mismo' : 'otro',
        );

        if (scope === BACK) {
          return BACK;
        }

        return scope === 'mismo'
          ? { copy: { ...copy, amount: original.total }, sameAmount: true }
          : { sameAmount: false };
      },
    },
    {
      // Va en la moneda de la factura.
      dependsOn: ['factura'],
      name: 'monto',
      run: async (state, previous) => {
        const original = requireStepValue(state.original, 'original');
        const copy = requireStepValue(state.copy, 'copy');
        const answer = await askTextStep(`Monto total en ${original.currencyCode}:`, {
          previousAnswer: amountInputText(previous?.copy?.amount),
          validate: validateAmount,
        });

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
      skip: (state) => state.sameAmount === true,
    },
    {
      // Es sobre la moneda de la factura elegida.
      dependsOn: ['factura'],
      name: 'misma-moneda',
      // FEXGetCMP casi siempre trae `CanMisMonExt`; si no, se pregunta como en "Emitir factura".
      run: async (state, previous) => {
        const sameCurrency = await chooseStep(
          '¿Te pagan en la moneda de la factura?',
          [
            { description: 'ARCA lo registra como cancelación en la misma moneda', name: 'Sí', value: true },
            { name: 'No, en pesos', value: false },
          ],
          previous?.copy?.sameCurrency,
        );

        return sameCurrency === BACK ? BACK : { copy: { ...requireStepValue(state.copy, 'copy'), sameCurrency } };
      },
      skip: (state) => state.copy?.sameCurrency !== undefined,
    },
    {
      // La factura no trae CUIT del pais y ARCA no publica uno para el destino: sin esto ARCA la rechaza.
      name: 'cuit-pais',
      run: async (state, previous) => {
        const country = requireStepValue(state.country, 'country');
        // Al volver arranca escrito, si es del destino (REV-74, #10).
        const cuit = await askCountryCuit(
          { country, countryCuits: tables.countryCuits },
          `ARCA no tiene un CUIT publicado para ${country.name}. Escribí el CUIT del país o buscalo por nombre:`,
          { previous: previous?.options?.clientCountryCuit },
        );

        return cuit === BACK ? BACK : { options: { ...state.options, clientCountryCuit: cuit } };
      },
      // Con el ID impositivo de la factura alcanza: ARCA pide uno de los dos (error 1580).
      skip: (state) =>
        !state.country ||
        state.options?.clientCountryCuit !== undefined ||
        Boolean(state.copy?.clientTaxId?.trim()) ||
        !isCountryCuitMissing({ country: state.country, countryCuits: tables.countryCuits }),
    },
    {
      // Los permisos son de cada embarque: no se copian.
      name: 'permisos',
      run: askPermitsStep,
      skip: (state) => state.copy?.exportType !== 1,
    },
    {
      // La factura no trae actividad y tampoco esta en la config. Es opcional: ARCA no exige `Actividades`.
      name: 'actividad',
      run: async (state, previous) => {
        const answer = await askTextStep(
          'Código de actividad de WSFEX, por ejemplo 620100 (Enter para no informarla):',
          {
            previousAnswer: previous?.copy?.activity === undefined ? undefined : String(previous.copy.activity),
            validate: (value) => (value.trim() ? validatePositiveInteger('La actividad')(value) : true),
          },
        );

        return answer === BACK
          ? BACK
          : {
              copy: {
                ...requireStepValue(state.copy, 'copy'),
                activity: answer.trim() ? parseStrictInteger(answer) : undefined,
              },
            };
      },
      skip: (state) => state.copy?.activity !== undefined || configuredActivity !== undefined,
    },
    exportOptionalsStep<ExportRepeatState>({
      context: (state) => {
        const copy = requireStepValue(state.copy, 'copy');
        const original = requireStepValue(state.original, 'original');
        const currencyCode = copy.currencyCode ?? 'DOL';

        return {
          amount: requireStepValue(copy.amount, 'amount'),
          // Items, idioma, CUIT del pais y descripcion del incoterm vienen de la factura elegida: con otra, arrancan con
          // lo copiado de esa.
          copiedFrom: `${original.pointOfSale}:${original.number}`,
          countryCuit: { country: requireStepValue(state.country, 'country'), countryCuits: tables.countryCuits },
          currencyCode,
          // En servicios y con el pago en dolares ARCA exige la suya (2053, 1604): no se ofrece otra.
          defaultExchangeRate:
            currencyCode === 'PES' || copy.exportType === 2 || copy.sameCurrency
              ? undefined
              : 'la de aduana que publica ARCA',
          defaultLanguage: 'Español',
          exportType: copy.exportType ?? DEFAULT_EXPORT_TYPE,
          // Sin descripcion por defecto: la copiada ya esta en las opciones y Enter la mantiene.
          incoterm: copy.incoterm ? { code: copy.incoterm } : undefined,
          languages: () => gateway.getLanguages(),
          rules: exportRepeatRuleScope(state, configuredActivity),
          sameCurrency: copy.sameCurrency,
          units: () => gateway.getUnits(),
        };
      },
      name: 'opcionales',
      read: (state) => state.options ?? {},
      write: (options) => ({ options }),
    }),
    {
      // Despues de los opcionales: no puede ser anterior a la fecha del comprobante, que se elige ahi (1674).
      // Solo la fecha del comprobante: cambiar otro opcional no la olvida.
      dependsOn: [{ fields: ['options.voucherDate'], step: 'opcionales' }],
      name: 'fecha-pago',
      run: async (state, previous) => {
        const answer = await askTextStep('Fecha de pago (Enter para la fecha del comprobante):', {
          previousAnswer: previous?.paymentDate,
          validate: validateExportPaymentDate(state.options?.voucherDate),
        });

        // Completa, como la fecha del comprobante: pegado otro dia, el comando equivalente da la misma.
        return answer === BACK ? BACK : { paymentDate: answer.trim() ? completeDateInput(answer) : undefined };
      },
      // En bienes ARCA rechaza la fecha de pago (error 1673).
      skip: (state) => state.copy?.exportType === 1,
      writes: ['paymentDate'],
    },
  ]);
}

/** Las reglas de la E desde una pregunta de "Repetir": la factura con lo copiado y lo respondido, y hoy. */
function exportRepeatRuleScope(state: ExportRepeatState, configuredActivity: number | undefined): ExportRuleScope {
  return {
    context: { today: formatDateAsArcaDate(new Date()) },
    draft: (patch) => ({ ...buildExportRepeatInput(state, { configuredActivity }), ...patch }),
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
  const configured = session.runtime.config.exportacion?.actividad;
  const state = await runWizard<ExportRepeatState>(
    exportRepeatSteps(session, gateway, tables, pointOfSale),
    {},
    undefined,
    {
      // Las reglas sobre la factura final: si una falla, vuelve a la pregunta que escribe el campo.
      finalize: rulesFinalize<ExportRepeatState, ExportVoucherInput, ExportRuleContext>({
        context: (current) => exportRepeatRuleScope(current, configured).context,
        draft: (current) =>
          current.copy && current.country
            ? buildExportRepeatInput(current, { configuredActivity: configured })
            : undefined,
        rules: EXPORT_RULES,
      }),
    },
  );

  if (!state) {
    return BACK;
  }

  const configuredActivity = session.runtime.config.exportacion?.actividad;
  const input = buildExportRepeatInput(state, { configuredActivity });

  await emitExportVoucher(session, gateway, input, input.activity);
}
