import type { BillingCommandInput } from '../../modules/billing/billing.schemas';
import type { BillingExecutionResult } from '../../modules/billing/billing.types.internal';
import {
  SALE_CONDITION_KEYS,
  SALE_CONDITION_LABELS,
  type SaleConditionKey,
} from '../../modules/billing/sale-condition';
import type { ArcliConfig } from '../../modules/config/config.schemas';
import { ConfigService } from '../../modules/config/config.service';
import { parseConfigValue } from '../../modules/config/config-value-parser';
import { BACK, type Back } from '../../modules/interactive/wizard';
import { canHavePdf, resolvePdfDecision } from '../../modules/pdf/pdf-decision';
import { listMissingIssuerKeys } from '../../modules/pdf/pdf-issuer';
import { noticePanel, writeTerminalOutput } from '../../ui';
import { writePdfOutcomes } from '../commands/billing.command.output';
import { attachPdfs } from '../commands/billing.command.pdf';

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
      emptyLabel: 'Omitir',
      optional: true,
      parse: (text) => text,
      previous: isKey(currentKey) ? currentKey : current?.trim() || undefined,
      validate: (text) => validateConfigValue('condicionVenta', text),
    },
  );

  return answer === undefined ? null : answer;
}

function validateConfigValue(key: IssuerKey | 'condicionVenta', value: string): string | true {
  try {
    parseConfigValue(key, value);

    return true;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function applyIssuerValue(config: ArcliConfig, key: IssuerKey, value: string): ArcliConfig {
  const parsed = String(parseConfigValue(key, value));

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
    const service = new ConfigService();

    try {
      for (const [key, value] of answers) {
        service.setValue(key, value);
      }
    } finally {
      service.close();
    }
  }

  return completed;
}

const PDF_NOT_GENERATED = 'El comprobante ya quedó emitido; no se generó el PDF.';

/**
 * Despues de emitir: genera el PDF si `input.pdf` es `true` ("Sí, emitir y generar el PDF") y pide los datos que solo
 * van en el PDF. El asistente siempre lo decide en la confirmacion; sin `input.pdf`, decide la config.
 */
export async function offerPdf(
  config: ArcliConfig,
  input: BillingCommandInput,
  result: BillingExecutionResult,
): Promise<void> {
  if (!canHavePdf(result)) {
    return;
  }

  const decision = resolvePdfDecision({ flag: input.pdf, interactive: true, mode: config.pdf });

  if (decision === 'omitir') {
    return;
  }

  // Ya se emitio: un Ctrl+C aca no puede terminar en "No se emitio nada".
  try {
    if (
      decision === 'preguntar' &&
      !(await confirm('¿Generamos el PDF del comprobante?', 'Sí, generar el PDF', 'No'))
    ) {
      return;
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
      writeTerminalOutput(noticePanel(PDF_NOT_GENERATED, 'muted'));

      return;
    }

    const completedConfig = await completeIssuer(config);
    const withPdf = await attachPdfs({
      config: completedConfig,
      inputs: [
        {
          ...input,
          pdf: true,
          pdfDescription: description || undefined,
          receiverAddress: receiverAddress || undefined,
          receiverName: receiverName || undefined,
          saleCondition,
        },
      ],
      interactive: true,
      results: [result],
    });

    writePdfOutcomes([result], withPdf);
  } catch (error) {
    if (!isPromptCancellation(error)) {
      throw error;
    }

    writeTerminalOutput(noticePanel(PDF_NOT_GENERATED, 'muted'));
  }
}
