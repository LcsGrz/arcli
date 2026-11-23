import { Command } from 'commander';
import { describe, expect, it } from 'vitest';

import { parseBillingCommandPlan, registerBillingOptions } from '../../../cli/commands/billing.command.parser';
import { registerGlobalOptions } from '../../../cli/global-options';
import { type BillingCommandInput, billingCommandSchema } from '../../billing/billing.schemas';
import type { VoucherShortcut } from '../../billing/billing.types';
import { buildEquivalentCommand } from '../equivalent-command';

/** Separa el comando como lo haria una shell POSIX: `'...'` es literal y `\\` escapa el caracter que sigue. */
function shellWords(command: string): string[] {
  const words: string[] = [];
  let word: string | undefined;

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];

    if (char === ' ') {
      if (word !== undefined) words.push(word);
      word = undefined;
    } else if (char === "'") {
      const close = command.indexOf("'", index + 1);

      word = (word ?? '') + command.slice(index + 1, close);
      index = close;
    } else if (char === '\\') {
      index += 1;
      word = (word ?? '') + command[index];
    } else {
      word = (word ?? '') + char;
    }
  }

  if (word !== undefined) words.push(word);

  return words;
}

function parseCommand(command: string, shortcut: VoucherShortcut): BillingCommandInput {
  const program = new Command();

  registerGlobalOptions(program);
  registerBillingOptions(program);
  program.exitOverride();
  program.parse(shellWords(command).slice(2), { from: 'user' });

  return parseBillingCommandPlan(program, shortcut).inputs[0] as BillingCommandInput;
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
    expect(buildEquivalentCommand(input({}), { environment: 'testing', platform: 'linux' })).toBe(
      'arcli fc -m 1000 --cs --consumidor-final --testing --emitir',
    );
  });

  it('sin documento, --ir solo si el IVA receptor no es consumidor final, y al reparsearlo da la misma entrada', () => {
    const exempt = input({ ivaCondition: 'sujeto-exento' });
    const command = buildEquivalentCommand(exempt, { environment: 'testing', platform: 'linux' });

    expect(command).toBe('arcli fc -m 1000 --cs --consumidor-final --ir sujeto-exento --testing --emitir');
    expect(parseCommand(command, 'fc').ivaCondition).toBe('sujeto-exento');
    expect(
      parseCommand(buildEquivalentCommand(input({}), { environment: 'testing', platform: 'linux' }), 'fc').ivaCondition,
    ).toBe('consumidor-final');
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
      { environment: 'produccion', platform: 'linux' },
    );

    expect(command).toBe(
      'arcli fcea -m 1000 --cs --cuit 30709965812 --ir responsable-inscripto --alicuota 10.5 --cbu 0110599520000012345678 --transferencia adc --produccion --emitir',
    );
  });

  it('con moneda extranjera en la config, un comprobante en pesos lleva --moneda ARS', () => {
    expect(
      buildEquivalentCommand(input({}), { defaultCurrency: 'USD', environment: 'testing', platform: 'linux' }),
    ).toContain('--moneda ARS');
    expect(
      buildEquivalentCommand(input({}), { defaultCurrency: 'ARS', environment: 'testing', platform: 'linux' }),
    ).not.toContain('--moneda');
  });

  it('incluye la moneda extranjera', () => {
    expect(
      buildEquivalentCommand(input({ currencyCode: 'USD', exchangeRate: 1200 }), {
        environment: 'testing',
        platform: 'linux',
      }),
    ).toContain('--moneda USD --cm 1200');
    expect(
      buildEquivalentCommand(input({ currencyCode: 'USD', sameCurrency: true }), {
        environment: 'testing',
        platform: 'linux',
      }),
    ).toContain('--moneda USD --misma-moneda');
    expect(buildEquivalentCommand(input({}), { environment: 'testing', platform: 'linux' })).not.toContain('--moneda');
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
    const command = buildEquivalentCommand(original, { environment: 'testing', platform: 'linux' });
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
    const command = buildEquivalentCommand(original, { environment: 'testing', platform: 'linux' });

    expect(command).toBe(
      'arcli ncb -m 1210 --cs --cuil 20333333334 --ir-cf -f 31/10 --moneda EUR --misma-moneda --exento 50 --sd 1/10 --sh 31/10 --vto 15/11 --pd 1/10 --ph 31/10 --testing --emitir',
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
    const command = buildEquivalentCommand(original, { environment: 'testing', platform: 'linux' });

    expect(command).toBe(
      `arcli fa -m 1000 --cs --cuit 30709965812 --ir responsable-inscripto --receptor-nombre 'ACME S.A.' --receptor-domicilio 'Av. Corrientes 1234, Piso 5 "B"' --testing --emitir`,
    );
    expect(parseCommand(command, 'fa')).toMatchObject({
      receiverAddress: 'Av. Corrientes 1234, Piso 5 "B"',
      receiverName: 'ACME S.A.',
    });
  });

  it('con !, $, backtick y comilla simple en el nombre, la shell lo lee tal cual', () => {
    const receiverName = "Hola! $HOME `id` O'Brien Muñoz";
    const original = input({
      documentNumber: 30709965812,
      documentType: 'cuit',
      ivaCondition: 'responsable-inscripto',
      receiverName,
      shortcut: 'fa',
    });
    const command = buildEquivalentCommand(original, { environment: 'testing', platform: 'linux' });

    expect(command).toContain(`--receptor-nombre 'Hola! $HOME \`id\` O'\\''Brien Muñoz'`);
    expect(parseCommand(command, 'fa').receiverName).toBe(receiverName);
  });

  it('en Windows usa las comillas de PowerShell y el resto queda igual que en POSIX', () => {
    const command = buildEquivalentCommand(
      input({
        documentNumber: 30709965812,
        documentType: 'cuit',
        ivaCondition: 'responsable-inscripto',
        receiverName: "O'Brien",
        shortcut: 'fa',
        totalAmount: 1500.5,
      }),
      { environment: 'testing', platform: 'win32' },
    );

    expect(command).toBe(
      "arcli fa -m 1500,50 --cs --cuit 30709965812 --ir responsable-inscripto --receptor-nombre 'O''Brien' --testing --emitir",
    );
  });
});

describe('buildEquivalentCommand: asociados incompletos y varias alícuotas', () => {
  it('un asociado por tipo de ARCA va con --at, y el parser lo lee igual', () => {
    const note = input({
      associatedVoucher: { cuit: '20111111112', fecha: '01/11/2026', numero: 7, puntoVenta: 2, tipo: 1 },
      shortcut: 'nca',
    });
    const command = buildEquivalentCommand(note, { environment: 'testing', platform: 'linux' });

    expect(command).toContain('--at 1 --apv 2 --ar 7 --acuit 20111111112 --afecha 01/11/2026');
    expect(parseCommand(command, 'nca').associatedVoucher).toMatchObject({ numero: 7, puntoVenta: 2, tipo: 1 });
  });

  it('sin --acuit en una nota común cuando el asociado es del CUIT emisor (REV-59)', () => {
    const associatedVoucher = { cuit: '20111111112', fecha: '01/11/2026', numero: 7, puntoVenta: 2, shortcut: 'fa' };
    const options = { environment: 'testing', issuerCuit: 20111111112, platform: 'linux' } as const;

    expect(buildEquivalentCommand(input({ associatedVoucher, shortcut: 'nca' }), options)).not.toContain('--acuit');
    expect(
      buildEquivalentCommand(
        input({ associatedVoucher: { ...associatedVoucher, cuit: '20333333334' }, shortcut: 'nca' }),
        options,
      ),
    ).toContain('--acuit 20333333334');
    expect(
      buildEquivalentCommand(
        input({ associatedVoucher: { ...associatedVoucher, shortcut: 'fcea' }, shortcut: 'ncea' }),
        options,
      ),
    ).toContain('--acuit 20111111112');
  });

  it('lo que falta del asociado no se inventa', () => {
    expect(
      buildEquivalentCommand(input({ associatedVoucher: { shortcut: 'fc' }, shortcut: 'ncc' }), {
        environment: 'testing',
        platform: 'linux',
      }),
    ).toBe('arcli ncc -m 1000 --cs --consumidor-final --ac fc --testing --emitir');
  });

  it('un periodo con solo el desde lleva solo --pd', () => {
    expect(
      buildEquivalentCommand(input({ associatedPeriod: { desde: '01/10/2026' }, shortcut: 'ncc' }), {
        environment: 'testing',
        platform: 'linux',
      }),
    ).toContain('--pd 01/10/2026 --testing');
  });

  it('varias alícuotas con su base van una por --alicuota', () => {
    const command = buildEquivalentCommand(
      input({
        documentNumber: 30709965812,
        documentType: 'cuit',
        ivaCondition: 'responsable-inscripto',
        ivaRateAmounts: [
          { amount: 1000, rate: '21' },
          { amount: 500.5, rate: '10.5' },
        ],
        shortcut: 'fa',
        totalAmount: 1763.05,
      }),
      { environment: 'testing', platform: 'linux' },
    );

    expect(command).toContain('--alicuota 21:1000 --alicuota 10.5:500,50');
  });
});
