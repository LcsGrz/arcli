import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CertificateExpiredError, type CertificateExpiryNotice } from '../../../modules/config/certificate-expiry';
import { listMissingSetupKeys } from '../../../modules/interactive/config-fields';
import { type ArcaHealth, checkArcaHealth } from '../../../modules/parameters/health';
import { checkForUpdate, type UpdateCheckResult } from '../../../modules/update-check/update-check.service';
import { runConfigMenu, runGuidedSetup } from '../config.flow';
import { runInteractiveMode } from '../interactive-mode';
import { runInvoiceFlow } from '../invoice.flow';
import { runNoteFlow } from '../note.flow';
import { withOutputGuard } from '../output-guard';
import { createInteractiveSession } from '../session';
import { runStatusFlow } from '../status.flow';
import { runUpdateFlow } from '../update.flow';

import { VirtualTerminal } from './virtual-terminal';

/**
 * El arranque del asistente (TUI-49) en la pantalla de verdad: las preguntas reales sobre una terminal que interpreta
 * lo que se escribe. ARCA y npm responden cuando el test lo dice.
 */

vi.mock('../../../modules/interactive/config-fields', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../modules/interactive/config-fields')>()),
  listMissingSetupKeys: vi.fn(() => []),
}));
vi.mock('../../../modules/config/config.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../modules/config/config.service')>()),
  ConfigService: class {
    public close(): void {}
    public ensureInitialized(): void {}
    public getConfig(): object {
      return {};
    }
  },
}));
vi.mock('../config.flow', () => ({ runConfigMenu: vi.fn(), runGuidedSetup: vi.fn() }));
vi.mock('../repeat.flow', () => ({ runRepeatFlow: vi.fn() }));
vi.mock('../status.flow', () => ({ runStatusFlow: vi.fn() }));
vi.mock('../invoice.flow', () => ({ runInvoiceFlow: vi.fn() }));
vi.mock('../note.flow', () => ({ runNoteFlow: vi.fn() }));
vi.mock('../queries.flow', () => ({ runQueriesMenu: vi.fn() }));
vi.mock('../update.flow', () => ({ runUpdateFlow: vi.fn() }));
vi.mock('../../../modules/parameters/health', () => ({ checkArcaHealth: vi.fn() }));
vi.mock('../../../modules/update-check/update-check.service', () => ({ checkForUpdate: vi.fn() }));
vi.mock('../session', () => ({ createInteractiveSession: vi.fn() }));
vi.mock('../../version', () => ({ CLI_VERSION: '2.6.0' }));

const UP = '\u001B[A';
const DOWN = '\u001B[B';
const ENTER = '\r';
const ESCAPE = '\u001B';
const CTRL_C = '\u0003';
const BACKSPACE = '\u007F';
const UPDATE: UpdateCheckResult = { currentVersion: '2.6.0', latestVersion: '2.7.0' };
const UPDATE_ROW = 'Actualizar a la versión 2.7.0';
const PENDING = 'COMPROBANDO ARCA…';
/** Readline espera esto despues de un Esc, por si es el comienzo de una secuencia. */
const ESCAPE_WAIT_MS = 600;

const runtime = {
  certificateNotices: [] as readonly CertificateExpiryNotice[],
  config: {},
  context: { cuit: 20333333334 },
  cuit: 20333333334,
  environment: 'testing',
  pointOfSale: 3,
};
const expiring: CertificateExpiryNotice = {
  daysRemaining: 10,
  environment: 'produccion',
  expired: false,
  expiresOn: '20/11/2026',
  message: 'El certificado de producción vence el 20/11/2026 (en 10 días).',
  summary: 'El certificado de producción vence el 20/11/2026 (en 10 días).',
};

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly reject: (error: Error) => void;
  readonly resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });

  return { promise, reject, resolve };
}

const pause = (ms = 15) => new Promise((resolve) => setTimeout(resolve, ms));
const unhandled = vi.fn();

let terminal: VirtualTerminal;
let input: PassThrough;
let health: Array<Deferred<ArcaHealth>>;
let update: Deferred<null | UpdateCheckResult>;
let run: Promise<void>;
let ended: boolean;
let writes: number;
let restore: Array<() => void>;

function define(target: object, key: string, value: unknown): void {
  const original = Object.getOwnPropertyDescriptor(target, key);

  Object.defineProperty(target, key, { configurable: true, value, writable: true });
  restore.push(() => {
    if (original) {
      Object.defineProperty(target, key, original);
    } else {
      delete (target as Record<string, unknown>)[key];
    }
  });
}

function resize(columns: number, rows: number): void {
  terminal = new VirtualTerminal(columns, rows);
  define(process.stdout, 'columns', columns);
  define(process.stdout, 'rows', rows);
}

function start(): void {
  run = withOutputGuard(() => runInteractiveMode()).finally(() => {
    ended = true;
  });
  run.catch(() => undefined);
}

async function press(...keys: readonly string[]): Promise<void> {
  for (const key of keys) {
    input.write(key);
    await pause(key === ESCAPE ? ESCAPE_WAIT_MS : undefined);
  }
}

const text = () => terminal.history().join('\n');
const screen = () => terminal.screen().join('\n');
const count = (pattern: RegExp) => [...text().matchAll(pattern)].length;
const seen = (value: string) => vi.waitFor(() => expect(screen()).toContain(value), { interval: 5, timeout: 700 });

/** Una sola barra y un solo menu, sin lineas que hayan quedado de otro dibujo. */
function expectOneMenu(): void {
  expect(count(/ TESTING /g)).toBe(1);
  expect(count(/¿Qué querés hacer\?/g)).toBe(1);
  expect(count(/Emitir nota de crédito/g)).toBe(1);
  expect(count(/ Salir$/gm)).toBe(1);
}

/** La fila marcada. */
const marked = () =>
  terminal
    .screen()
    .filter((line) => line.startsWith('❯ '))
    .map((line) => line.slice(2));

beforeEach(() => {
  restore = [];
  health = [];
  update = deferred();
  ended = false;
  writes = 0;
  unhandled.mockClear();
  process.on('unhandledRejection', unhandled);
  resize(100, 45);
  input = Object.assign(new PassThrough(), { isTTY: true, setRawMode: () => undefined });
  define(process, 'stdin', input);
  define(process.stdout, 'isTTY', true);
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    writes += 1;
    terminal.write(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  vi.mocked(runUpdateFlow).mockImplementation(async () => false);
  vi.mocked(createInteractiveSession).mockImplementation(() => ({ arca: {}, runtime }) as never);
  vi.mocked(listMissingSetupKeys).mockImplementation(() => []);
  vi.mocked(checkForUpdate).mockImplementation(() => update.promise);
  vi.mocked(checkArcaHealth).mockImplementation(() => {
    const query = deferred<ArcaHealth>();

    health.push(query);

    return query.promise;
  });
});

afterEach(async () => {
  update.resolve(null);

  for (let turn = 0; turn < 20 && !ended; turn += 1) {
    health.forEach((query) => query.resolve('funcionando'));
    input.write(CTRL_C);
    await pause();
  }

  process.off('unhandledRejection', unhandled);
  vi.restoreAllMocks();
  restore.reverse().forEach((undo) => undo());
  vi.resetAllMocks();
});

describe('el asistente abre sin esperar (TUI-49)', () => {
  it('con ARCA y npm pendientes el menú ya está y responde a flechas, filtro y Enter', async () => {
    start();
    await seen('¿Qué querés hacer?');
    expect(screen()).toMatch(/━━ 20-33333333-4 · PV 3 ━+ COMPROBANDO ARCA… ━ TESTING ━━/);
    expect(marked()).toEqual(['Emitir factura']);

    await press(DOWN);
    expect(marked()).toEqual(['Emitir recibo (nuevo)']);
    await press('s', 'e', 'r', 'v', 'e', BACKSPACE, BACKSPACE, BACKSPACE, BACKSPACE, BACKSPACE);
    await press('e', 's', 't', 'a', 'd', 'o');
    expect(screen()).toContain('Filtrar: estado');
    expect(marked()).toEqual(['Estado de ARCA']);
    expect(count(/ TESTING /g)).toBe(1);
    await press(ENTER);

    expect(runStatusFlow).toHaveBeenCalledTimes(1);
  });

  it.each<[ArcaHealth, string]>([
    ['funcionando', 'ARCA FUNCIONANDO'],
    ['con-demoras', 'ARCA CON DEMORAS'],
    ['con-problemas', 'ARCA CON PROBLEMAS'],
    ['sin-respuesta', 'ARCA SIN RESPUESTA'],
  ])('%s: la barra cambia en su lugar y queda en el historial', async (result, label) => {
    start();
    await seen(PENDING);

    const bar = terminal.history().findIndex((line) => line.includes(PENDING));

    health[0]?.resolve(result);
    await seen(label);
    expect(terminal.history()[bar]).toContain(label);
    expect(text()).not.toContain(PENDING);
    expectOneMenu();

    await press(ESCAPE);
    await run;
    expect(text()).toContain(label);
    expect(count(/ TESTING /g)).toBe(1);
    expect(text()).not.toContain('¿Qué querés hacer?');
    expect(text()).not.toContain('SIN VERIFICAR');
  });

  it('si la consulta falla, es sin respuesta', async () => {
    start();
    await seen(PENDING);
    health[0]?.reject(new Error('falló'));
    await seen('ARCA SIN RESPUESTA');
    expectOneMenu();
    expect(unhandled).not.toHaveBeenCalled();
  });

  it('el historial queda como siempre: logo, barra y respuesta, con las mismas líneas en blanco', async () => {
    const flow = deferred<void>();

    vi.mocked(runInvoiceFlow).mockImplementationOnce(() => flow.promise as never);
    start();
    await seen(PENDING);
    health[0]?.resolve('funcionando');
    await seen('ARCA FUNCIONANDO');
    await press(ENTER);
    await seen('✔ ¿Qué querés hacer? Emitir factura');

    const lines = terminal.history();
    const answer = lines.findIndex((line) => line.startsWith('✔'));

    expect(lines[answer - 2]).toMatch(/ARCA FUNCIONANDO ━ TESTING ━━$/);
    expect(lines[answer - 1]).toBe('');
    expect(lines.slice(answer - 5, answer - 2)).toEqual([expect.stringContaining('v2.6.0'), '', '']);
    flow.resolve();
  });
});

describe('se elige antes de saber cómo está ARCA (TUI-49)', () => {
  /** "Emitir factura" queda abierto hasta que el test lo cierra. */
  function openInvoice(): Deferred<void> {
    const flow = deferred<void>();

    vi.mocked(runInvoiceFlow).mockImplementationOnce(() => flow.promise as never);

    return flow;
  }

  it.each<[ArcaHealth, RegExp]>([
    ['con-demoras', /ARCA con demoras/g],
    ['con-problemas', /ARCA con problemas/g],
    ['sin-respuesta', /ARCA sin respuesta/g],
  ])('%s: la barra dice SIN VERIFICAR y al volver al menú avisa una vez', async (result, warning) => {
    const flow = openInvoice();

    start();
    await seen(PENDING);
    await press(ENTER);
    expect(runInvoiceFlow).toHaveBeenCalledTimes(1);
    expect(text()).toMatch(/ARCA SIN VERIFICAR ━ TESTING/);
    expect(text()).not.toContain(PENDING);

    const before = writes;

    health[0]?.resolve(result);
    await pause();
    // En medio del flujo no se escribe nada.
    expect(writes).toBe(before);

    flow.resolve();
    await seen('Emitir nota de crédito');
    expect(count(warning)).toBe(1);
    await press(ENTER);
    expect(count(warning)).toBe(1);
    expect(count(/ TESTING /g)).toBe(1);
  });

  it('si está bien, no avisa nada', async () => {
    const flow = openInvoice();

    start();
    await seen(PENDING);
    await press(ENTER);
    health[0]?.resolve('funcionando');
    flow.resolve();
    await seen('Emitir nota de crédito');
    expect(text()).toContain('ARCA SIN VERIFICAR');
    expect(text()).not.toMatch(/ARCA funcionando/i);
  });

  it.each([true, false])('"Estado de ARCA" ya lo muestra: no avisa (antes de volver: %s)', async (early) => {
    const flow = deferred<void>();

    vi.mocked(runStatusFlow).mockImplementationOnce(() => flow.promise);
    start();
    await seen(PENDING);
    await press('e', 's', 't', 'a', 'd', ENTER);
    expect(text()).toContain('ARCA SIN VERIFICAR');

    if (early) {
      health[0]?.resolve('con-problemas');
    }

    flow.resolve();
    await seen('Emitir nota de crédito');
    health[0]?.resolve('con-problemas');
    await pause(50);
    await press(ENTER);
    expect(text()).not.toMatch(/ARCA con problemas/i);
  });

  it('si el resultado llega con el menú ya abierto otra vez, avisa ahí, sin duplicar nada', async () => {
    start();
    await seen(PENDING);
    await press(ENTER);
    await seen('Emitir nota de crédito');
    await press(DOWN);
    health[0]?.resolve('sin-respuesta');
    await seen('ARCA sin respuesta');
    expect(marked()).toEqual(['Emitir recibo (nuevo)']);
    expect(count(/Emitir nota de crédito/g)).toBe(1);

    await press(ESCAPE);
    await run;
    expect(count(/ARCA sin respuesta/g)).toBe(1);
  });

  it('la versión que llega con un flujo abierto aparece en el próximo menú', async () => {
    const flow = openInvoice();

    start();
    await seen(PENDING);
    await press(ENTER);

    const before = writes;

    update.resolve(UPDATE);
    await pause();
    expect(writes).toBe(before);

    flow.resolve();
    await seen(UPDATE_ROW);
  });
});

describe('la versión nueva llega con el menú abierto (TUI-49)', () => {
  async function arrive(): Promise<void> {
    update.resolve(UPDATE);
    await pause();
  }

  it('aparece arriba de todo y la marcada no cambia', async () => {
    start();
    await seen(PENDING);
    await arrive();
    await seen(UPDATE_ROW);
    expectOneMenu();
    expect(marked()).toEqual(['Emitir factura']);

    const lines = terminal.screen();

    expect(lines[lines.findIndex((line) => line.includes('Emitir factura')) - 2]).toContain(UPDATE_ROW);
    await press(ENTER);
    expect(runInvoiceFlow).toHaveBeenCalledTimes(1);
    expect(runUpdateFlow).not.toHaveBeenCalled();
  });

  it('se llega con las flechas y Enter la elige', async () => {
    start();
    await seen(PENDING);
    await arrive();
    await press(UP);
    expect(marked()).toEqual([UPDATE_ROW]);
    await press(ENTER);
    expect(runUpdateFlow).toHaveBeenCalledWith(UPDATE);
    expect(text()).toContain(`✔ ¿Qué querés hacer? ${UPDATE_ROW}`);
  });

  it('con un filtro que la incluye entre otras, aparece sin marcarse', async () => {
    start();
    await seen(PENDING);
    // "ac" deja "Emitir factura", "Estado de ARCA"… y la de actualizar.
    await press('a', 'c', DOWN);

    const row = marked();

    expect(row).toHaveLength(1);
    await arrive();
    await seen(UPDATE_ROW);
    expect(screen()).toContain('Filtrar: ac');
    expect(marked()).toEqual(row);
  });

  it('con un filtro que solo la incluye a ella, no se marca sola y Enter no elige nada', async () => {
    start();
    await seen(PENDING);
    await press('a', 'c', 't', 'u', 'a');
    expect(screen()).toContain('Nada coincide');
    await arrive();
    await seen(UPDATE_ROW);
    expect(screen()).not.toContain('Nada coincide');
    expect(marked()).toEqual([]);
    await press(ENTER);
    expect(runUpdateFlow).not.toHaveBeenCalled();
    expect(screen()).toContain('Filtrar: actua');
    await press(DOWN, ENTER);
    expect(runUpdateFlow).toHaveBeenCalledTimes(1);
  });

  it('con un filtro que no la incluye, no se ve hasta borrarlo', async () => {
    start();
    await seen(PENDING);
    await press('d');
    await arrive();
    expect(screen()).not.toContain(UPDATE_ROW);
    expect(marked()).toEqual(['Emitir nota de crédito']);
    await press(BACKSPACE);
    await seen(UPDATE_ROW);
    expect(marked()).toEqual(['Emitir nota de crédito']);
    await press(ENTER);
    expect(runNoteFlow).toHaveBeenCalledTimes(1);
  });

  it('con un filtro sin coincidencias, al borrarlo queda marcada la de siempre', async () => {
    start();
    await seen(PENDING);
    await press('z', 'z', 'z');
    expect(screen()).toContain('Nada coincide');
    await arrive();
    await press(BACKSPACE, BACKSPACE, BACKSPACE);
    await seen(UPDATE_ROW);
    expect(marked()).toEqual(['Emitir factura']);
    await press(ENTER);
    expect(runInvoiceFlow).toHaveBeenCalledTimes(1);
    expect(runUpdateFlow).not.toHaveBeenCalled();
  });

  it('al filtrar después, se marca la primera que coincide de las que ya estaban', async () => {
    start();
    await seen(PENDING);
    await press(DOWN);
    await arrive();
    // "a" y "ac" tambien estan en "Actualizar…".
    await press('a');
    expect(screen()).toContain(UPDATE_ROW);
    expect(marked()).toEqual(['Emitir factura']);
    await press('c', ENTER);
    expect(runInvoiceFlow).toHaveBeenCalledTimes(1);
    expect(runUpdateFlow).not.toHaveBeenCalled();
  });

  it('al filtrar después, si es la única que coincide, se marca', async () => {
    start();
    await seen(PENDING);
    await arrive();
    await press('a', 'c', 't', 'u', 'a', 'l');
    expect(marked()).toEqual([UPDATE_ROW]);
  });

  it('con "Salir" marcada, Enter sale', async () => {
    start();
    await seen(PENDING);
    await press(...Array.from({ length: 8 }, () => DOWN));
    expect(marked()).toEqual(['Salir']);
    await arrive();
    await seen(UPDATE_ROW);
    expect(marked()).toEqual(['Salir']);
    await press(ENTER);
    await run;
    expect(runUpdateFlow).not.toHaveBeenCalled();
    expect(text()).toContain('¡Hasta la próxima!');
  });
});

describe('volver de Configuración (TUI-49)', () => {
  const openConfig = () => press('c', 'o', 'n', 'f', 'i', 'g', ENTER);

  it('la barra se rearma sin esperar', async () => {
    start();
    await seen(PENDING);
    await openConfig();
    await vi.waitFor(() => expect(health).toHaveLength(2));
    await seen(PENDING);
    await seen('Emitir nota de crédito');
    health[1]?.resolve('funcionando');
    await seen('ARCA FUNCIONANDO');
    expect(count(/ TESTING /g)).toBe(2);
    expect(text()).not.toContain(PENDING);
  });

  it('con otro entorno, la respuesta vieja no se muestra', async () => {
    vi.mocked(runConfigMenu).mockImplementationOnce(async () => {
      vi.mocked(createInteractiveSession).mockImplementation(
        () => ({ arca: {}, runtime: { ...runtime, environment: 'produccion' } }) as never,
      );
    });
    start();
    await seen(PENDING);
    await openConfig();
    await seen('PRODUCCIÓN');
    health[0]?.resolve('sin-respuesta');
    await pause();
    expect(text()).not.toMatch(/ARCA sin respuesta/i);
    expect(screen()).toMatch(/COMPROBANDO ARCA… ━ PRODUCCIÓN/);
    await press(ENTER);
    expect(text()).not.toMatch(/ARCA sin respuesta/i);
  });

  it('la que llega después de cancelar Configuración, tampoco: pudo cambiar el entorno', async () => {
    vi.mocked(runConfigMenu).mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'ExitPromptError' }));
    start();
    await seen(PENDING);
    await openConfig();
    await seen('Cancelado');
    health[0]?.resolve('sin-respuesta');
    await pause();
    expect(text()).not.toMatch(/ARCA sin respuesta/i);
  });
});

describe('primera configuración y certificados (TUI-49)', () => {
  it('si falta algo y hay sesión, la guía se ofrece sin esperar y la barra se completa', async () => {
    vi.mocked(listMissingSetupKeys).mockImplementationOnce(() => ['puntoVenta']);
    start();
    await seen('Falta completar la configuración');
    expect(screen()).toContain(PENDING);
    health[0]?.resolve('funcionando');
    await seen('ARCA FUNCIONANDO');
    expect(count(/ TESTING /g)).toBe(1);
    expect(count(/Falta completar la configuración/g)).toBe(1);
    await press(DOWN, ENTER);
    await seen('¿Qué querés hacer?');
    expect(runGuidedSetup).not.toHaveBeenCalled();
    expect(count(/ARCA FUNCIONANDO/g)).toBe(1);
  });

  it('sin configuración no consulta ARCA', async () => {
    vi.mocked(createInteractiveSession).mockImplementation(() => {
      throw new Error('Falta el CUIT');
    });
    update.resolve(null);
    start();
    await seen('¿Qué querés hacer?');
    expect(screen()).toMatch(/falta completar la configuración ━+ ARCA SIN VERIFICAR/);
    expect(checkArcaHealth).not.toHaveBeenCalled();
  });

  it('con el certificado vencido no consulta ARCA', async () => {
    vi.mocked(createInteractiveSession).mockImplementation(() => {
      throw new CertificateExpiredError({ ...expiring, expired: true });
    });
    update.resolve(null);
    start();
    await seen('¿Qué querés hacer?');
    expect(screen()).toMatch(/certificado vencido ━+ ARCA SIN VERIFICAR ━ PRODUCCIÓN/);
    expect(checkArcaHealth).not.toHaveBeenCalled();
  });

  it('el recuadro de certificados por vencer queda bajo la barra', async () => {
    vi.mocked(createInteractiveSession).mockImplementation(
      () => ({ arca: {}, runtime: { ...runtime, certificateNotices: [expiring] } }) as never,
    );
    start();
    await seen(PENDING);
    health[0]?.resolve('con-demoras');
    await seen('ARCA CON DEMORAS');

    const lines = terminal.history();
    const bar = lines.findIndex((line) => line.includes('ARCA CON DEMORAS'));
    const box = lines.findIndex((line) => line.includes('vence el 20/11/2026'));

    expect(box).toBeGreaterThan(bar);
    expect(count(/vence el 20\/11\/2026/g)).toBe(1);
    expectOneMenu();
    await press(ESCAPE);
    await run;
    expect(count(/vence el 20\/11\/2026/g)).toBe(1);
  });
});

describe('terminal angosta, baja o ASCII (TUI-49)', () => {
  it('si la barra y el menú no entran en el alto, espera como siempre', async () => {
    resize(100, 18);
    start();
    await pause(50);
    expect(text()).not.toContain('¿Qué querés hacer?');
    health[0]?.resolve('funcionando');
    update.resolve(UPDATE);
    await seen('Emitir factura');
    expect(count(/ARCA FUNCIONANDO/g)).toBe(1);
    expect(text()).not.toContain(PENDING);
    expect(marked()).toEqual([UPDATE_ROW]);
  });

  it('en 80x24 con el recuadro de certificados no entra: espera como siempre', async () => {
    vi.mocked(createInteractiveSession).mockImplementation(
      () => ({ arca: {}, runtime: { ...runtime, certificateNotices: [expiring] } }) as never,
    );
    resize(80, 24);
    start();
    await pause(50);
    expect(text()).not.toContain('¿Qué querés hacer?');
    health[0]?.resolve('funcionando');
    update.resolve(null);
    await seen('Emitir factura');
    expect(count(/ARCA FUNCIONANDO/g)).toBe(1);
    expect(count(/vence el 20\/11\/2026/g)).toBe(1);
  });

  it('en 80x24 no espera y nada se duplica, tampoco con filtro y con la versión', async () => {
    resize(80, 24);
    start();
    await seen(PENDING);
    await press('i');
    health[0]?.resolve('con-problemas');
    update.resolve(UPDATE);
    await seen('ARCA CON PROBLEMAS');
    await press(BACKSPACE, DOWN, DOWN, DOWN, UP);
    expectOneMenu();
    await press(ESCAPE);
    await run;
    expect(text()).not.toContain('Emitir nota');
    expect(count(/ARCA CON PROBLEMAS/g)).toBe(1);
  });

  it('angosta: la barra de dos líneas y las filas cortadas no se duplican', async () => {
    resize(40, 60);
    start();
    await seen(PENDING);
    health[0]?.resolve('con-problemas');
    await seen('ARCA CON PROBLEMAS');
    update.resolve(UPDATE);
    await seen(UPDATE_ROW);
    await press(DOWN, UP, 'n', BACKSPACE);
    expect(count(/ PV 3 /g)).toBe(1);
    expect(count(/¿Qué querés hacer\?/g)).toBe(1);
    expect(count(/Emitir nota de crédito/g)).toBe(1);
    await press(ESCAPE);
    await run;
    expect(text()).not.toContain('Emitir nota');
    expect(count(/ PV 3 /g)).toBe(1);
  });

  it('sin Unicode, "COMPROBANDO ARCA..."', async () => {
    vi.stubEnv('ARCLI_ASCII', '1');

    try {
      start();
      await seen('COMPROBANDO ARCA...');
      expect(text()).not.toContain('…');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('salir con consultas pendientes (TUI-49)', () => {
  it.each<[string, readonly string[]]>([
    ['Salir', [...Array.from({ length: 8 }, () => DOWN), ENTER]],
    ['Esc', [ESCAPE]],
    ['Ctrl+C', [CTRL_C]],
  ])('%s: termina, cancela las consultas y después no escribe', async (_name, keys) => {
    start();
    await seen(PENDING);
    await press(...keys);
    await vi.waitFor(() => expect(ended).toBe(true), { timeout: 700 });
    expect(text()).toMatch(/ARCA SIN VERIFICAR ━ TESTING/);
    expect(text()).toContain('¡Hasta la próxima!');

    const signal = (vi.mocked(checkForUpdate).mock.calls[0]?.[1] as { signal?: AbortSignal } | undefined)?.signal;

    expect(signal?.aborted).toBe(true);

    const before = writes;

    health[0]?.reject(new Error('tarde'));
    update.reject(new Error('tarde'));
    await pause();
    expect(writes).toBe(before);
    expect(unhandled).not.toHaveBeenCalled();
  });
});
