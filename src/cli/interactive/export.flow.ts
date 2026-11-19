import { parseStrictInteger } from '../../lib/numbers/strict-integer';
import { formatEmissionQuestion, formatVoucherWithArticle } from '../../modules/billing/billing.mappers';
import { DEFAULT_EXPORT_PAYMENT_TERMS, resolveExportDestinationCountry } from '../../modules/export/export.mappers';
import { formatExportResultAsText } from '../../modules/export/export.presenter';
import { ExportService } from '../../modules/export/export.service';
import {
  EXPORT_VOUCHER_KIND,
  type ExportCountry,
  type ExportCountryCuit,
  type ExportGateway,
  type ExportType,
  type ExportVoucherInput,
} from '../../modules/export/export.types';
import { amountInputText, parseAmountInput } from '../../modules/interactive/amount-input';
import { buildExportEquivalentCommand } from '../../modules/interactive/export-equivalent-command';
import { BACK, requireStepValue, runWizard, type WizardStep } from '../../modules/interactive/wizard';
import { formatPdfOutcomeAsText } from '../../modules/pdf/pdf.presenter';
import { planEmissionConfirmation, resolvePdfAfterConfirmation } from '../../modules/pdf/pdf-decision';
import { ArcaClientFactory } from '../../services/arca/arca-client.factory';
import { noticePanel, writeTerminalOutput } from '../../ui';
import { attachExportPdf } from '../commands/export.command.pdf';
import { withSpinner } from '../spinner';

import {
  askCountryCuit,
  askExportOptions,
  type ExportOptions,
  isCountryCuitMissing,
  validateExportPaymentDate,
  validateExportText,
} from './export-options';
import { completeIssuer } from './pdf.flow';
import { askTextStep, chooseStep, isPromptCancellation } from './prompts';
import { offerSavingToConfig } from './save-to-config';
import { confirmEmission, formatEquivalentCommand, type InteractiveSession } from './session';
import { validateAmount, validatePositiveInteger } from './validators';

interface ExportFlowState {
  readonly activity?: number;
  readonly amount?: number;
  readonly clientAddress?: string;
  readonly clientName?: string;
  readonly clientTaxId?: string;
  /** El destino como esta en la tabla de ARCA, para el CUIT del pais. */
  readonly country?: ExportCountry;
  /** ARCA no publica un CUIT para el destino: hay que pedirlo (`--cuit-pais`). */
  readonly countryCuitMissing?: boolean;
  readonly currencyCode?: 'DOL' | 'PES';
  readonly description?: string;
  readonly destinationCountry?: string;
  readonly exportType?: ExportType;
  readonly incoterm?: string;
  /** Nombre del incoterm en la tabla de ARCA: la descripcion que va si no se escribe otra. */
  readonly incotermName?: string;
  readonly options: ExportOptions;
  readonly paymentDate?: string;
  readonly paymentTerms?: string;
  readonly permits?: readonly string[];
  readonly sameCurrency?: boolean;
}

/**
 * Lo que el asistente necesita de WSFEX antes de preguntar: paises para validar el destino, sus CUIT y la tabla de
 * actividades.
 */
interface ExportTables {
  readonly activities: ReadonlySet<number>;
  readonly countries: readonly ExportCountry[];
  readonly countryCuits: readonly ExportCountryCuit[];
}

interface ExportFlowLoaders {
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

/** Vacio (la E va sin actividad) o un entero positivo que, si ARCA devolvio la tabla, esta en las de WSFEX. */
function validateActivity(allowed: ReadonlySet<number>): (value: string) => string | true {
  return (value) => {
    if (!value.trim()) {
      return true;
    }

    const valid = validatePositiveInteger('La actividad')(value);
    const number = parseStrictInteger(value) as number;

    return valid !== true || allowed.size === 0 || allowed.has(number)
      ? valid
      : `${number} no está en la tabla de actividades de WSFEX (ARCA la rechaza con el error 2105).`;
  };
}

const optional = (value: string): string | undefined => value.trim() || undefined;

/**
 * Permisos de embarque de una E de bienes, separados por coma o espacio. Vacio, ninguno. arcli no da de alta
 * permisos: los que se informan ya existen en ARCA (en la factura van con `--permiso-existente`).
 */
export async function askPermitsStep(
  _state?: unknown,
  previous?: { readonly permits?: readonly string[] },
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
      run: async (_state, previous) => {
        const answer = await askTextStep('Nombre o razón social del cliente del exterior:', {
          previousAnswer: previous?.clientName,
          validate: validateExportText('clientName', 'El cliente'),
        });

        return answer === BACK ? BACK : { clientName: answer.trim() };
      },
    },
    {
      name: 'domicilio',
      run: async (_state, previous) => {
        const answer = await askTextStep('Domicilio del cliente:', {
          previousAnswer: previous?.clientAddress,
          validate: validateExportText('clientAddress', 'El domicilio'),
        });

        return answer === BACK ? BACK : { clientAddress: answer.trim() };
      },
    },
    {
      name: 'pais',
      run: async (_state, previous) => {
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
      run: async (state) => {
        const country = requireStepValue(state.country, 'country');
        const cuit = await askCountryCuit(
          { country, countryCuits: tables.countryCuits },
          `ARCA no tiene un CUIT publicado para ${country.name}. Escribí el CUIT del país, buscalo por nombre o dejalo vacío para informar solo el ID impositivo del cliente:`,
          { optional: true },
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
      run: async (state, previous) => {
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
      run: async (_state, previous) => {
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
    {
      name: 'monto',
      run: async (_state, previous) => {
        const answer = await askTextStep('Monto total:', {
          previousAnswer: amountInputText(previous?.amount),
          validate: validateAmount,
        });

        return answer === BACK ? BACK : { amount: parseAmountInput(answer) };
      },
    },
    {
      name: 'descripcion',
      run: async (_state, previous) => {
        const answer = await askTextStep('Descripción del servicio o producto (Enter para "Según detalle"):', {
          previousAnswer: previous?.description,
          validate: validateExportText('description'),
        });

        return answer === BACK ? BACK : { description: optional(answer) };
      },
    },
    {
      name: 'moneda',
      run: async (_state, previous) => {
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
      run: async (_state, previous) => {
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
    {
      name: 'incoterm',
      run: async (_state, previous) => {
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
      run: async (_state, previous) => {
        const answer = await askTextStep('Forma de pago:', {
          defaultValue: DEFAULT_EXPORT_PAYMENT_TERMS,
          previousAnswer: previous?.paymentTerms,
          validate: validateExportText('paymentTerms'),
        });

        return answer === BACK ? BACK : { paymentTerms: optional(answer) };
      },
    },
    {
      name: 'actividad',
      run: async (_state, previous) => {
        // Opcional: ARCA no exige `Actividades` (la 2100 solo prohibe el bloque vacio).
        const answer = await askTextStep(
          'Código de actividad de WSFEX, por ejemplo 620100 (Enter para no informarla):',
          {
            previousAnswer: previous?.activity === undefined ? undefined : String(previous.activity),
            validate: validateActivity(tables.activities),
          },
        );

        return answer === BACK ? BACK : { activity: answer.trim() ? parseStrictInteger(answer) : undefined };
      },
      skip: () => configuredActivity !== undefined,
    },
    {
      name: 'opcionales',
      run: async (state) => {
        const country = requireStepValue(state.country, 'country');
        const currencyCode = state.currencyCode ?? 'DOL';
        const options = await askExportOptions(state.options, {
          amount: requireStepValue(state.amount, 'amount'),
          countryCuit: { country, countryCuits: tables.countryCuits },
          currencyCode,
          // En servicios y con el pago en dolares ARCA exige la suya (2053, 1604): no se ofrece otra.
          defaultExchangeRate:
            currencyCode === 'PES' || state.exportType === 2 || state.sameCurrency
              ? undefined
              : 'la de aduana que publica ARCA',
          defaultLanguage: 'Español',
          exportType: requireStepValue(state.exportType, 'exportType'),
          incoterm: state.incoterm ? { code: state.incoterm, description: state.incotermName } : undefined,
          languages: loaders.languages,
          sameCurrency: state.sameCurrency,
          units: loaders.units,
        });

        return options === BACK ? BACK : { options };
      },
    },
    {
      // Despues de los opcionales: no puede ser anterior a la fecha del comprobante, que se elige ahi (1674).
      // Solo la fecha del comprobante: cambiar otro opcional no la olvida.
      dependsOn: [{ fields: ['options.voucherDate'], step: 'opcionales' }],
      name: 'fecha-pago',
      run: async (state, previous) => {
        const answer = await askTextStep('Fecha de pago (Enter para la fecha del comprobante):', {
          previousAnswer: previous?.paymentDate,
          validate: validateExportPaymentDate(state.options.voucherDate),
        });

        return answer === BACK ? BACK : { paymentDate: optional(answer) };
      },
      // En bienes ARCA rechaza la fecha de pago (error 1673).
      skip: (state) => state.exportType === 1,
    },
  ];
}

/**
 * Vista previa, comando equivalente, confirmacion, emision y PDF: lo mismo para la factura y las notas E. Sin
 * `activity` (las notas la toman del asociado), el comando equivalente no la repite. Devuelve si se emitio.
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

  return true;
}

/**
 * Factura E paso a paso. Usa ExportService igual que `arcli fe`, asi que valida y emite exactamente lo mismo.
 * Devuelve BACK si se vuelve desde el primer paso, para volver al selector de comprobantes.
 */
export async function runExportFlow(session: InteractiveSession): Promise<typeof BACK | void> {
  const { config } = session.runtime;
  const gateway = new ArcaClientFactory().createExportGateway(session.runtime);
  const tables = await withSpinner('Consultando las tablas de WSFEX...', async () => ({
    activities: new Set((await gateway.getActivities()).map((activity) => activity.id)),
    countries: await gateway.getDestinationCountries(),
    countryCuits: await gateway.getDestinationCountryCuits(),
  }));
  const configuredActivity = config.exportacion?.actividad;
  const state = await runWizard<ExportFlowState>(
    exportSteps(tables, configuredActivity, {
      incoterms: () => gateway.getIncoterms(),
      languages: () => gateway.getLanguages(),
      units: () => gateway.getUnits(),
    }),
    { options: {} },
  );

  if (!state) {
    return BACK;
  }

  const activity = state.activity ?? configuredActivity;
  const input: ExportVoucherInput = {
    ...state.options,
    activity,
    amount: state.amount,
    clientAddress: state.clientAddress,
    clientName: state.clientName,
    clientTaxId: state.clientTaxId,
    currencyCode: state.currencyCode,
    description: state.description,
    destinationCountry: state.destinationCountry,
    emit: false,
    exportType: state.exportType,
    incoterm: state.incoterm,
    paymentDate: state.paymentDate,
    paymentTerms: state.paymentTerms,
    permits: state.permits,
    permitsExisting: state.permits ? true : undefined,
    sameCurrency: state.sameCurrency,
  };

  const emitted = await emitExportVoucher(session, gateway, input, activity);

  // Guardar una actividad que no llego a ARCA (dejada sin emitir) no tiene sentido: no se sabe si la acepta.
  if (emitted && state.activity !== undefined && configuredActivity === undefined) {
    await offerSavingToConfig(`¿Guardamos la actividad ${state.activity} en la config para la próxima?`, [
      ['exportacion.actividad', String(state.activity)],
    ]);
  }
}
