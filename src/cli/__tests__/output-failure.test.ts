import { CommanderError } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '../../lib/errors/app-error';
import type { BillingExecutionResult } from '../../modules/billing/billing.types.internal';
import type { ExportExecutionResult } from '../../modules/export/export.types';
import { stripAnsi } from '../../ui';
import type { OutputFailures, OutputName } from '../closed-output';
import { writePartialResultsFailure } from '../commands/billing.command.output';
import {
  describeEmittedInThisRun,
  recordEmission,
  recordExportEmission,
  resetEmittedInThisRun,
} from '../emitted-vouchers';
import { reportCliError, reportOutputFailure } from '../error-output';

const FULL = 'No se pudo escribir toda la salida: no queda espacio en el disco.';
const LOST_ERRORS = 'No se pudieron escribir todos los avisos y errores: no queda espacio en el disco.';
const EMITTED =
  'Se emitió: fc del punto de venta 3, 42. Verificalo con `arcli ultimos fc --pv 3 --cantidad 2 --testing`.';

let stderr = '';
let stdout = '';

const plain = (text: string): string => stripAnsi(text).replace(/[│┃║╏╎┊▎\s]+/g, ' ');

function failures(...outputs: readonly OutputName[]): OutputFailures {
  return new Map(outputs.map((output) => [output, Object.assign(new Error('write'), { code: 'ENOSPC' })]));
}

function result(overrides: Partial<Record<'cae' | 'dryRun' | 'voucherNumber', unknown>> = {}): BillingExecutionResult {
  const { cae = '75123456789012', dryRun = false, voucherNumber = 42 } = overrides;

  return {
    dryRun,
    environment: 'testing',
    payload: { PtoVta: 3 },
    response: { cae },
    voucherKind: { shortcut: 'fc' },
    voucherNumber,
  } as unknown as BillingExecutionResult;
}

beforeEach(() => {
  stderr = '';
  stdout = '';
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => ((stderr += String(chunk)), true));
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => ((stdout += String(chunk)), true));
});

afterEach(() => {
  vi.restoreAllMocks();
  resetEmittedInThisRun();
});

describe('reportOutputFailure', () => {
  it('stdout, en texto: por stderr, con lo emitido', () => {
    recordEmission(result());
    reportOutputFailure(failures('stdout'), { commandError: undefined, json: false });

    expect(stdout).toBe('');
    expect(plain(stderr)).toContain(`${FULL} ${EMITTED}`);
  });

  it('stdout, en texto, con un error del comando: no lo repite, ya salió por stderr', () => {
    reportOutputFailure(failures('stdout'), { commandError: new Error('otra cosa'), json: false });

    expect(stderr).not.toContain('otra cosa');
  });

  it.each([
    [false, null],
    [true, EMITTED],
  ])('stdout, en JSON, emitido %s', (emitted, sugerencia) => {
    if (emitted) {
      recordEmission(result());
    }

    reportOutputFailure(failures('stdout'), { commandError: undefined, json: true });

    expect(stdout).toBe('');
    expect(JSON.parse(stderr)).toEqual({ codigo: 'UNEXPECTED_ERROR', detalles: null, error: FULL, sugerencia });
  });

  it('stderr, en texto: por stdout, con lo emitido y el error del comando', () => {
    recordEmission(result());
    reportOutputFailure(failures('stderr'), {
      commandError: new AppError('No se sabe', { code: 'EMISSION_UNCERTAIN' }),
      json: false,
    });

    expect(stderr).toBe('');
    expect(plain(stdout)).toContain(`${LOST_ERRORS} ${EMITTED}`);
    expect(plain(stdout)).toContain('No se sabe');
  });

  it.each([undefined, new CommanderError(0, 'commander.helpDisplayed', '(outputHelp)')])(
    'stderr, en texto, sin un error de verdad (%s): solo el aviso',
    (commandError) => {
      reportOutputFailure(failures('stderr'), { commandError, json: false });

      expect(plain(stdout)).toContain(LOST_ERRORS);
      expect(stdout).not.toMatch(/ERROR|outputHelp/);
    },
  );

  it('stderr, en JSON: nada, stdout es solo el resultado', () => {
    reportOutputFailure(failures('stderr'), { commandError: new Error('x'), json: true });

    expect(stdout + stderr).toBe('');
  });

  it.each([[[]], [['stdout', 'stderr']], [['stderr', 'stdout']]] as ReadonlyArray<[OutputName[]]>)(
    '%j: no hay qué o dónde avisar',
    (outputs) => {
      reportOutputFailure(failures(...outputs), { commandError: new Error('x'), json: false });

      expect(stdout + stderr).toBe('');
    },
  );

  it('no repite en stderr lo que ya dijo el aviso del lote cortado, pero sí por stdout si stderr falló', () => {
    recordEmission(result());
    writePartialResultsFailure([result()]);
    stderr = '';
    reportOutputFailure(failures('stdout'), { commandError: undefined, json: false });

    expect(plain(stderr)).toContain(FULL);
    expect(stderr).not.toContain('Se emiti');

    reportOutputFailure(failures('stderr'), { commandError: undefined, json: false });

    expect(plain(stdout)).toContain(EMITTED);
  });

  it('lo emitido después de ese aviso sí se dice', () => {
    recordEmission(result());
    writePartialResultsFailure([result()]);
    recordEmission(result({ voucherNumber: 43 }));
    stderr = '';
    reportOutputFailure(failures('stdout'), { commandError: undefined, json: false });

    expect(plain(stderr)).toContain('Se emitió: fc del punto de venta 3, 43.');
  });
});

describe('reportCliError con una salida que no se pudo escribir', () => {
  const error = new AppError('Falló', {
    code: 'BATCH_EMISSION_ERROR',
    details: { fallo: 2 },
    suggestion: 'Mirá esto.',
  });

  it('en JSON, al final de la sugerencia; el resto no cambia', () => {
    recordEmission(result());

    expect(reportCliError(error, true, failures('stdout'))).toBe(1);
    expect(JSON.parse(stderr)).toEqual({
      codigo: 'BATCH_EMISSION_ERROR',
      detalles: { fallo: 2 },
      error: 'Falló',
      sugerencia: `Mirá esto. ${FULL} ${EMITTED}`,
    });
  });

  it('en JSON, sin sugerencia propia ni emitidos, queda el motivo', () => {
    reportCliError(new Error('Falló'), true, failures('stdout'));

    expect(JSON.parse(stderr)).toMatchObject({ error: 'Falló', sugerencia: FULL });
  });

  it.each([[[]], [['stderr']]] as ReadonlyArray<[OutputName[]]>)('en JSON, si falló %j, sale tal cual', (outputs) => {
    reportCliError(error, true, failures(...outputs));

    expect(JSON.parse(stderr)).toMatchObject({ sugerencia: 'Mirá esto.' });
  });

  it('en texto no suma nada: va en el aviso aparte', () => {
    reportCliError(error, false, failures('stdout'));

    expect(plain(stderr)).not.toContain('No se pudo escribir');
  });
});

describe('lo que cuenta como emitido', () => {
  it.each([
    ['una vista previa', { dryRun: true }],
    ['un rechazo', { cae: null }],
  ])('%s no', (_name, overrides) => {
    const recorded = result(overrides);

    expect(recordEmission(recorded)).toBe(recorded);
    expect(describeEmittedInThisRun()).toEqual([]);
  });

  it.each([
    [false, '75123456789012', ['Se emitió: fe del punto de venta 4, 9.']],
    [false, null, []],
    [true, '75123456789012', []],
  ])('la E, vista previa %s y CAE %s', (dryRun, cae, expected) => {
    const recorded = {
      dryRun,
      environment: 'testing',
      payload: { Cbte_nro: 9, Punto_vta: 4 },
      response: { cae },
      voucherKind: { shortcut: 'fe' },
    } as unknown as ExportExecutionResult;

    expect(recordExportEmission(recorded)).toBe(recorded);
    expect(describeEmittedInThisRun()).toEqual(expected.map((text) => expect.stringContaining(text)));
  });
});
