import {
  type BillingCommandInput,
  billingCommandSchema,
  type BillingDocumentType,
} from '../../modules/billing/billing.schemas';
import type { VoucherKindDefinition } from '../../modules/billing/billing.types';
import { parseAmountInput } from '../../modules/interactive/amount-input';
import {
  conceptChoices,
  invoiceKindChoices,
  ivaConditionChoices,
  ivaRateChoices,
  receiverChoices,
} from '../../modules/interactive/choices';

import { askText, chooseOne } from './prompts';
import { type InteractiveSession, previewAndEmit } from './session';
import { normalizeDocumentNumber, validateAmount, validateCbu, validateCuit, validateDni } from './validators';

async function askDocumentNumber(documentType: BillingDocumentType): Promise<number | undefined> {
  if (documentType === 'cuit') {
    return normalizeDocumentNumber(await askText('CUIT del receptor:', { validate: validateCuit }));
  }

  if (documentType === 'dni') {
    return normalizeDocumentNumber(await askText('DNI del receptor:', { validate: validateDni }));
  }

  return undefined;
}

async function askFceInvoiceData(
  session: InteractiveSession,
  voucherKind: VoucherKindDefinition,
): Promise<Pick<BillingCommandInput, 'cbu' | 'transferMode'>> {
  if (voucherKind.family !== 'factura-credito-electronica') {
    return {};
  }

  const cbu = session.runtime.config.cbu ?? (await askText('CBU del emisor (22 digitos):', { validate: validateCbu }));
  const transferMode = await chooseOne('Modalidad de transferencia:', [
    { description: 'La opcion habitual', name: 'Sistema de circulacion abierta (SCA)', value: 'sca' as const },
    { name: 'Agente de deposito colectivo (ADC)', value: 'adc' as const },
  ]);

  return { cbu, transferMode };
}

export async function runInvoiceFlow(session: InteractiveSession): Promise<void> {
  const { config } = session.runtime;
  const voucherKind = await chooseOne('¿Que comprobante queres emitir?', invoiceKindChoices());
  const documentType = await chooseOne('¿A quien le facturas?', receiverChoices(voucherKind.letter));
  const documentNumber = await askDocumentNumber(documentType);
  const ivaCondition =
    documentType === 'consumidor-final'
      ? 'consumidor-final'
      : await chooseOne(
          'Condicion frente al IVA del receptor:',
          ivaConditionChoices(voucherKind.letter),
          config.ivaReceptorPorDefecto,
        );
  const concept = await chooseOne('¿Que estas facturando?', conceptChoices(), config.conceptoPorDefecto);
  const totalAmount = parseAmountInput(await askText('Monto total:', { validate: validateAmount }));
  const ivaRate =
    voucherKind.letter === 'c'
      ? undefined
      : await chooseOne('Alicuota de IVA:', ivaRateChoices(), config.alicuotaPorDefecto ?? '21');

  const input = billingCommandSchema.parse({
    ...(await askFceInvoiceData(session, voucherKind)),
    concept,
    documentNumber,
    documentType,
    ivaCondition,
    // 21% sin alicuota configurada es el default del CLI. Si hay config, se deja explicito para que el
    // comando equivalente no tome la de la config.
    ivaRate: ivaRate === '21' && !config.alicuotaPorDefecto ? undefined : ivaRate,
    shortcut: voucherKind.shortcut,
    totalAmount,
  });

  await previewAndEmit(session, input);
}
