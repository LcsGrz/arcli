import { formatDateAsArcaDate } from '../../lib/dates/arca-date';
import { formatEmissionQuestion, formatVoucherWithArticle } from '../../modules/billing/billing.mappers';
import { ARCA_DOLLAR_CODE, ARCA_LOCAL_CURRENCY_CODE } from '../../modules/billing/currency-codes';
import { EXPORT_PAYMENT_TERMS_SUGGESTIONS } from '../../modules/export/export.mappers';
import { formatExportResultAsText } from '../../modules/export/export.presenter';
import { ExportService } from '../../modules/export/export.service';
import {
  BILLS_EXPORT_TYPE,
  DEFAULT_EXPORT_CURRENCY_CODE,
  DEFAULT_EXPORT_TYPE,
  EXPORT_VOUCHER_KIND,
  type ExportActivity,
  type ExportGateway,
  type ExportType,
  type ExportVoucherInput,
  OTHER_EXPORT_TYPE,
  SERVICES_EXPORT_TYPE,
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
import { systemClock } from '../../services/time/system-clock';
import { noticePanel, writeTerminalOutput } from '../../ui';
import { attachExportPdf } from '../commands/export.command.pdf';
import { withSpinner } from '../spinner';

import { askCountryCuit, askDestinationCountry, exportOptionalsStep, validateExportText } from './export-options';
import { withFinalizeNotice } from './finalize-notice';
import { exportExchangeRateLoader } from './official-exchange-rate';
import { completeIssuer } from './pdf.flow';
import { askTextStep, chooseOrTypeStep, chooseStep, isPromptCancellation } from './prompts';
import { offerConfig } from './save-to-config';
import {
  confirmEmission,
  emissionStep,
  formatEquivalentCommand,
  type InteractiveSession,
  rejectedAsBack,
} from './session';
import {
  activitiesLoader,
  activityStep,
  exportExchangeRateStep,
  exportPaymentDateStep,
  type ExportTables,
  loadExportTables,
} from './steps/export';
import { exportItemsStep } from './steps/export-items';
import { SKIP_HINT } from './text-hints';

interface ExportFlowLoaders {
  readonly activities: () => Promise<readonly ExportActivity[]>;
  /** La cotizacion de aduana con la que arranca la pregunta (`exportExchangeRateLoader`). */
  readonly exchangeRate: ReturnType<typeof exportExchangeRateLoader>;
  readonly incoterms: () => Promise<ReadonlyArray<{ readonly code: string; readonly name: string }>>;
  readonly languages: ExportGateway['getLanguages'];
  readonly units: ExportGateway['getUnits'];
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
        const country = await askDestinationCountry(tables.countries, previous?.destinationCountry);

        if (country === BACK) {
          return BACK;
        }

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
          `ARCA no tiene un CUIT publicado para ${country.name}. Elegí el CUIT del país o escribilo:`,
          {
            emptyLabel: 'Sin CUIT del país (solo ID impositivo)',
            optional: true,
            previous: previous?.options?.clientCountryCuit,
          },
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
            : 'ID impositivo del cliente en su país:',
          {
            hint: required ? undefined : SKIP_HINT,
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
            { name: 'Servicios', value: SERVICES_EXPORT_TYPE },
            {
              description: 'Lleva incoterm y, si los hay, permisos de embarque',
              name: 'Bienes',
              value: BILLS_EXPORT_TYPE,
            },
            { name: 'Otros', value: OTHER_EXPORT_TYPE },
          ],
          previous?.exportType ?? DEFAULT_EXPORT_TYPE,
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
        const currencyCode = await chooseStep<typeof ARCA_DOLLAR_CODE | typeof ARCA_LOCAL_CURRENCY_CODE>(
          '¿En qué moneda facturás?',
          [
            {
              description: 'Con la cotización de aduana que publica ARCA',
              name: 'Dólares (USD)',
              value: ARCA_DOLLAR_CODE,
            },
            { name: 'Pesos', value: ARCA_LOCAL_CURRENCY_CODE },
          ],
          previous?.currencyCode === ARCA_LOCAL_CURRENCY_CODE ? ARCA_LOCAL_CURRENCY_CODE : DEFAULT_EXPORT_CURRENCY_CODE,
        );

        return currencyCode === BACK
          ? BACK
          : { currencyCode, sameCurrency: currencyCode === ARCA_LOCAL_CURRENCY_CODE ? false : undefined };
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
      skip: (state) => state.currencyCode === ARCA_LOCAL_CURRENCY_CODE,
    },
    // Despues de la moneda, arrancando con la de aduana de ARCA, como "En pesos" en A, B y C (NAV-9).
    exportExchangeRateStep<ExportFlowState>({
      dependsOn: ['tipo', 'moneda', 'misma-moneda'],
      exchangeRate: fieldLens('exchangeRate'),
      rules: (state) => exportRuleScope(state, { configuredActivity, today: formatDateAsArcaDate(new Date()) }),
      suggestion: (state) =>
        loaders.exchangeRate({
          currencyCode: state.currencyCode ?? DEFAULT_EXPORT_CURRENCY_CODE,
          exportType: requireStepValue(state.exportType, 'exportType'),
          sameCurrency: state.sameCurrency,
          voucherDate: state.options.voucherDate,
        }),
      voucher: (state) => ({
        currencyCode: state.currencyCode ?? DEFAULT_EXPORT_CURRENCY_CODE,
        exportType: requireStepValue(state.exportType, 'exportType'),
        sameCurrency: state.sameCurrency,
      }),
    }),
    // Sin "Monto total": el total es la suma de los items, que ARCA exige (NAV-10). Los precios van en la moneda: si
    // cambia, los items se conservan y el paso avisa que hay que revisar los importes.
    exportItemsStep<ExportFlowState>({
      currency: (state) => state.currencyCode ?? DEFAULT_EXPORT_CURRENCY_CODE,
      items: fieldLens('items'),
      units: loaders.units,
      voucher: formatVoucherWithArticle(EXPORT_VOUCHER_KIND),
    }),
    {
      name: 'incoterm',
      run: async (_state, { previous }) => {
        const list = await withSpinner('Consultando incoterms...', loaders.incoterms);

        // ARCA devolvio la tabla vacia: la lista sin filas es una pregunta de texto, y va sin validar contra la tabla,
        // como la actividad (el servicio avisa).
        if (list.length === 0) {
          const typed = await chooseOrTypeStep<string>('Incoterm (ARCA no devolvió la lista), por ejemplo FOB:', [], {
            parse: (value) => value.trim().toUpperCase(),
            previous: previous?.incoterm,
            validate: (value) => (value.trim() ? true : 'El incoterm es obligatorio en la factura E de bienes.'),
          });

          return typed === BACK ? BACK : { incoterm: typed, incotermName: undefined };
        }

        // Sin "Sin incoterm": la factura de bienes lo exige (error 1640).
        const incoterm = await chooseStep(
          'Incoterm:',
          // El nombre tambien lo encuentra al escribir: "free on board" marca FOB.
          list.map((entry) => ({ keywords: entry.name, name: entry.code, value: entry.code })),
          previous?.incoterm,
        );

        return incoterm === BACK
          ? BACK
          : {
              incoterm,
              incotermName: list.find((entry) => entry.code === incoterm)?.name,
            };
      },
      skip: (state) => state.exportType !== BILLS_EXPORT_TYPE,
    },
    {
      name: 'permisos',
      run: askPermitsStep,
      skip: (state) => state.exportType !== BILLS_EXPORT_TYPE,
    },
    {
      name: 'forma-pago',
      run: async (_state, { previous }) => {
        // Sugerencias de una lista donde tambien se escribe (TUI-26): ARCA la toma como texto libre. Arranca en la de
        // por defecto, que el comando equivalente no lleva (`--forma-pago` solo si es otra).
        const answer = await chooseOrTypeStep<string>(
          'Forma de pago:',
          EXPORT_PAYMENT_TERMS_SUGGESTIONS.map((terms) => ({ label: terms, value: terms })),
          {
            help: 'Elegí una o escribí otra, de hasta 50 caracteres.',
            parse: (text) => text,
            // Texto libre: "Transferencia" va tal cual, no como "Transferencia Internacional".
            preferTyped: true,
            previous: previous?.paymentTerms,
            validate: validateExportText('paymentTerms', 'La forma de pago'),
          },
        );

        return answer === BACK ? BACK : { paymentTerms: optional(answer) };
      },
    },
    activityStep<ExportFlowState>({
      activities: loaders.activities,
      activity: fieldLens('activity'),
      skip: () => configuredActivity !== undefined,
    }),
    // Antes de los opcionales (TUI-22): la fecha del comprobante se elige despues, y `finalize` vuelve aca si la deja
    // anterior.
    exportPaymentDateStep<ExportFlowState>((state) => state.exportType),
    exportOptionalsStep<ExportFlowState>({
      context: (state) => {
        const currencyCode = state.currencyCode ?? DEFAULT_EXPORT_CURRENCY_CODE;

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
  ];
}

/**
 * Vista previa, comando equivalente, confirmacion, emision y PDF: lo mismo para la factura y las notas E. Sin
 * `activity` (las notas la toman del asociado), el comando equivalente no la repite. Devuelve si ARCA la autorizo
 * (`isAuthorized`): un rechazo no es una emision. Con Esc en "¿Emitimos?", o si la vista previa rechaza la entrada,
 * devuelve BACK sin emitir: el flujo lo corre
 * como `confirm` de `runWizard`, que vuelve a la ultima pregunta (TUI-15).
 */
export async function emitExportVoucher(
  session: InteractiveSession,
  gateway: ExportGateway,
  rawInput: ExportVoucherInput,
  activity?: number,
): Promise<typeof BACK | boolean> {
  const { runtime } = session;
  // ExportService toma el de la config: uno elegido en el asistente va en la entrada (y en el comando equivalente).
  const input: ExportVoucherInput = { ...rawInput, pointOfSale: rawInput.pointOfSale ?? session.typedPointOfSale };
  const service = new ExportService({ clock: systemClock });
  // Si la vista previa rechaza la entrada, vuelve a la ultima pregunta (TUI-15).
  const resolved = await rejectedAsBack(() =>
    withSpinner('Consultando WSFEX...', () => service.resolve(input, gateway, runtime)),
  );

  if (resolved === BACK) {
    return BACK;
  }

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

  if (emission === BACK || !emission) {
    return emission;
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
  // Esc en "¿Emitimos?" vuelve a la ultima pregunta (TUI-15).
  const emission = emissionStep<ExportFlowState>((state) => {
    const input = buildExportInput(state, { configuredActivity });

    return emitExportVoucher(session, gateway, input, input.activity);
  });
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
      confirm: emission.confirm,
      // Las reglas sobre la factura final: si una falla, vuelve a la pregunta que escribe el campo.
      finalize: exportFinalize(() => ({ configuredActivity, today: formatDateAsArcaDate(new Date()) })),
    },
  );

  if (!state) {
    return BACK;
  }

  // Guardar una actividad que no llego a ARCA (dejada sin emitir) no tiene sentido: no se sabe si la acepta.
  await offerConfig(activityToSave(state.activity, configuredActivity, emission.authorized()));
}
