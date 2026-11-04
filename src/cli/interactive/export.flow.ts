import { parseStrictInteger } from '../../lib/numbers/strict-integer';
import { ConfigService } from '../../modules/config/config.service';
import { DEFAULT_EXPORT_PAYMENT_TERMS, resolveExportDestinationCountry } from '../../modules/export/export.mappers';
import { ExportService } from '../../modules/export/export.service';
import {
  EXPORT_VOUCHER_KIND,
  type ExportCountry,
  type ExportGateway,
  type ExportType,
  type ExportVoucherInput,
} from '../../modules/export/export.types';
import { parseAmountInput } from '../../modules/interactive/amount-input';
import { buildExportEquivalentCommand } from '../../modules/interactive/export-equivalent-command';
import { BACK, runWizard, type WizardStep } from '../../modules/interactive/wizard';
import { ArcaClientFactory } from '../../services/arca/arca-client.factory';
import { ArcaExportGateway } from '../../services/arca/arca-export.gateway';
import { formatExportResultAsText, formatPdfOutcomeAsText, noticePanel, writeTerminalOutput } from '../../ui';
import { attachExportPdf } from '../commands/export.command.pdf';
import { startSpinner } from '../spinner';

import { askTextStep, chooseStep, confirm } from './prompts';
import { formatEquivalentCommand, type InteractiveSession } from './session';
import { validateAmount, validateDate } from './validators';

interface ExportFlowState {
  readonly activity?: number;
  readonly amount?: number;
  readonly clientAddress?: string;
  readonly clientName?: string;
  readonly clientTaxId?: string;
  readonly currencyCode?: 'DOL' | 'PES';
  readonly description?: string;
  readonly destinationCountry?: string;
  readonly exportType?: ExportType;
  readonly incoterm?: string;
  readonly paymentDate?: string;
  readonly paymentTerms?: string;
  readonly sameCurrency?: boolean;
  readonly voucherNumber?: number;
}

/** Lo que el asistente necesita de WSFEX antes de preguntar: paises para validar el destino y la tabla de actividades. */
interface ExportTables {
  readonly activities: ReadonlySet<number>;
  readonly countries: readonly ExportCountry[];
}

async function withSpinner<T>(text: string, run: () => Promise<T>): Promise<T> {
  const spinner = startSpinner(text);

  try {
    return await run();
  } finally {
    spinner?.stop();
  }
}

function required(label: string): (value: string) => string | true {
  return (value) => (value.trim() ? true : `${label} es obligatorio.`);
}

function optionalDate(value: string): string | true {
  return value.trim() ? validateDate(value) : true;
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

function validatePositiveInteger(label: string, allowed?: ReadonlySet<number>): (value: string) => string | true {
  return (value) => {
    const number = parseStrictInteger(value);

    if (number === undefined || number < 1) {
      return `${label} tiene que ser un número entero mayor a 0.`;
    }

    return !allowed || allowed.size === 0 || allowed.has(number)
      ? true
      : `${number} no está en la tabla de actividades de WSFEX (ARCA la rechaza con el error 2105).`;
  };
}

const optional = (value: string): string | undefined => value.trim() || undefined;

/** Pasos de la factura E; cada uno se puede deshacer con "Volver". */
function exportSteps(
  tables: ExportTables,
  configuredActivity: number | undefined,
  incoterms: () => Promise<ReadonlyArray<{ readonly code: string; readonly name: string }>>,
): Array<WizardStep<ExportFlowState>> {
  return [
    {
      name: 'cliente',
      run: async () => {
        const answer = await askTextStep('Nombre o razón social del cliente del exterior:', {
          validate: required('El cliente'),
        });

        return answer === BACK ? BACK : { clientName: answer.trim() };
      },
    },
    {
      name: 'domicilio',
      run: async () => {
        const answer = await askTextStep('Domicilio del cliente:', { validate: required('El domicilio') });

        return answer === BACK ? BACK : { clientAddress: answer.trim() };
      },
    },
    {
      name: 'pais',
      run: async () => {
        const answer = await askTextStep(
          'País de destino (nombre o código de ARCA, por ejemplo ESTADOS UNIDOS o 212):',
          {
            validate: validateCountry(tables.countries),
          },
        );

        return answer === BACK
          ? BACK
          : { destinationCountry: resolveExportDestinationCountry(answer, tables.countries).name };
      },
    },
    {
      name: 'id-impositivo',
      run: async () => {
        const answer = await askTextStep('ID impositivo del cliente en su país (Enter para omitirlo):');

        return answer === BACK ? BACK : { clientTaxId: optional(answer) };
      },
    },
    {
      name: 'tipo',
      run: async () => {
        const exportType = await chooseStep<ExportType>(
          '¿Qué exportás?',
          [
            { name: 'Servicios', value: 2 },
            { description: 'Lleva incoterm y, si los hay, permisos de embarque', name: 'Bienes', value: 1 },
            { name: 'Otros', value: 4 },
          ],
          2,
        );

        return exportType === BACK ? BACK : { exportType, incoterm: undefined };
      },
    },
    {
      name: 'monto',
      run: async () => {
        const answer = await askTextStep('Monto total:', { validate: validateAmount });

        return answer === BACK ? BACK : { amount: parseAmountInput(answer) };
      },
    },
    {
      name: 'descripcion',
      run: async () => {
        const answer = await askTextStep('Descripción del servicio o producto (Enter para "Según detalle"):');

        return answer === BACK ? BACK : { description: optional(answer) };
      },
    },
    {
      name: 'moneda',
      run: async () => {
        const currencyCode = await chooseStep<'DOL' | 'PES'>(
          '¿En qué moneda facturás?',
          [
            { description: 'Con la cotización de aduana que publica ARCA', name: 'Dólares (DOL)', value: 'DOL' },
            { name: 'Pesos (PES)', value: 'PES' },
          ],
          'DOL',
        );

        return currencyCode === BACK
          ? BACK
          : { currencyCode, sameCurrency: currencyCode === 'PES' ? false : undefined };
      },
    },
    {
      name: 'misma-moneda',
      run: async () => {
        const sameCurrency = await chooseStep('¿Te pagan en dólares?', [
          { description: 'ARCA lo registra como cancelación en la misma moneda', name: 'Sí', value: true },
          { name: 'No, en pesos', value: false },
        ]);

        return sameCurrency === BACK ? BACK : { sameCurrency };
      },
      skip: (state) => state.currencyCode === 'PES',
    },
    {
      name: 'incoterm',
      run: async () => {
        const list = await withSpinner('Consultando incoterms...', incoterms);
        const incoterm = await chooseStep('Incoterm:', [
          { name: 'Sin incoterm', value: '' },
          ...list.map((entry) => ({ name: entry.code, value: entry.code })),
        ]);

        return incoterm === BACK ? BACK : { incoterm: incoterm || undefined };
      },
      skip: (state) => state.exportType !== 1,
    },
    {
      name: 'forma-pago',
      run: async () => {
        const answer = await askTextStep('Forma de pago:', { defaultValue: DEFAULT_EXPORT_PAYMENT_TERMS });

        return answer === BACK ? BACK : { paymentTerms: optional(answer) };
      },
    },
    {
      name: 'fecha-pago',
      run: async () => {
        const answer = await askTextStep('Fecha de pago (Enter para la fecha del comprobante):', {
          validate: optionalDate,
        });

        return answer === BACK ? BACK : { paymentDate: optional(answer) };
      },
    },
    {
      name: 'actividad',
      run: async () => {
        const answer = await askTextStep('Código de actividad de WSFEX (por ejemplo 620100):', {
          validate: validatePositiveInteger('La actividad', tables.activities),
        });

        return answer === BACK ? BACK : { activity: parseStrictInteger(answer) };
      },
      skip: () => configuredActivity !== undefined,
    },
    {
      name: 'numero',
      run: async () => {
        const answer = await askTextStep(
          'Número del comprobante (el siguiente al último E de este punto de venta; 1 si es el primero):',
          { validate: validatePositiveInteger('El número') },
        );

        return answer === BACK ? BACK : { voucherNumber: parseStrictInteger(answer) };
      },
    },
  ];
}

/** Ofrece guardar la actividad que se escribio a mano, para no volver a preguntarla. */
async function offerSavingActivity(activity: number): Promise<void> {
  if (!(await confirm(`¿Guardamos la actividad ${activity} en la config para la próxima?`, 'Sí, guardar', 'No'))) {
    return;
  }

  const service = new ConfigService();

  try {
    service.setValue('exportacion.actividad', String(activity));
  } finally {
    service.close();
  }
}

async function emit(
  session: InteractiveSession,
  gateway: ExportGateway,
  input: ExportVoucherInput,
  activity: number,
): Promise<void> {
  const { runtime } = session;
  const service = new ExportService();
  const resolved = await withSpinner('Consultando WSFEX...', () => service.resolve(input, gateway, runtime));
  const preview = service.preview(resolved, runtime, resolved.warnings);

  writeTerminalOutput(formatExportResultAsText(preview, { environment: runtime.environment, raw: false }));
  writeTerminalOutput(
    formatEquivalentCommand(buildExportEquivalentCommand(input, { activity, environment: runtime.environment })),
  );

  const label = EXPORT_VOUCHER_KIND.displayName;
  const environmentLabel = runtime.environment === 'produccion' ? 'PRODUCCIÓN' : 'testing';

  if (!(await confirm(`¿Emitimos la ${label} en ${environmentLabel}?`, 'Emitir ahora'))) {
    writeTerminalOutput(noticePanel('No se emitió nada.', 'muted'));

    return;
  }

  if (
    runtime.environment === 'produccion' &&
    !(await confirm('Vas a emitir un comprobante real en PRODUCCIÓN. ¿Confirmás?', 'Sí, emitir en producción'))
  ) {
    writeTerminalOutput(noticePanel('No se emitió nada.', 'muted'));

    return;
  }

  const result = await withSpinner(`Emitiendo ${label} en ARCA...`, () =>
    service.execute({ gateway, resolved, runtime, warnings: resolved.warnings }),
  );

  writeTerminalOutput(
    formatExportResultAsText(result, { environment: runtime.environment, previewShown: true, raw: false }),
  );

  const withPdf = await attachExportPdf(result, { config: runtime.config, input, interactive: true });

  if (withPdf.pdf) {
    writeTerminalOutput(formatPdfOutcomeAsText(withPdf.pdf));
  }
}

/**
 * Factura E paso a paso. Usa ExportService igual que `arcli fe`, asi que valida y emite exactamente lo mismo.
 * Devuelve BACK si se vuelve desde el primer paso, para volver al selector de comprobantes.
 */
export async function runExportFlow(session: InteractiveSession): Promise<typeof BACK | void> {
  const { config } = session.runtime;
  const gateway = new ArcaExportGateway(new ArcaClientFactory().createForExport(session.runtime));
  const tables = await withSpinner('Consultando las tablas de WSFEX...', async () => ({
    activities: new Set((await gateway.getActivities()).map((activity) => activity.id)),
    countries: await gateway.getDestinationCountries(),
  }));
  const configuredActivity = config.exportacion?.actividad;
  const state = await runWizard(
    exportSteps(tables, configuredActivity, () => gateway.getIncoterms()),
    {},
  );

  if (!state) {
    return BACK;
  }

  const activity = (state.activity ?? configuredActivity) as number;
  const input: ExportVoucherInput = {
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
    sameCurrency: state.sameCurrency,
    voucherNumber: state.voucherNumber,
  };

  await emit(session, gateway, input, activity);

  if (state.activity !== undefined && configuredActivity === undefined) {
    await offerSavingActivity(state.activity);
  }
}
