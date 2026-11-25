import { formatVoucherWithArticle } from '../../modules/billing/voucher-names';
import { resolveExportClientCountryCuit } from '../../modules/export/export.country-cuit';
import type { ExportGateway } from '../../modules/export/export.gateway';
import { EXPORT_VOUCHER_KIND } from '../../modules/export/export.kinds';
import {
  BILLS_EXPORT_TYPE,
  DEFAULT_EXPORT_CURRENCY_CODE,
  DEFAULT_EXPORT_TYPE,
  type ExportCountry,
  type ExportCountryCuit,
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
import { offerConfig } from './save-to-config';
import { emissionStep, type InteractiveSession } from './session';
import {
  activitiesLoader,
  activityStep,
  exportExchangeRateStep,
  exportPaymentDateStep,
  exportPaymentStep,
  exportRuleEnv,
  type ExportTables,
  loadExportTables,
} from './steps/export';
import { exportItemsStep } from './steps/export-items';

/**
 * Las tablas de WSFEX para el destino de la factura, su CUIT y la actividad, como en "Emitir factura".
 *
 * @internal Exportado para los tests.
 */
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
 * preguntan como te pagan (arranca en lo de la factura), los permisos de embarque y la fecha de pago, que son de cada operacion.
 *
 * @internal Exportado para los tests.
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
  const ruleEnv = exportRuleEnv(configuredActivity);
  const activities = activitiesLoader(gateway);
  const exchangeRate = exportExchangeRateLoader(gateway);
  const exchangeRateCase = (state: ExportRepeatState) => {
    const copy = requireStepValue(state.copy, 'copy');

    return {
      currencyCode: copy.currencyCode ?? DEFAULT_EXPORT_CURRENCY_CODE,
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
    // Arranca en lo que informo la factura (`CanMisMonExt`); si FEXGetCMP no lo trae, en pesos.
    exportPaymentStep<ExportRepeatState>({
      choosesCurrency: false,
      dependsOn: ['factura'],
      sameCurrency: nestedLens('copy', 'sameCurrency', (state) => requireStepValue(state.copy, 'copy')),
      unpublished: (state, voucher) =>
        exchangeRate.unpublished({ ...voucher, voucherDate: state.options?.voucherDate }),
      voucher: exchangeRateCase,
    }),
    // La de la factura no sirve (es de otro dia): arranca con la de aduana de ARCA, como en "Emitir factura" (NAV-9).
    exportExchangeRateStep<ExportRepeatState>({
      dependsOn: ['factura', 'pago'],
      exchangeRate: fieldLens('exchangeRate'),
      rules: (state) => exportRepeatRuleScope(state, ruleEnv),
      suggestion: (state) => exchangeRate({ ...exchangeRateCase(state), voucherDate: state.options?.voucherDate }),
      unpublished: (state) =>
        exchangeRate.unpublished({ ...exchangeRateCase(state), voucherDate: state.options?.voucherDate }),
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
          `ARCA no tiene un CUIT publicado para ${country.name}. Elegí el CUIT del país o escribilo:`,
          {
            previous: previous?.options?.clientCountryCuit,
            // Un dato fiscal sin default razonable: Enter vacio no elige el primero de la tabla.
            requireChoice: 'Elegí un CUIT de la lista o escribí el número.',
          },
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
      skip: (state) => state.copy?.exportType !== BILLS_EXPORT_TYPE,
    },
    // La factura no trae actividad y tampoco esta en la config. Con la misma tabla que "Emitir factura" (REV-74, #11).
    activityStep<ExportRepeatState>({
      activities,
      activity: nestedLens('copy', 'activity', (state) => requireStepValue(state.copy, 'copy')),
      skip: (state) => state.copy?.activity !== undefined || configuredActivity !== undefined,
    }),
    // Antes de los opcionales, como en "Emitir factura" E (TUI-22).
    exportPaymentDateStep<ExportRepeatState>((state) => state.copy?.exportType),
    exportOptionalsStep<ExportRepeatState>({
      context: (state) => {
        const copy = requireStepValue(state.copy, 'copy');
        const original = requireStepValue(state.original, 'original');
        const currencyCode = copy.currencyCode ?? DEFAULT_EXPORT_CURRENCY_CODE;

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
          rules: exportRepeatRuleScope(state, ruleEnv),
        };
      },
      name: 'opcionales',
      read: (state) => state.options ?? {},
      write: (options) => ({ options }),
    }),
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
  // Esc en "¿Emitimos?" vuelve a la ultima pregunta (TUI-15).
  const emission = emissionStep<ExportRepeatState>((answered) => {
    const input = buildExportRepeatInput(answered, { configuredActivity: configured });

    return emitExportVoucher(session, gateway, input, { activity: input.activity });
  });
  const state = await runWizard<ExportRepeatState>(
    exportRepeatSteps(session, gateway, tables, pointOfSale),
    {},
    undefined,
    {
      confirm: emission.confirm,
      // Las reglas sobre la factura final: si una falla, vuelve a la pregunta que escribe el campo.
      finalize: exportRepeatFinalize(exportRuleEnv(configured)),
    },
  );

  if (!state) {
    return BACK;
  }

  // Como en "Emitir factura": la actividad escrita a mano se ofrece guardar si ARCA la autorizo (REV-74, #11).
  await offerConfig(repeatActivityToSave(state, configured, emission.authorized()));
}
