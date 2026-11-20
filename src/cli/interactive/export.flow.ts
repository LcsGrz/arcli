import { formatDateAsArcaDate } from '../../lib/dates/arca-date';
import { formatEmissionQuestion, formatVoucherWithArticle } from '../../modules/billing/billing.mappers';
import { DEFAULT_EXPORT_PAYMENT_TERMS, resolveExportDestinationCountry } from '../../modules/export/export.mappers';
import { formatExportResultAsText } from '../../modules/export/export.presenter';
import { ExportService } from '../../modules/export/export.service';
import {
  EXPORT_VOUCHER_KIND,
  type ExportActivity,
  type ExportCountry,
  type ExportGateway,
  type ExportType,
  type ExportVoucherInput,
} from '../../modules/export/export.types';
import { buildExportEquivalentCommand } from '../../modules/interactive/export-equivalent-command';
import {
  buildExportInput,
  exportFinalize,
  type ExportFlowState,
  exportRuleScope,
} from '../../modules/interactive/export-input';
import { isCountryCuitMissing } from '../../modules/interactive/export-optionals';
import { activityToSave, isAuthorized } from '../../modules/interactive/steps/config-offer';
import { fieldLens } from '../../modules/interactive/steps/lens';
import { BACK, requireStepValue, runWizard, type WizardStep } from '../../modules/interactive/wizard';
import { formatPdfOutcomeAsText } from '../../modules/pdf/pdf.presenter';
import { planEmissionConfirmation, resolvePdfAfterConfirmation } from '../../modules/pdf/pdf-decision';
import { ArcaClientFactory } from '../../services/arca/arca-client.factory';
import { noticePanel, writeTerminalOutput } from '../../ui';
import { attachExportPdf } from '../commands/export.command.pdf';
import { withSpinner } from '../spinner';

import { askCountryCuit, exportOptionalsStep, validateExportText } from './export-options';
import { withFinalizeNotice } from './finalize-notice';
import { exportExchangeRateLoader } from './official-exchange-rate';
import { completeIssuer } from './pdf.flow';
import { askTextStep, chooseStep, isPromptCancellation } from './prompts';
import { offerConfig } from './save-to-config';
import { confirmEmission, formatEquivalentCommand, type InteractiveSession } from './session';
import {
  activitiesLoader,
  activityStep,
  exportExchangeRateStep,
  exportPaymentDateStep,
  type ExportTables,
  loadExportTables,
} from './steps/export';
import { exportItemsStep } from './steps/export-items';

interface ExportFlowLoaders {
  readonly activities: () => Promise<readonly ExportActivity[]>;
  /** La cotizacion de aduana con la que arranca la pregunta (`exportExchangeRateLoader`). */
  readonly exchangeRate: ReturnType<typeof exportExchangeRateLoader>;
  readonly incoterms: () => Promise<ReadonlyArray<{ readonly code: string; readonly name: string }>>;
  readonly languages: ExportGateway['getLanguages'];
  readonly units: ExportGateway['getUnits'];
}

function validateCountry(countries: readonly ExportCountry[]): (value: string) => string | true {
  return (value) => {
    try {
      resolveExportDestinationCountry(value, countries);

      return true;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  };
}

const optional = (value: string): string | undefined => value.trim() || undefined;

/**
 * Permisos de embarque de una E de bienes, separados por coma o espacio. Vacio, ninguno. arcli no da de alta
 * permisos: los que se informan ya existen en ARCA (en la factura van con `--permiso-existente`).
 */
export async function askPermitsStep(
  _state: unknown,
  { previous }: { readonly previous?: { readonly permits?: readonly string[] } | undefined },
): Promise<typeof BACK | { readonly permits: readonly string[] | undefined }> {
  const answer = await askTextStep('Permisos de embarque ya existentes, separados por coma (Enter si no hay):', {
    previousAnswer: previous?.permits?.join(', '),
  });

  if (answer === BACK) {
    return BACK;
  }

  const permits = answer.split(/[\s,]+/).filter(Boolean);

  return { permits: permits.length > 0 ? permits : undefined };
}

/** Pasos de la factura E; cada uno se puede deshacer con "Volver". */
function exportSteps(
  tables: ExportTables,
  configuredActivity: number | undefined,
  loaders: ExportFlowLoaders,
): Array<WizardStep<ExportFlowState>> {
  return [
    {
      name: 'cliente',
      run: async (_state, { previous }) => {
        const answer = await askTextStep('Nombre o razón social del cliente del exterior:', {
          previousAnswer: previous?.clientName,
          validate: validateExportText('clientName', 'El cliente'),
        });

        return answer === BACK ? BACK : { clientName: answer.trim() };
      },
    },
    {
      name: 'domicilio',
      run: async (_state, { previous }) => {
        const answer = await askTextStep('Domicilio del cliente:', {
          previousAnswer: previous?.clientAddress,
          validate: validateExportText('clientAddress', 'El domicilio'),
        });

        return answer === BACK ? BACK : { clientAddress: answer.trim() };
      },
    },
    {
      name: 'pais',
      run: async (_state, { previous }) => {
        const answer = await askTextStep(
          'País de destino (nombre o código de ARCA, por ejemplo ESTADOS UNIDOS o 212):',
          {
            previousAnswer: previous?.destinationCountry,
            validate: validateCountry(tables.countries),
          },
        );

        if (answer === BACK) {
          return BACK;
        }

        const country = resolveExportDestinationCountry(answer, tables.countries);

        return {
          country,
          countryCuitMissing: isCountryCuitMissing({ country, countryCuits: tables.countryCuits }),
          destinationCountry: country.name,
        };
      },
    },
    {
      // ARCA pide el CUIT del pais o el ID impositivo (error 1580): si se deja vacio, el ID impositivo es obligatorio.
      name: 'cuit-pais',
      run: async (state, { previous }) => {
        const country = requireStepValue(state.country, 'country');
        // Al volver arranca escrito, si es del destino (REV-74, #10).
        const cuit = await askCountryCuit(
          { country, countryCuits: tables.countryCuits },
          `ARCA no tiene un CUIT publicado para ${country.name}. Escribí el CUIT del país, buscalo por nombre o dejalo vacío para informar solo el ID impositivo del cliente:`,
          { optional: true, previous: previous?.options?.clientCountryCuit },
        );

        return cuit === BACK ? BACK : { options: { ...state.options, clientCountryCuit: cuit } };
      },
      skip: (state) => !state.countryCuitMissing,
    },
    {
      // Sin CUIT del pais es obligatorio: depende de si falta y de si se escribio, no del pais en si.
      dependsOn: [
        { fields: ['countryCuitMissing'], step: 'pais' },
        { fields: ['options.clientCountryCuit'], step: 'cuit-pais' },
      ],
      name: 'id-impositivo',
      run: async (state, { previous }) => {
        // Sin CUIT del pais, ARCA pide el ID impositivo (error 1580).
        const required = state.countryCuitMissing && state.options.clientCountryCuit === undefined;
        const answer = await askTextStep(
          required
            ? 'ID impositivo del cliente en su país (sin CUIT del país, ARCA lo pide):'
            : 'ID impositivo del cliente en su país (Enter para omitirlo):',
          {
            previousAnswer: previous?.clientTaxId,
            validate: validateExportText('clientTaxId', required ? 'El ID impositivo' : undefined),
          },
        );

        return answer === BACK ? BACK : { clientTaxId: optional(answer) };
      },
    },
    {
      name: 'tipo',
      run: async (_state, { previous }) => {
        const exportType = await chooseStep<ExportType>(
          '¿Qué exportás?',
          [
            { name: 'Servicios', value: 2 },
            { description: 'Lleva incoterm y, si los hay, permisos de embarque', name: 'Bienes', value: 1 },
            { name: 'Otros', value: 4 },
          ],
          previous?.exportType ?? 2,
        );

        // La fecha de pago solo va en servicios y otros: si se vuelve y se elige bienes, no queda la anterior.
        return exportType === BACK ? BACK : { exportType, incoterm: undefined, paymentDate: undefined };
      },
    },
    // La moneda antes del monto: la pregunta del monto la nombra (REV-74, #12) y, si cambia, el monto se vuelve a
    // escribir.
    {
      name: 'moneda',
      run: async (_state, { previous }) => {
        const currencyCode = await chooseStep<'DOL' | 'PES'>(
          '¿En qué moneda facturás?',
          [
            { description: 'Con la cotización de aduana que publica ARCA', name: 'Dólares (USD)', value: 'DOL' },
            { name: 'Pesos', value: 'PES' },
          ],
          previous?.currencyCode === 'PES' ? 'PES' : 'DOL',
        );

        return currencyCode === BACK
          ? BACK
          : { currencyCode, sameCurrency: currencyCode === 'PES' ? false : undefined };
      },
    },
    {
      name: 'misma-moneda',
      run: async (_state, { previous }) => {
        const sameCurrency = await chooseStep(
          '¿Te pagan en dólares?',
          [
            { description: 'ARCA lo registra como cancelación en la misma moneda', name: 'Sí', value: true },
            { name: 'No, en pesos', value: false },
          ],
          previous?.sameCurrency,
        );

        return sameCurrency === BACK ? BACK : { sameCurrency };
      },
      skip: (state) => state.currencyCode === 'PES',
    },
    // Despues de la moneda, arrancando con la de aduana de ARCA, como "En pesos" en A, B y C (NAV-9).
    exportExchangeRateStep<ExportFlowState>({
      dependsOn: ['tipo', 'moneda', 'misma-moneda'],
      exchangeRate: fieldLens('exchangeRate'),
      rules: (state) => exportRuleScope(state, { configuredActivity, today: formatDateAsArcaDate(new Date()) }),
      suggestion: (state) =>
        loaders.exchangeRate({
          currencyCode: state.currencyCode ?? 'DOL',
          exportType: requireStepValue(state.exportType, 'exportType'),
          sameCurrency: state.sameCurrency,
          voucherDate: state.options.voucherDate,
        }),
      voucher: (state) => ({
        currencyCode: state.currencyCode ?? 'DOL',
        exportType: requireStepValue(state.exportType, 'exportType'),
        sameCurrency: state.sameCurrency,
      }),
    }),
    // Sin "Monto total": el total es la suma de los items, que ARCA exige (NAV-10). Los precios van en la moneda: si
    // cambia, los items se conservan y el paso avisa que hay que revisar los importes.
    exportItemsStep<ExportFlowState>({
      currency: (state) => state.currencyCode ?? 'DOL',
      items: fieldLens('items'),
      units: loaders.units,
      voucher: formatVoucherWithArticle(EXPORT_VOUCHER_KIND),
    }),
    {
      name: 'incoterm',
      run: async (_state, { previous }) => {
        const list = await withSpinner('Consultando incoterms...', loaders.incoterms);

        // ARCA devolvio la tabla vacia: se escribe a mano y va sin validar, como la actividad (el servicio avisa).
        if (list.length === 0) {
          const typed = await askTextStep('Incoterm (ARCA no devolvió la lista), por ejemplo FOB:', {
            previousAnswer: previous?.incoterm,
            validate: (value) => (value.trim() ? true : 'El incoterm es obligatorio en la factura E de bienes.'),
          });

          return typed === BACK ? BACK : { incoterm: typed.trim().toUpperCase(), incotermName: undefined };
        }

        // Sin "Sin incoterm": la factura de bienes lo exige (error 1640).
        const incoterm = await chooseStep(
          'Incoterm:',
          list.map((entry) => ({ name: entry.code, value: entry.code })),
          previous?.incoterm,
        );

        return incoterm === BACK
          ? BACK
          : {
              incoterm,
              incotermName: list.find((entry) => entry.code === incoterm)?.name,
            };
      },
      skip: (state) => state.exportType !== 1,
    },
    {
      name: 'permisos',
      run: askPermitsStep,
      skip: (state) => state.exportType !== 1,
    },
    {
      name: 'forma-pago',
      run: async (_state, { previous }) => {
        const answer = await askTextStep('Forma de pago:', {
          defaultValue: DEFAULT_EXPORT_PAYMENT_TERMS,
          previousAnswer: previous?.paymentTerms,
          validate: validateExportText('paymentTerms'),
        });

        return answer === BACK ? BACK : { paymentTerms: optional(answer) };
      },
    },
    activityStep<ExportFlowState>({
      activities: loaders.activities,
      activity: fieldLens('activity'),
      skip: () => configuredActivity !== undefined,
    }),
    exportOptionalsStep<ExportFlowState>({
      context: (state) => {
        const currencyCode = state.currencyCode ?? 'DOL';

        return {
          countryCuit: { country: requireStepValue(state.country, 'country'), countryCuits: tables.countryCuits },
          currencyCode,
          defaultLanguage: 'Español',
          exportType: requireStepValue(state.exportType, 'exportType'),
          incoterm: state.incoterm ? { code: state.incoterm, description: state.incotermName } : undefined,
          languages: loaders.languages,
          rules: exportRuleScope(state, { configuredActivity, today: formatDateAsArcaDate(new Date()) }),
        };
      },
      name: 'opcionales',
      read: (state) => state.options,
      write: (options) => ({ options }),
    }),
    exportPaymentDateStep<ExportFlowState>((state) => state.exportType),
  ];
}

/**
 * Vista previa, comando equivalente, confirmacion, emision y PDF: lo mismo para la factura y las notas E. Sin
 * `activity` (las notas la toman del asociado), el comando equivalente no la repite. Devuelve si ARCA la autorizo
 * (`isAuthorized`): un rechazo no es una emision.
 */
export async function emitExportVoucher(
  session: InteractiveSession,
  gateway: ExportGateway,
  rawInput: ExportVoucherInput,
  activity?: number,
): Promise<boolean> {
  const { runtime } = session;
  // ExportService toma el de la config: uno elegido en el asistente va en la entrada (y en el comando equivalente).
  const input: ExportVoucherInput = { ...rawInput, pointOfSale: rawInput.pointOfSale ?? session.typedPointOfSale };
  const service = new ExportService();
  const resolved = await withSpinner('Consultando WSFEX...', () => service.resolve(input, gateway, runtime));
  const preview = service.preview(resolved, runtime, resolved.warnings);

  writeTerminalOutput(formatExportResultAsText(preview, { environment: runtime.environment, raw: false }));
  writeTerminalOutput(
    formatEquivalentCommand(buildExportEquivalentCommand(input, { activity, environment: runtime.environment })),
  );

  const label = formatVoucherWithArticle(input.voucherKind ?? EXPORT_VOUCHER_KIND);

  const emission = await confirmEmission(
    formatEmissionQuestion(label, runtime.environment),
    runtime.environment,
    planEmissionConfirmation({ flags: [input.pdf], mode: runtime.config.pdf }),
  );

  if (!emission) {
    return false;
  }

  const result = await withSpinner(`Emitiendo ${label} en ARCA...`, () =>
    service.execute({ gateway, resolved, runtime, warnings: resolved.warnings }),
  );

  writeTerminalOutput(
    formatExportResultAsText(result, { environment: runtime.environment, previewShown: true, raw: false }),
  );

  // Ya se emitio: un Ctrl+C mientras se piden los datos del emisor no puede terminar en "No se emitio nada".
  try {
    const withPdf = await attachExportPdf(result, {
      completeConfig: completeIssuer,
      config: runtime.config,
      // Lo elegido en "¿Emitimos?" decide el PDF: despues de emitir no se pregunta nada mas.
      input: { ...input, pdf: resolvePdfAfterConfirmation(input.pdf, emission) },
      interactive: true,
    });

    if (withPdf.pdf) {
      writeTerminalOutput(formatPdfOutcomeAsText(withPdf.pdf));
    }
  } catch (error) {
    if (!isPromptCancellation(error)) {
      throw error;
    }

    writeTerminalOutput(noticePanel('El comprobante ya quedó emitido; no se generó el PDF.', 'muted'));
  }

  return isAuthorized(result.response);
}

/**
 * Factura E paso a paso. Usa ExportService igual que `arcli fe`, asi que valida y emite exactamente lo mismo.
 * Devuelve BACK si se vuelve desde el primer paso, para volver al selector de comprobantes.
 */
export async function runExportFlow(session: InteractiveSession): Promise<typeof BACK | void> {
  const { config } = session.runtime;
  const gateway = new ArcaClientFactory().createExportGateway(session.runtime);
  const tables = await loadExportTables(gateway);
  const configuredActivity = config.exportacion?.actividad;
  const state = await runWizard<ExportFlowState>(
    withFinalizeNotice(
      exportSteps(tables, configuredActivity, {
        activities: activitiesLoader(gateway),
        exchangeRate: exportExchangeRateLoader(gateway),
        incoterms: () => gateway.getIncoterms(),
        languages: () => gateway.getLanguages(),
        units: () => gateway.getUnits(),
      }),
    ),
    { options: {} },
    undefined,
    {
      // Las reglas sobre la factura final: si una falla, vuelve a la pregunta que escribe el campo.
      finalize: exportFinalize(() => ({ configuredActivity, today: formatDateAsArcaDate(new Date()) })),
    },
  );

  if (!state) {
    return BACK;
  }

  const input = buildExportInput(state, { configuredActivity });

  const authorized = await emitExportVoucher(session, gateway, input, input.activity);

  // Guardar una actividad que no llego a ARCA (dejada sin emitir) no tiene sentido: no se sabe si la acepta.
  await offerConfig(activityToSave(state.activity, configuredActivity, authorized));
}
