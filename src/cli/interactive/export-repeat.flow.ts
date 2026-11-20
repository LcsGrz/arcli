import { formatDateAsArcaDate } from '../../lib/dates/arca-date';
import { formatVoucherWithArticle } from '../../modules/billing/billing.mappers';
import { resolveExportClientCountryCuit } from '../../modules/export/export.mappers';
import {
  DEFAULT_EXPORT_TYPE,
  EXPORT_VOUCHER_KIND,
  type ExportCountry,
  type ExportCountryCuit,
  type ExportGateway,
} from '../../modules/export/export.types';
import { copyExportInvoice, copyExportItems, type ExportInvoiceCopy } from '../../modules/interactive/export-copy';
import { type ExportOptions, isCountryCuitMissing } from '../../modules/interactive/export-optionals';
import {
  buildExportRepeatInput,
  exportRepeatFinalize,
  exportRepeatRuleScope,
  type ExportRepeatState,
} from '../../modules/interactive/export-repeat-input';
import { repeatActivityToSave } from '../../modules/interactive/steps/config-offer';
import { fieldLens, nestedLens } from '../../modules/interactive/steps/lens';
import { BACK, requireStepValue, runWizard, type WizardStep } from '../../modules/interactive/wizard';
import { ArcaClientFactory } from '../../services/arca/arca-client.factory';
import { noticePanel, writeTerminalOutput } from '../../ui';

import { askPermitsStep, emitExportVoucher } from './export.flow';
import { askCountryCuit, exportOptionalsStep } from './export-options';
import { withFinalizeNotice } from './finalize-notice';
import { pickExportVoucher } from './invoice-picker';
import { exportExchangeRateLoader } from './official-exchange-rate';
import { chooseStep } from './prompts';
import { offerConfig } from './save-to-config';
import type { InteractiveSession } from './session';
import {
  activitiesLoader,
  activityStep,
  exportExchangeRateStep,
  exportPaymentDateStep,
  type ExportTables,
  loadExportTables,
} from './steps/export';
import { exportItemsStep } from './steps/export-items';

/** Las tablas de WSFEX para el destino de la factura, su CUIT y la actividad, como en "Emitir factura". */
export type ExportRepeatTables = ExportTables;

/** El CUIT que ARCA publica para el destino, o `undefined` si no tiene. */
function defaultCountryCuit(country: ExportCountry, countryCuits: readonly ExportCountryCuit[]): number | undefined {
  return resolveExportClientCountryCuit({ country, countries: countryCuits });
}

/** Lo que se copia en `options` (los opcionales de la E), para que la seleccion de opcionales lo muestre. */
function optionsOf(copy: ExportInvoiceCopy['input']): ExportOptions {
  return {
    clientCountryCuit: copy.clientCountryCuit,
    incotermDescription: copy.incotermDescription,
    language: copy.language,
  };
}

/**
 * Pasos para repetir una factura E: se elige una de las ultimas y se copian cliente, destino, moneda, incoterm e
 * items (el editor arranca con ellos y el total es su suma). Las fechas son nuevas, la cotizacion es la de hoy, y se
 * preguntan los permisos de embarque y la fecha de pago, que son de cada operacion.
 */
export function exportRepeatSteps(
  session: InteractiveSession,
  gateway: Pick<
    ExportGateway,
    'getActivities' | 'getLanguages' | 'getLastVoucherNumber' | 'getQuotations' | 'getUnits' | 'getVoucher'
  >,
  tables: ExportRepeatTables,
  pointOfSale: number,
): Array<WizardStep<ExportRepeatState>> {
  const configuredActivity = session.runtime.config.exportacion?.actividad;
  const activities = activitiesLoader(gateway);
  const exchangeRate = exportExchangeRateLoader(gateway);
  const exchangeRateCase = (state: ExportRepeatState) => {
    const copy = requireStepValue(state.copy, 'copy');

    return {
      currencyCode: copy.currencyCode ?? 'DOL',
      exportType: copy.exportType ?? DEFAULT_EXPORT_TYPE,
      sameCurrency: copy.sameCurrency,
    };
  };

  return withFinalizeNotice([
    {
      name: 'factura',
      run: async (_state, { previous }) => {
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
    // Arranca en el editor con los items de la factura; el total es su suma (NAV-10). Con otra factura, los de esa.
    exportItemsStep<ExportRepeatState>({
      currency: (state) => requireStepValue(state.original, 'original').currencyCode,
      dependsOn: ['factura'],
      initial: (state) => copyExportItems(requireStepValue(state.original, 'original')).items,
      items: fieldLens('items'),
      units: () => gateway.getUnits(),
      voucher: formatVoucherWithArticle(EXPORT_VOUCHER_KIND),
    }),
    {
      // Es sobre la moneda de la factura elegida.
      dependsOn: ['factura'],
      name: 'misma-moneda',
      // FEXGetCMP casi siempre trae `CanMisMonExt`; si no, se pregunta como en "Emitir factura".
      run: async (state, { previous }) => {
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
    // La de la factura no sirve (es de otro dia): arranca con la de aduana de ARCA, como en "Emitir factura" (NAV-9).
    exportExchangeRateStep<ExportRepeatState>({
      dependsOn: ['factura', 'misma-moneda'],
      exchangeRate: fieldLens('exchangeRate'),
      rules: (state) => exportRepeatRuleScope(state, { configuredActivity, today: formatDateAsArcaDate(new Date()) }),
      suggestion: (state) => exchangeRate({ ...exchangeRateCase(state), voucherDate: state.options?.voucherDate }),
      voucher: exchangeRateCase,
    }),
    {
      // La factura no trae CUIT del pais y ARCA no publica uno para el destino: sin esto ARCA la rechaza.
      name: 'cuit-pais',
      run: async (state, { previous }) => {
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
    // La factura no trae actividad y tampoco esta en la config. Con la misma tabla que "Emitir factura" (REV-74, #11).
    activityStep<ExportRepeatState>({
      activities,
      activity: nestedLens('copy', 'activity', (state) => requireStepValue(state.copy, 'copy')),
      skip: (state) => state.copy?.activity !== undefined || configuredActivity !== undefined,
    }),
    exportOptionalsStep<ExportRepeatState>({
      context: (state) => {
        const copy = requireStepValue(state.copy, 'copy');
        const original = requireStepValue(state.original, 'original');
        const currencyCode = copy.currencyCode ?? 'DOL';

        return {
          // Idioma, CUIT del pais y descripcion del incoterm vienen de la factura elegida: con otra, arrancan con lo
          // copiado de esa.
          copiedFrom: `${original.pointOfSale}:${original.number}`,
          countryCuit: { country: requireStepValue(state.country, 'country'), countryCuits: tables.countryCuits },
          currencyCode,
          defaultLanguage: 'Español',
          exportType: copy.exportType ?? DEFAULT_EXPORT_TYPE,
          // Sin descripcion por defecto: la copiada ya esta en las opciones y Enter la mantiene.
          incoterm: copy.incoterm ? { code: copy.incoterm } : undefined,
          languages: () => gateway.getLanguages(),
          rules: exportRepeatRuleScope(state, { configuredActivity, today: formatDateAsArcaDate(new Date()) }),
        };
      },
      name: 'opcionales',
      read: (state) => state.options ?? {},
      write: (options) => ({ options }),
    }),
    exportPaymentDateStep<ExportRepeatState>((state) => state.copy?.exportType),
  ]);
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
  const tables = await loadExportTables(gateway);
  const configured = session.runtime.config.exportacion?.actividad;
  const state = await runWizard<ExportRepeatState>(
    exportRepeatSteps(session, gateway, tables, pointOfSale),
    {},
    undefined,
    {
      // Las reglas sobre la factura final: si una falla, vuelve a la pregunta que escribe el campo.
      finalize: exportRepeatFinalize(() => ({
        configuredActivity: configured,
        today: formatDateAsArcaDate(new Date()),
      })),
    },
  );

  if (!state) {
    return BACK;
  }

  const configuredActivity = session.runtime.config.exportacion?.actividad;
  const input = buildExportRepeatInput(state, { configuredActivity });
  const authorized = await emitExportVoucher(session, gateway, input, input.activity);

  // Como en "Emitir factura": la actividad escrita a mano se ofrece guardar si ARCA la autorizo (REV-74, #11).
  await offerConfig(repeatActivityToSave(state, configuredActivity, authorized));
}
