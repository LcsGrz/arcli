import { join } from 'node:path';

import type { BillingCommandInput } from '../../modules/billing/billing.schemas';
import type { BillingExecutionResult } from '../../modules/billing/billing.types.internal';
import type { ArcliConfig } from '../../modules/config/config.schemas';
import { ConfigService } from '../../modules/config/config.service';
import { PDF_INSTALL_SUGGESTION, PdfError } from '../../modules/pdf/pdf.errors';
import type { PdfOutcome } from '../../modules/pdf/pdf.types';
import { canHavePdf, type PdfDecision, resolvePdfDecision } from '../../modules/pdf/pdf-decision';
import { resolvePdfIssuer } from '../../modules/pdf/pdf-issuer';
import { exportBillingPdf, toPdfFailure } from '../../services/pdf/pdf-exporter';
import { PdfPlugin, type PdfRenderer } from '../../services/pdf/pdf-plugin';
import { confirm, isPromptCancellation } from '../interactive/prompts';
import { startSpinner } from '../spinner';

/** @internal Exportado para los tests. */
export const PDF_ONLY_FLAGS_WARNING =
  '`--descripcion`, `--condicion-venta`, `--receptor-nombre` y `--receptor-domicilio` solo se usan en el PDF; no se generó ninguno.';

export interface PdfStepDependencies {
  readonly confirm: (message: string, yesLabel: string, noLabel?: string) => Promise<boolean>;
  readonly createPlugin: (config: ArcliConfig) => PdfPlugin;
  readonly resolveFolder: (config: ArcliConfig) => string;
}

export const defaultPdfStepDependencies: PdfStepDependencies = {
  confirm: (message, yesLabel, noLabel) => confirm(message, yesLabel, noLabel),
  createPlugin: (config) => {
    const service = new ConfigService();

    try {
      return new PdfPlugin({ configuredBrowser: config.pdfNavegador, path: join(service.getPluginsPath(), 'pdf') });
    } finally {
      service.close();
    }
  },
  resolveFolder: (config) => {
    const service = new ConfigService();

    try {
      return service.resolvePdfFolder(config);
    } finally {
      service.close();
    }
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

function resolveSaleCondition(input: BillingCommandInput | undefined, config: ArcliConfig): string | undefined {
  if (input?.saleCondition === null) {
    return undefined;
  }

  return input?.saleCondition ?? config.condicionVenta;
}

async function resolveDecisions(options: PdfStepOptions, deps: PdfStepDependencies): Promise<PdfDecision[]> {
  const decisions = options.results.map((result, index) =>
    canHavePdf(result)
      ? resolvePdfDecision({
          flag: options.inputs[index]?.pdf,
          interactive: options.interactive,
          mode: options.config.pdf,
        })
      : 'omitir',
  );
  const pending = decisions.filter((decision) => decision === 'preguntar').length;

  if (pending === 0) {
    return decisions;
  }

  const answer = await deps.confirm(
    pending === 1 ? '¿Generamos el PDF del comprobante?' : `¿Generamos los PDFs de los ${pending} comprobantes?`,
    pending === 1 ? 'Sí, generar el PDF' : 'Sí, generar los PDFs',
    'No',
  );

  return decisions.map((decision) => (decision === 'preguntar' ? (answer ? 'generar' : 'omitir') : decision));
}

/** Si falta el plugin, en una terminal se ofrece instalarlo; sin terminal nunca se descarga solo. */
export async function loadPdfRenderer(
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

    const spinner = startSpinner('Instalando el plugin de PDF...');

    try {
      await plugin.install((message) => {
        if (spinner) {
          spinner.text = message;
        }
      });
    } finally {
      spinner?.stop();
    }
  }

  return plugin.load();
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
  const decisions = await resolveDecisions(options, deps);
  const targets = decisions.flatMap((decision, index) => (decision === 'generar' ? [index] : []));
  const outcomes = new Map<number, PdfOutcome>();

  if (targets.length > 0) {
    try {
      // Antes de descargar nada: sin los datos del emisor no se puede armar ningun PDF.
      resolvePdfIssuer(options.config, options.results[targets[0]].voucherKind.letter);

      const renderer = await loadPdfRenderer(deps.createPlugin(options.config), options.interactive, deps);
      const folder = deps.resolveFolder(options.config);

      for (const index of targets) {
        const spinner = startSpinner('Generando PDF...');

        try {
          const input = options.inputs[index];
          const path = await exportBillingPdf({
            config: options.config,
            extras: {
              condicionVenta: resolveSaleCondition(input, options.config),
              descripcion: input?.pdfDescription,
              receptorDomicilio: input?.receiverAddress,
              receptorNombre: input?.receiverName,
            },
            folder,
            renderer,
            result: options.results[index],
          });

          outcomes.set(index, { path });
        } catch (error) {
          outcomes.set(index, toPdfFailure(error));
        } finally {
          spinner?.stop();
        }
      }
    } catch (error) {
      for (const index of targets) {
        outcomes.set(index, toPdfFailure(error));
      }
    }
  }

  return options.results.map((result, index) => {
    const pdf = outcomes.get(index);

    if (pdf) {
      return { ...result, pdf };
    }

    // Avisa que esos datos no quedaron en ningun lado: ARCA no los recibe.
    const warning = canHavePdf(result) ? pdfOnlyDataWarning(options.inputs[index]) : undefined;

    if (warning) {
      return { ...result, warnings: [...(result.warnings ?? []), warning] };
    }

    return result;
  });
}
