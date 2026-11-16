import { Command } from 'commander';
import { describe, expect, it } from 'vitest';

import { parseBillingCommandInput, registerBillingOptions } from '../../../cli/commands/billing.command.parser';
import { registerGlobalOptions } from '../../../cli/global-options';
import { type BillingCommandInput, billingCommandSchema } from '../../billing/billing.schemas';
import type { VoucherShortcut } from '../../billing/billing.types';
import { buildEquivalentCommand } from '../equivalent-command';

/** Separa el comando como lo haria la shell: comillas dobles, con `\` para escapar. */
function shellWords(command: string): string[] {
  return [...command.matchAll(/"((?:\\.|[^"\\])*)"|(\S+)/g)].map(([, quoted, plain]) =>
    quoted === undefined ? plain : quoted.replace(/\\(.)/g, '$1'),
  );
}

function parseCommand(command: string, shortcut: VoucherShortcut): BillingCommandInput {
  const program = new Command();

  registerGlobalOptions(program);
  registerBillingOptions(program);
  program.exitOverride();
  program.parse(shellWords(command).slice(2), { from: 'user' });

  return parseBillingCommandInput(program, shortcut);
}

function input(overrides: Record<string, unknown>): BillingCommandInput {
  return billingCommandSchema.parse({
    concept: 'servicios',
    ivaCondition: 'consumidor-final',
    shortcut: 'fc',
    totalAmount: 1000,
    ...overrides,
  });
}

describe('buildEquivalentCommand', () => {
  it('arma el comando de una factura a consumidor final, con el entorno explicito', () => {
    expect(buildEquivalentCommand(input({}), { environment: 'testing' })).toBe(
      'arcli fc -m 1000 --cs --consumidor-final --testing --emitir',
    );
  });

  it('sin documento, --ir solo si el IVA receptor no es consumidor final, y al reparsearlo da la misma entrada', () => {
    const exempt = input({ ivaCondition: 'sujeto-exento' });
    const command = buildEquivalentCommand(exempt, { environment: 'testing' });

    expect(command).toBe('arcli fc -m 1000 --cs --consumidor-final --ir sujeto-exento --testing --emitir');
    expect(parseCommand(command, 'fc').ivaCondition).toBe('sujeto-exento');
    expect(parseCommand(buildEquivalentCommand(input({}), { environment: 'testing' }), 'fc').ivaCondition).toBe(
      'consumidor-final',
    );
  });

  it('agrega --produccion y los datos de FCE', () => {
    const command = buildEquivalentCommand(
      input({
        cbu: '0110599520000012345678',
        documentNumber: 30709965812,
        documentType: 'cuit',
        ivaCondition: 'responsable-inscripto',
        ivaRate: '10.5',
        shortcut: 'fcea',
        transferMode: 'adc',
      }),
      { environment: 'produccion' },
    );

    expect(command).toBe(
      'arcli fcea -m 1000 --cs --cuit 30709965812 --ir responsable-inscripto --alicuota 10.5 --cbu 0110599520000012345678 --transferencia adc --produccion --emitir',
    );
  });

  it('con moneda extranjera en la config, un comprobante en pesos lleva --moneda ARS', () => {
    expect(buildEquivalentCommand(input({}), { defaultCurrency: 'USD', environment: 'testing' })).toContain(
      '--moneda ARS',
    );
    expect(buildEquivalentCommand(input({}), { defaultCurrency: 'ARS', environment: 'testing' })).not.toContain(
      '--moneda',
    );
  });

  it('incluye la moneda extranjera', () => {
    expect(
      buildEquivalentCommand(input({ currencyCode: 'USD', exchangeRate: 1200 }), { environment: 'testing' }),
    ).toContain('--moneda USD --cm 1200');
    expect(
      buildEquivalentCommand(input({ currencyCode: 'USD', sameCurrency: true }), { environment: 'testing' }),
    ).toContain('--moneda USD --misma-moneda');
    expect(buildEquivalentCommand(input({}), { environment: 'testing' })).not.toContain('--moneda');
  });

  it('genera un comando que el parser vuelve a leer igual', () => {
    const original = input({
      associatedVoucher: { cuit: '20333333334', fecha: '01/10/2026', numero: 14, puntoVenta: 3, shortcut: 'fb' },
      cancellation: false,
      concept: 'productos',
      documentNumber: 12345678,
      documentType: 'dni',
      emit: true,
      shortcut: 'ncb',
      totalAmount: 1500.5,
    });
    const command = buildEquivalentCommand(original, { environment: 'testing' });
    const reparsed = parseCommand(command, 'ncb');

    expect({ ...reparsed, dryRun: false }).toEqual({ ...original, dryRun: false });
  });

  it('incluye fecha, CUIL, otra moneda y las fechas y montos opcionales de una nota, y el parser los lee igual', () => {
    const original = input({
      associatedPeriod: { desde: '1/10', hasta: '31/10' },
      billingDate: '31/10',
      cancellation: false,
      currencyCode: 'EUR',
      documentNumber: 20333333334,
      documentType: 'cuil',
      emit: true,
      exemptAmount: 50,
      ivaCondition: 'consumidor-final',
      paymentDueDate: '15/11',
      sameCurrency: true,
      serviceEndDate: '31/10',
      serviceStartDate: '1/10',
      shortcut: 'ncb',
      totalAmount: 1210,
    });
    const command = buildEquivalentCommand(original, { environment: 'testing' });

    expect(command).toBe(
      'arcli ncb -m 1210 --cs --cuil 20333333334 --ir consumidor-final -f 31/10 --moneda EUR --misma-moneda --exento 50 --sd 1/10 --sh 31/10 --vto 15/11 --pd 1/10 --ph 31/10 --testing --emitir',
    );
    expect({ ...parseCommand(command, 'ncb'), dryRun: false }).toEqual({ ...original, dryRun: false });
  });

  it('lleva nombre y domicilio del padrón entre comillas, y el parser los lee igual', () => {
    const original = input({
      documentNumber: 30709965812,
      documentType: 'cuit',
      emit: true,
      ivaCondition: 'responsable-inscripto',
      receiverAddress: 'Av. Corrientes 1234, Piso 5 "B"',
      receiverName: 'ACME S.A.',
      shortcut: 'fa',
    });
    const command = buildEquivalentCommand(original, { environment: 'testing' });

    expect(command).toBe(
      'arcli fa -m 1000 --cs --cuit 30709965812 --ir responsable-inscripto --receptor-nombre "ACME S.A." --receptor-domicilio "Av. Corrientes 1234, Piso 5 \\"B\\"" --testing --emitir',
    );
    expect(parseCommand(command, 'fa')).toMatchObject({
      receiverAddress: 'Av. Corrientes 1234, Piso 5 "B"',
      receiverName: 'ACME S.A.',
    });
  });
});
