import { join } from 'node:path';

import type { BillingCommandInput } from '../../modules/billing/billing.schemas';
import type { BillingExecutionResult } from '../../modules/billing/billing.types.internal';
import type { ArcliConfig } from '../../modules/config/config.schemas';
import { interruptedPdfError, PDF_INSTALL_SUGGESTION, PdfError } from '../../modules/pdf/pdf.errors';
import { answerPdfDecisions, canHavePdf, decidePdfs, type PdfDecision } from '../../modules/pdf/pdf-decision';
import { billingPdfVoucher, generatePdfs, type PdfExporter } from '../../modules/pdf/pdf-generation';
import { createPdfFileExporter } from '../../services/pdf/pdf-file-exporter';
import { PdfPlugin, type PdfRenderer } from '../../services/pdf/pdf-plugin';
import { withConfigService } from '../config-service';
import { confirm, isPromptCancellation } from '../interactive/prompts';
import type { DeliveryInterruption } from '../interruption';
import { startSpinner } from '../spinner';

/** @internal Exportado para los tests. */
export const PDF_ONLY_FLAGS_WARNING =
  '`--descripcion`, `--condicion-venta`, `--receptor-nombre` y `--receptor-domicilio` solo se usan en el PDF; no se generó ninguno.';

export interface PdfStepDependencies {
  readonly confirm: (message: string, yesLabel: string, noLabel?: string) => Promise<boolean>;
  readonly createPlugin: (config: ArcliConfig) => PdfPlugin;
  /** Una señal deja de esperar el PDF. Sin esto (el asistente), corta como siempre. */
  readonly interruption?: DeliveryInterruption;
  readonly resolveFolder: (config: ArcliConfig) => string;
}

export const defaultPdfStepDependencies: PdfStepDependencies = {
  confirm: (message, yesLabel, noLabel) => confirm(message, yesLabel, noLabel),
  createPlugin: (config) => {
    return withConfigService((service) => {
      return new PdfPlugin({ configuredBrowser: config.pdfNavegador, path: join(service.getPluginsPath(), 'pdf') });
    });
  },
  resolveFolder: (config) => {
    return withConfigService((service) => {
      return service.resolvePdfFolder(config);
    });
  },
};

/** El comprobante ya se emitio: Ctrl+C en una pregunta del PDF es "No", no un error del comando. */
export function withCancellationAsNo(deps: PdfStepDependencies): PdfStepDependencies {
  return {
    ...deps,
    confirm: async (...args) => {
      try {
        return await deps.confirm(...args);
      } catch (error) {
        if (isPromptCancellation(error)) {
          return false;
        }

        throw error;
      }
    },
  };
}

/** Los de siempre, con las señales atajadas salvo en las preguntas. Ya cortado no se pregunta: es "No". */
export function interruptiblePdfSteps(interruption: DeliveryInterruption): PdfStepDependencies {
  const deps = defaultPdfStepDependencies;

  return {
    ...deps,
    confirm: async (...args) => (await interruption.whileAsking(() => deps.confirm(...args))) ?? false,
    interruption,
  };
}

/** Se esta cortando por una señal: no se pregunta ni se genera, y cada PDF elegido sale como no generado. */
export function withoutGeneratingPdfs(deps: PdfStepDependencies): PdfStepDependencies {
  return {
    ...deps,
    confirm: async () => false,
    createPlugin: () => {
      throw interruptedPdfError();
    },
  };
}

export interface PdfStepOptions {
  readonly config: ArcliConfig;
  /** Alineados con `results`. */
  readonly inputs: readonly BillingCommandInput[];
  /** Hay alguien para responder preguntas: terminal interactiva y sin --json. */
  readonly interactive: boolean;
  readonly results: readonly BillingExecutionResult[];
}

type PdfOnlyField = 'pdfDescription' | 'receiverAddress' | 'receiverName' | 'saleCondition';

/** Cada dato que solo va en el PDF, con su flag y su clave del JSON de `--cargar`, en el orden del aviso. */
const PDF_ONLY_FIELDS: ReadonlyArray<{ readonly field: PdfOnlyField; readonly flag: string; readonly key: string }> = [
  { field: 'pdfDescription', flag: '--descripcion', key: 'descripcion' },
  { field: 'saleCondition', flag: '--condicion-venta', key: 'condicionVenta' },
  { field: 'receiverName', flag: '--receptor-nombre', key: 'receptorNombre' },
  { field: 'receiverAddress', flag: '--receptor-domicilio', key: 'receptorDomicilio' },
];

/** Datos que solo van en el PDF y pasó quien factura; lo que completó el padrón no cuenta. */
function pdfOnlyFields(input: BillingCommandInput | undefined): PdfOnlyField[] {
  const fromPadron = input?.receiverFromPadron ?? [];

  return PDF_ONLY_FIELDS.flatMap(({ field }) => {
    const passed =
      field === 'receiverName'
        ? Boolean(input?.receiverName) && !fromPadron.includes('name')
        : field === 'receiverAddress'
          ? Boolean(input?.receiverAddress) && !fromPadron.includes('address')
          : Boolean(input?.[field]);

    return passed ? [field] : [];
  });
}

function joinWithAnd(parts: readonly string[]): string {
  return parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} y ${parts.at(-1)}`;
}

/**
 * El aviso de los datos que solo van en el PDF cuando no se generó ninguno. Con flags es el de siempre; si alguno
 * vino del JSON de `--cargar`, nombra esas claves y no los flags.
 *
 * @internal Exportado para los tests.
 */
export function pdfOnlyDataWarning(input: BillingCommandInput | undefined): string | undefined {
  const fields = pdfOnlyFields(input);
  const fromFile = fields.filter((field) => input?.fromFile?.includes(field));

  if (fields.length === 0) {
    return undefined;
  }

  if (fromFile.length === 0) {
    return PDF_ONLY_FLAGS_WARNING;
  }

  const flags = PDF_ONLY_FIELDS.filter(({ field }) => fields.includes(field) && !fromFile.includes(field)).map(
    ({ flag }) => `\`${flag}\``,
  );
  const keys = PDF_ONLY_FIELDS.filter(({ field }) => fromFile.includes(field)).map(({ key }) => `"${key}"`);
  const keysLabel = `${keys.length === 1 ? 'la clave' : 'las claves'} ${joinWithAnd(keys)} del JSON de \`--cargar\``;
  const subject = flags.length > 0 ? `${joinWithAnd(flags)} y ${keysLabel}` : keysLabel;

  const verb = fields.length === 1 ? 'se usa' : 'se usan';

  return `${subject[0]?.toUpperCase() ?? ''}${subject.slice(1)} solo ${verb} en el PDF; no se generó ninguno.`;
}

/** La pregunta del PDF, una sola para todos los que hay que preguntar. */
export async function confirmPdfs(
  decisions: readonly PdfDecision[],
  deps: PdfStepDependencies,
): Promise<ReturnType<typeof answerPdfDecisions>> {
  const pending = decisions.filter((decision) => decision === 'preguntar').length;

  if (pending === 0) {
    return answerPdfDecisions(decisions, false);
  }

  const accepted = await deps.confirm(
    pending === 1 ? '¿Generamos el PDF del comprobante?' : `¿Generamos los PDFs de los ${pending} comprobantes?`,
    pending === 1 ? 'Sí, generar el PDF' : 'Sí, generar los PDFs',
    'No',
  );

  return answerPdfDecisions(decisions, accepted);
}

/** Gira mientras dura `run`; al cortar se detiene enseguida, antes de que se escriba nada. */
async function withPdfSpinner<T>(
  text: string,
  deps: PdfStepDependencies,
  run: (spinner: ReturnType<typeof startSpinner>) => Promise<T>,
): Promise<T> {
  const spinner = startSpinner(text);
  const signal = deps.interruption?.signal;
  const stop = () => spinner?.stop();

  signal?.addEventListener('abort', stop, { once: true });

  try {
    return await run(spinner);
  } finally {
    signal?.removeEventListener('abort', stop);
    stop();
  }
}

/** Si falta el plugin, en una terminal se ofrece instalarlo; sin terminal nunca se descarga solo. */
async function loadPdfRenderer(
  plugin: PdfPlugin,
  interactive: boolean,
  deps: PdfStepDependencies,
): Promise<PdfRenderer> {
  if (!plugin.getStatus().installed && interactive) {
    const install = await deps.confirm(
      'Para generar PDFs hay que descargar un componente (~160 MB, o ~360 MB si no tenés Chrome). ¿Instalarlo ahora?',
      'Sí, instalar',
      'No',
    );

    if (!install) {
      throw new PdfError('PDF_PLUGIN_MISSING', 'No se instaló el plugin de PDF.', {
        suggestion: PDF_INSTALL_SUGGESTION,
      });
    }

    await withPdfSpinner('Instalando el plugin de PDF...', deps, (spinner) =>
      plugin.install((message) => {
        if (spinner) {
          spinner.text = message;
        }
      }, deps.interruption?.signal),
    );

    if (deps.interruption?.signal.aborted) {
      throw interruptedPdfError();
    }
  }

  return plugin.load();
}

function withSpinner(exporter: PdfExporter, deps: PdfStepDependencies): PdfExporter {
  return { export: (...args) => withPdfSpinner('Generando PDF...', deps, () => exporter.export(...args)) };
}

/** El plugin cargado, con la carpeta de la config: el exportador que usa `generatePdfs`, con un spinner por PDF. */
export async function loadPdfExporter(
  config: ArcliConfig,
  interactive: boolean,
  deps: PdfStepDependencies,
): Promise<PdfExporter> {
  const renderer = await loadPdfRenderer(deps.createPlugin(config), interactive, deps);

  return withSpinner(
    createPdfFileExporter({ folder: deps.resolveFolder(config), renderer, signal: deps.interruption?.signal }),
    deps,
  );
}

/**
 * Genera los PDFs de los comprobantes emitidos. Nunca lanza: el comprobante ya esta emitido, asi que un
 * error del PDF se devuelve en `pdf.error` y no cambia el codigo de salida.
 */
export async function attachPdfs(
  options: PdfStepOptions,
  defaultDeps: PdfStepDependencies = defaultPdfStepDependencies,
): Promise<BillingExecutionResult[]> {
  const deps = withCancellationAsNo(defaultDeps);
  const { config, inputs, interactive, results } = options;
  const decisions = await confirmPdfs(
    decidePdfs({
      interactive,
      mode: config.pdf,
      vouchers: results.map((result, index) => ({ flag: inputs[index]?.pdf, result })),
    }),
    deps,
  );
  const targets = decisions.flatMap((decision, index) => (decision === 'generar' ? [index] : []));
  const outcomes = await generatePdfs({
    config,
    loadExporter: () => loadPdfExporter(config, interactive, deps),
    signal: deps.interruption?.signal,
    vouchers: targets.map((index) => billingPdfVoucher(results[index], inputs[index], config)),
  });

  return results.map((result, index) => {
    const pdf = outcomes[targets.indexOf(index)];

    if (pdf) {
      return { ...result, pdf };
    }

    // Avisa que esos datos no quedaron en ningun lado: ARCA no los recibe.
    const warning = canHavePdf(result) ? pdfOnlyDataWarning(inputs[index]) : undefined;

    if (warning) {
      return { ...result, warnings: [...(result.warnings ?? []), warning] };
    }

    return result;
  });
}
