import { describe, expect, it, type Mock, vi } from 'vitest';

import { fetchMonotributoPage } from '../../../modules/monotributo/monotributo.source';
import { fetchWsfeServerStatus } from '../../../services/arca/wsfe-status';
import { CLIENT_CUIT, CLOCK_CONFIG, sdk } from '../../__tests__/clock.fixture';
import { REPEATED_SIGNAL_MS } from '../../interruption';

import {
  type CtrlC,
  ctrlCDuring,
  EXIT,
  MENU,
  plain,
  runMenu,
  SERVERS_OK,
  signalListeners,
  sinceMenu,
  useAssistantInterruptionFixture,
} from './assistant-interruption.fixture';
import { spinning } from './fake-ora';
import { DO_NOT_EMIT, EMIT, FC_STEPS, FE_STEPS, NO_OPTIONALS, over, TO_INVOICE } from './one-path.fixture';
import { ctrlC, type Steps } from './one-path.prompts';
import { singleExportItem } from './script';

/**
 * ARQ-11 PR 5: Ctrl+C mientras el asistente espera una consulta a ARCA. Vuelve enseguida al menu, con el spinner
 * frenado; lo que ARCA conteste despues no se escribe; los listeners de las señales quedan como estaban. En Consultas,
 * Estado de ARCA y Configuracion dice "Cancelado."; en los flujos que emiten, "Cancelado. No se emitió nada.". Una por
 * cada espera a la que se llega con poco guion; las de emitir, en `interrupted-assistant.test.ts`.
 */
vi.mock('@arcasdk/core', async (original) =>
  (await import('../../__tests__/clock.fixture')).fakeArcaSdk(await original<Record<string, unknown>>()),
);
vi.mock('../prompts', async (original) =>
  (await import('./one-path.prompts')).scriptedPrompts(await original<typeof import('../prompts')>()),
);
vi.mock('ora', async () => (await import('./fake-ora')).fakeOra());
vi.mock('../../../services/arca/wsfe-status', async () => ({
  fetchWsfeServerStatus: vi.fn(async () => ({ app: 'OK', auth: 'OK', db: 'OK' })),
}));
vi.mock('../../../services/arca/wsfex-status', async () => ({
  fetchWsfexServerStatus: vi.fn(async () => ({ app: 'OK', auth: 'OK', db: 'OK' })),
}));
// Sin red: la pagina publica del monotributo no contesta y se usa la tabla que trae arcli.
vi.mock('../../../modules/monotributo/monotributo.source', async (original) => ({
  ...(await original<typeof import('../../../modules/monotributo/monotributo.source')>()),
  fetchMonotributoPage: vi.fn(async () => {
    throw new Error('sin red');
  }),
}));

const profile = useAssistantInterruptionFixture();

/** Fuera de los flujos que emiten (decision 2 del 26/11). */
const QUERY_CANCELLED = 'Cancelado.';
const EMISSION_CANCELLED = 'Cancelado. No se emitió nada.';
const CUIT = String(CLIENT_CUIT);

interface Wait {
  readonly config?: Record<string, unknown>;
  readonly mock: () => Mock;
  readonly name: string;
  readonly notice: typeof EMISSION_CANCELLED | typeof QUERY_CANCELLED;
  readonly options?: CtrlC;
  /** Desde el menu hasta la ultima respuesta antes de la consulta. */
  readonly steps: Steps;
}

const CONSULTAS = [MENU, 'Consultas'] as const;
const QUERY = /Qué querés consultar/;
const INVOICE = [MENU, 'Emitir factura'] as const;
const FC_USD: Steps = [
  INVOICE,
  ...FC_STEPS.slice(0, -1),
  [/Agregamos/, ['Moneda']],
  [/Moneda del comprobante/, 'Dólares'],
  [/Cómo te pagan/, 'En dólares'],
  [/Monto total en USD/, '1000'],
  [/Agregamos/, ['Moneda']],
  [/Moneda del comprobante/, 'Dólares'],
  [/Cómo te pagan/, 'En dólares'],
];
const FE_GOODS: Steps = [
  INVOICE,
  ...FE_STEPS.slice(0, 5),
  [/Qué exportás/, 'Bienes'],
  [/Moneda del comprobante/, 'Pesos'],
  ...singleExportItem('100', 'Caja'),
];
const PERMIT = '26001EC01000123A';

const WAITS: readonly Wait[] = [
  {
    mock: () => sdk.wsfe.getServerStatus,
    name: 'Estado de ARCA',
    notice: QUERY_CANCELLED,
    steps: [[MENU, 'Estado de ARCA']],
  },
  {
    mock: () => sdk.padron.getTaxpayerDetails,
    name: 'Consultas: datos de un CUIT',
    notice: QUERY_CANCELLED,
    steps: [CONSULTAS, [QUERY, 'Datos de un CUIT'], [/CUIT a consultar/, CUIT]],
  },
  {
    mock: () => sdk.wsfecred.consultarMontoObligadoRecepcion,
    name: 'Consultas: si un cliente recibe FCE',
    notice: QUERY_CANCELLED,
    steps: [CONSULTAS, [QUERY, 'Si un cliente recibe FCE'], [/CUIT del cliente/, CUIT]],
  },
  {
    mock: () => sdk.wsfe.getLastVoucher,
    name: 'Consultas: mis comprobantes',
    notice: QUERY_CANCELLED,
    steps: [CONSULTAS, [QUERY, 'Mis comprobantes'], [/Qué comprobantes querés consultar/, 'Factura C']],
  },
  {
    mock: () => sdk.wsfe.getCurrencyTypes,
    name: 'Consultas: la tabla de monedas',
    notice: QUERY_CANCELLED,
    steps: [CONSULTAS, [QUERY, 'Monedas y cotizaciones']],
  },
  {
    mock: () => sdk.wsfe.getQuotation,
    name: 'Consultas: una cotización',
    notice: QUERY_CANCELLED,
    steps: [CONSULTAS, [QUERY, 'Monedas y cotizaciones'], [/De qué moneda/, 'Dólar']],
  },
  {
    mock: () => sdk.wsfe.getSalesPoints,
    name: 'Consultas: una tabla de ARCA',
    notice: QUERY_CANCELLED,
    steps: [CONSULTAS, [QUERY, 'Tablas de ARCA'], [/Qué tabla/, 'Puntos de venta']],
  },
  {
    mock: () => vi.mocked(fetchMonotributoPage) as unknown as Mock,
    name: 'Consultas: la tabla del monotributo',
    notice: QUERY_CANCELLED,
    steps: [CONSULTAS, [QUERY, 'Categorías del monotributo']],
  },
  {
    mock: () => sdk.wsfex.getParamActividades,
    name: 'Configuración: las actividades de WSFEX',
    notice: QUERY_CANCELLED,
    steps: [
      [MENU, 'Configuración'],
      [/^Configuración/, 'Modificar configuración'],
      [/Qué querés modificar/, 'Actividad de exportación'],
    ],
  },
  {
    config: { consultarPadron: true },
    mock: () => sdk.padron.getTaxpayerDetails,
    name: 'Factura A: el padrón del receptor',
    notice: EMISSION_CANCELLED,
    steps: [INVOICE, [/comprobante/, 'Factura A'], [/A quién/, 'Con CUIT'], [/CUIT del receptor/, CUIT]],
  },
  {
    mock: () => sdk.wsfe.getQuotation,
    name: 'Factura C en dólares: la cotización oficial',
    notice: EMISSION_CANCELLED,
    // Apenas se sabe como te pagan: la sugerencia y el tope del consumidor final.
    steps: FC_USD.slice(0, 8),
  },
  {
    mock: () => sdk.wsfe.getQuotation,
    name: 'Factura C en dólares: la vista previa',
    notice: EMISSION_CANCELLED,
    options: { call: 2 },
    steps: FC_USD,
  },
  {
    mock: () => sdk.wsfe.getLastVoucher,
    name: 'Nota de crédito C: el selector de la factura',
    notice: EMISSION_CANCELLED,
    steps: [[MENU, 'Emitir nota de crédito'], ...over('Factura C', TO_INVOICE).slice(0, -1)],
  },
  {
    mock: () => sdk.wsfe.getLastVoucher,
    name: 'Repetir: el selector',
    notice: EMISSION_CANCELLED,
    steps: [
      [MENU, 'Repetir un comprobante anterior'],
      [/Qué comprobante querés repetir/, 'Factura C'],
    ],
  },
  {
    mock: () => sdk.wsfex.getParamDstPais,
    name: 'Factura E: las tablas',
    notice: EMISSION_CANCELLED,
    steps: [INVOICE, [/comprobante/, 'Factura de exportación E']],
  },
  {
    mock: () => sdk.wsfex.getParamMon,
    name: 'Factura E: las monedas',
    notice: EMISSION_CANCELLED,
    steps: [INVOICE, ...FE_STEPS.slice(0, 6)],
  },
  {
    mock: () => sdk.wsfex.getParamUMed,
    name: 'Factura E: las unidades',
    notice: EMISSION_CANCELLED,
    steps: [INVOICE, ...FE_STEPS.slice(0, 7)],
  },
  {
    mock: () => sdk.wsfex.getParamIncoterms,
    name: 'Factura E de bienes: los incoterms',
    notice: EMISSION_CANCELLED,
    steps: FE_GOODS,
  },
  {
    mock: () => sdk.wsfex.checkPermiso,
    name: 'Factura E de bienes: el permiso de embarque',
    notice: EMISSION_CANCELLED,
    steps: [
      ...FE_GOODS,
      [/Incoterm/, 'FOB'],
      [/Permisos de embarque/, PERMIT],
      [/Forma de pago/, 'Transferencia Internacional'],
      NO_OPTIONALS,
    ],
  },
  {
    mock: () => sdk.wsfex.getParamIdiomas,
    name: 'Factura E: los idiomas',
    notice: EMISSION_CANCELLED,
    steps: [INVOICE, ...FE_STEPS.slice(0, -1), [/Agregamos/, ['Idioma']]],
  },
  {
    mock: () => sdk.wsfex.getCmp,
    name: 'Nota de crédito E: la factura asociada',
    notice: EMISSION_CANCELLED,
    steps: [
      [MENU, 'Emitir nota de crédito'],
      [/Sobre qué comprobante/, 'Facturas'],
      [/Qué factura\?/, 'Factura de exportación E'],
      [/Punto de venta de la factura E/, '3'],
      [/Número de la factura E/, '1'],
    ],
  },
];

function prepare(wait: Pick<Wait, 'config'>): void {
  profile.writeConfig(profile.configWith(profile.healthy, { ...CLOCK_CONFIG, ...wait.config }));
}

describe.each(WAITS)('$name', (wait) => {
  it('sin señales: la consulta llega justo después de la última respuesta del guion', async () => {
    let asked = 0;
    let askedAtCall: number | undefined;

    prepare(wait);
    ctrlCDuring(wait.mock(), {
      ...wait.options,
      onReach: () => {
        askedAtCall = asked;
      },
      times: 0,
    });
    // Despues de la consulta, la pregunta que siga se corta: aca solo importa cuando se consulto.
    await runMenu(wait.steps, {
      onAsk: () => {
        asked += 1;

        if (asked > wait.steps.length) {
          throw ctrlC();
        }
      },
    });

    expect(askedAtCall).toBe(wait.steps.length);
  });

  it('Ctrl+C vuelve enseguida al menú, con el spinner frenado, y lo que ARCA conteste después no se escribe', async () => {
    const listeners = signalListeners();

    prepare(wait);

    const pending = ctrlCDuring(wait.mock(), wait.options);
    const run = await runMenu([...wait.steps, EXIT], { pending });
    const shown = plain(sinceMenu(run, 1));

    expect(pending.reached(), 'nunca llegó a la consulta').toBe(true);
    expect(run.menus[1]?.answered, 'esperó a ARCA antes de volver al menú').toBe(false);
    expect(shown).toContain(wait.notice);

    if (wait.notice === QUERY_CANCELLED) {
      expect(shown).not.toContain(EMISSION_CANCELLED);
    }

    expect(run.menus[1]?.spinning).toEqual([]);
    expect(run.error).toBeUndefined();
    expect(run.asked).toHaveLength(wait.steps.length + 1);
    expect(run.late).toBe('');
    expect(process.kill).not.toHaveBeenCalled();
    expect([sdk.wsfe.createVoucher, sdk.wsfex.authorize].flatMap((emit) => emit.mock.calls)).toEqual([]);
    await vi.waitFor(() => expect(signalListeners()).toEqual(listeners), { timeout: REPEATED_SIGNAL_MS * 3 });
  });
});

const STATUS = WAITS[0] as Wait;

describe('las señales mientras se consulta', () => {
  it('SIGTERM no se ataja: nadie más la escucha mientras se espera', async () => {
    const listeners = signalListeners();
    let whileWaiting: ReturnType<typeof signalListeners> | undefined;

    prepare(STATUS);
    ctrlCDuring(STATUS.mock(), {
      onReach: () => {
        whileWaiting = signalListeners();
      },
      times: 0,
    });
    await runMenu([...STATUS.steps, EXIT]);

    expect(whileWaiting?.SIGTERM).toEqual(listeners.SIGTERM);
  });

  it('eco de npx: dos Ctrl+C seguidos cancelan una vez, y otro en el menú dentro del eco no hace nada', async () => {
    let echoed = false;

    prepare(STATUS);

    const pending = ctrlCDuring(STATUS.mock(), { gap: REPEATED_SIGNAL_MS / 5, times: 2 });
    const run = await runMenu([...STATUS.steps, EXIT], {
      onAsk: (message) => {
        // La terminal tambien se la manda a npm, que la reenvia: llega con el menu ya abierto.
        if (MENU.test(message) && pending.reached() && !echoed) {
          echoed = true;
          process.emit('SIGINT', 'SIGINT');
        }
      },
      pending,
    });
    const shown = plain(sinceMenu(run, 1));

    expect(run.menus[1]?.answered, 'esperó a ARCA antes de volver al menú').toBe(false);
    expect(shown.split(QUERY_CANCELLED)).toHaveLength(2);
    expect(echoed).toBe(true);
    expect(run.error).toBeUndefined();
    expect(run.asked).toHaveLength(STATUS.steps.length + 1);
    expect(process.kill).not.toHaveBeenCalled();
  });

  it('al arrancar, Ctrl+C mientras se espera la barra la deja sin verificar y muestra el menú', async () => {
    const rows = process.stdout.rows;

    // Sin lugar para completarla con el menu abierto: se espera con spinner antes de dibujarlo.
    process.stdout.rows = 10;

    try {
      const pending = ctrlCDuring(vi.mocked(fetchWsfeServerStatus) as unknown as Mock, {
        until: () => spinning().length > 0,
      });
      const run = await runMenu([EXIT], { pending });
      const beforeMenu = plain(run.menus[0]?.written ?? '');

      expect(pending.reached(), 'nunca consultó el estado').toBe(true);
      expect(run.menus[0]?.answered, 'esperó a ARCA antes de mostrar el menú').toBe(false);
      expect(beforeMenu).toContain('ARCA SIN VERIFICAR');
      expect(beforeMenu).not.toContain('Cancelado');
      expect(run.menus[0]?.spinning).toEqual([]);
      expect(run.error).toBeUndefined();
      expect(process.kill).not.toHaveBeenCalled();
    } finally {
      process.stdout.rows = rows;
    }
  });
});

describe('una cancelación no se toma como una consulta que falló', () => {
  const byName = (name: string) => WAITS.find((wait) => wait.name.startsWith(name)) as Wait;

  it('el permiso de embarque: vuelve al menú sin el aviso de que no se pudo verificar', async () => {
    const wait = byName('Factura E de bienes: el permiso');

    prepare(wait);

    const pending = ctrlCDuring(wait.mock());
    const run = await runMenu([...wait.steps, EXIT], { pending });

    expect(pending.reached(), 'nunca verificó el permiso').toBe(true);
    expect(plain(run.output + run.late)).not.toContain(`No se pudo verificar el permiso de embarque ${PERMIT}`);
    expect(plain(sinceMenu(run, 1))).toContain(EMISSION_CANCELLED);
    expect(run.asked).toHaveLength(wait.steps.length + 1);
  });

  it('la cotización oficial: vuelve al menú y la próxima factura la vuelve a pedir', async () => {
    const wait = byName('Factura C en dólares: la cotización');

    prepare(wait);

    const pending = ctrlCDuring(wait.mock());
    const run = await runMenu([...wait.steps, ...FC_USD, DO_NOT_EMIT, EXIT], { pending });

    expect(pending.reached(), 'nunca pidió la cotización').toBe(true);
    expect(run.menus[1]?.answered, 'esperó a ARCA antes de volver al menú').toBe(false);
    expect(plain(sinceMenu(run, 1))).toContain(EMISSION_CANCELLED);
    expect(run.error).toBeUndefined();
    // La cortada, y en la segunda factura la del tope y la de la vista previa.
    expect(sdk.wsfe.getQuotation).toHaveBeenCalledTimes(3);
    expect(sdk.wsfe.createVoucher).not.toHaveBeenCalled();
  });

  it('sin señales, la factura en dólares pide la cotización dos veces: la del tope y la de la vista previa', async () => {
    prepare({});

    const run = await runMenu([...FC_USD, EMIT, EXIT]);

    expect(run.error).toBeUndefined();
    expect(sdk.wsfe.getQuotation).toHaveBeenCalledTimes(2);
  });

  it('sin señales, el padrón del receptor sigue con la condición frente al IVA', async () => {
    const wait = byName('Factura A: el padrón');

    prepare(wait);
    sdk.padron.getTaxpayerDetails.mockResolvedValue(SERVERS_OK);

    const run = await runMenu([
      ...wait.steps,
      [/Condición frente al IVA/, 'Responsable inscripto'],
      [/Qué estás facturando/, 'Servicios'],
      [/Monto total/, '1000'],
      NO_OPTIONALS,
      EMIT,
      EXIT,
    ]);

    expect(run.error).toBeUndefined();
    expect(sdk.padron.getTaxpayerDetails).toHaveBeenCalledOnce();
  });
});
