import { errorText } from '../../lib/files/file-error';
import type { BillingCommandInput } from '../../modules/billing/billing.schemas';
import type { BillingExecutionResult } from '../../modules/billing/billing.types.internal';
import {
  SALE_CONDITION_KEYS,
  SALE_CONDITION_LABELS,
  type SaleConditionKey,
} from '../../modules/billing/sale-condition';
import type { ArcliConfig } from '../../modules/config/config.schemas';
import { parseConfigValue } from '../../modules/config/config-value-parser';
import { BACK, type Back } from '../../modules/interactive/wizard';
import { decidePdfs } from '../../modules/pdf/pdf-decision';
import { listMissingIssuerKeys } from '../../modules/pdf/pdf-issuer';
import { nodeLocalFiles } from '../../services/files/local-files';
import { noticePanel, writeTerminalOutput } from '../../ui';
import { isOutputLost } from '../closed-output';
import { writePdfOutcomes } from '../commands/billing.command.output';
import { attachPdfs, interruptiblePdfSteps } from '../commands/billing.command.pdf';
import { withConfigService } from '../config-service';
import { recordFailedPdfs, recordMissingPdf } from '../emitted-vouchers';
import type { DeliveryInterruption } from '../interruption';

import { askText, chooseOrTypeStep, confirm, isPromptCancellation } from './prompts';
import { SKIP_HINT } from './text-hints';

type IssuerKey = 'cuit' | 'emisor.domicilio' | 'emisor.inicioActividades' | 'emisor.razonSocial';

const ISSUER_QUESTIONS: Record<IssuerKey, string> = {
  cuit: 'CUIT del emisor',
  'emisor.domicilio': 'Domicilio comercial del emisor',
  'emisor.inicioActividades': 'Fecha de inicio de actividades (D/MM/YYYY)',
  'emisor.razonSocial': 'Razón social o nombre del emisor',
};

/**
 * La condicion de venta del PDF, de la lista o escrita (TUI-35), con la de siempre (la del comprobante o la de la
 * config) ya marcada o escrita: Enter la mantiene. "Omitir" (`null`) deja el PDF sin condicion de venta. Esc vuelve:
 * no hay pregunta anterior, asi que no se genera el PDF.
 */
async function askSaleCondition(current: string | undefined): Promise<Back | string | null> {
  const currentKey = current?.trim().toLowerCase();
  const isKey = (value: string | undefined): value is SaleConditionKey =>
    SALE_CONDITION_KEYS.includes(value as SaleConditionKey);
  const answer = await chooseOrTypeStep<string>(
    'Condición de venta:',
    // La clave tambien la encuentra al escribir: "contado" o "cheque".
    SALE_CONDITION_KEYS.map((key) => ({ keywords: key, label: SALE_CONDITION_LABELS[key], value: key })),
    {
      // Las preguntas anteriores del PDF no vuelven: "Volver" no tendria adonde ir. Esc cancela el PDF.
      backRow: false,
      emptyLabel: 'Omitir',
      optional: true,
      parse: (text) => text,
      // Texto libre: lo escrito va tal cual, aunque una sugerencia lo contenga.
      preferTyped: true,
      previous: isKey(currentKey) ? currentKey : current?.trim() || undefined,
      validate: (text) => validateConfigValue('condicionVenta', text),
    },
  );

  return answer === undefined ? null : answer;
}

function validateConfigValue(key: IssuerKey | 'condicionVenta', value: string): string | true {
  try {
    parseConfigValue(key, value, nodeLocalFiles);

    return true;
  } catch (error) {
    return errorText(error);
  }
}

function applyIssuerValue(config: ArcliConfig, key: IssuerKey, value: string): ArcliConfig {
  const parsed = String(parseConfigValue(key, value, nodeLocalFiles));

  if (key === 'cuit') {
    return { ...config, cuit: parsed };
  }

  const field = key.slice('emisor.'.length) as 'domicilio' | 'inicioActividades' | 'razonSocial';

  return { ...config, emisor: { ...config.emisor, [field]: parsed } };
}

/** Pide los datos del emisor que faltan y ofrece guardarlos para no volver a preguntarlos. */
export async function completeIssuer(config: ArcliConfig): Promise<ArcliConfig> {
  const missing = listMissingIssuerKeys(config) as IssuerKey[];

  if (missing.length === 0) {
    return config;
  }

  let completed = config;
  const answers: Array<readonly [IssuerKey, string]> = [];

  for (const key of missing) {
    const value = await askText(ISSUER_QUESTIONS[key], { validate: (text) => validateConfigValue(key, text) });

    answers.push([key, value]);
    completed = applyIssuerValue(completed, key, value);
  }

  if (await confirm('¿Guardamos estos datos en la config para la próxima?', 'Sí, guardar', 'No, solo esta vez')) {
    withConfigService((service) => {
      for (const [key, value] of answers) {
        service.setValue(key, value);
      }
    });
  }

  return completed;
}

const PDF_NOT_GENERATED = 'El comprobante ya quedó emitido; no se generó el PDF.';

/** Lo que va en el PDF ademas del comprobante: los datos que solo van ahi y los del emisor que faltaban. */
interface PdfAnswers {
  readonly config: ArcliConfig;
  readonly input: BillingCommandInput;
}

/**
 * Las preguntas del PDF: `false` si no se genera ("No"), BACK si se volvio desde la condicion de venta (Esc: no hay
 * pregunta anterior).
 */
async function askPdfAnswers(
  config: ArcliConfig,
  input: BillingCommandInput,
  asks: boolean,
): Promise<Back | false | PdfAnswers> {
  if (asks && !(await confirm('¿Generamos el PDF del comprobante?', 'Sí, generar el PDF', 'No'))) {
    return false;
  }

  const description = await askText('Descripción del comprobante (Enter para "Según detalle")');
  // Lo que trajo el padron se propone: Enter lo deja, en lugar de borrarlo.
  const receiverName = await askText('Nombre o razón social del receptor:', {
    defaultValue: input.receiverName,
    hint: input.receiverName ? undefined : SKIP_HINT,
  });
  const receiverAddress = await askText('Domicilio del receptor:', {
    defaultValue: input.receiverAddress,
    hint: input.receiverAddress ? undefined : SKIP_HINT,
  });
  const currentSaleCondition =
    input.saleCondition === null ? undefined : (input.saleCondition ?? config.condicionVenta);
  const saleCondition = await askSaleCondition(currentSaleCondition);

  if (saleCondition === BACK) {
    return BACK;
  }

  return {
    config: await completeIssuer(config),
    input: {
      ...input,
      pdf: true,
      pdfDescription: description || undefined,
      receiverAddress: receiverAddress || undefined,
      receiverName: receiverName || undefined,
      saleCondition,
    },
  };
}

/**
 * Despues de emitir: genera el PDF si `input.pdf` es `true` ("Sí, emitir y generar el PDF") y pide los datos que solo
 * van en el PDF. El asistente siempre lo decide en la confirmacion; sin `input.pdf`, decide la config. Las preguntas van
 * en `delivery.whileAsking` y Ctrl+C mientras se genera deja de generarlo, como en los comandos.
 */
export async function offerPdf(
  config: ArcliConfig,
  input: BillingCommandInput,
  result: BillingExecutionResult,
  delivery: DeliveryInterruption,
): Promise<void> {
  const [decision] = decidePdfs({ interactive: true, mode: config.pdf, vouchers: [{ flag: input.pdf, result }] });

  if (decision === 'omitir') {
    return;
  }

  // Ya se emitio: un Ctrl+C aca no puede terminar en "No se emitio nada".
  try {
    const answers = await delivery.whileAsking(() => askPdfAnswers(config, input, decision === 'preguntar'));

    if (answers === false) {
      return;
    }

    if (answers === BACK) {
      writeTerminalOutput(noticePanel(PDF_NOT_GENERATED, 'muted'));

      return;
    }

    // Sin respuestas ya se corto: el PDF sale como cortado antes de generarse.
    const pdf = answers ?? { config, input: { ...input, pdf: true } };
    const withPdf = await attachPdfs(
      { config: pdf.config, inputs: [pdf.input], interactive: true, results: [result] },
      interruptiblePdfSteps(delivery),
    );

    recordFailedPdfs(withPdf);
    writePdfOutcomes([result], withPdf);
  } catch (error) {
    if (!isPromptCancellation(error)) {
      throw error;
    }

    // Cortado por la salida rota, no por la persona: este aviso no se ve.
    if (isOutputLost('stdout')) {
      recordMissingPdf(result);
    }

    writeTerminalOutput(noticePanel(PDF_NOT_GENERATED, 'muted'));
  }
}
