import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CertificateExpiredError,
  type CertificateExpiryNotice,
  inspectConfiguredCertificates,
} from '../../../modules/config/certificate-expiry';
import { type ArcaHealth, checkArcaHealth } from '../../../modules/parameters/health';
import { fetchWsfeServerStatus } from '../../../services/arca/wsfe-status';
import { colorize, stripAnsi } from '../../../ui';
import { createInteractiveSession } from '../session';
import { openStatusHeader } from '../status-header';

vi.mock('../../../modules/config/certificate-expiry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../modules/config/certificate-expiry')>()),
  inspectConfiguredCertificates: vi.fn(),
}));
vi.mock('../../../modules/config/config.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../modules/config/config.service')>()),
  ConfigService: class {
    public close = closeConfig;
    public getConfig = () => ({ cuit: '20333333334' });
  },
}));
vi.mock('../../../modules/parameters/health', () => ({ checkArcaHealth: vi.fn() }));
vi.mock('../../../services/arca/wsfe-status', () => ({ fetchWsfeServerStatus: vi.fn() }));
vi.mock('../session', () => ({ createInteractiveSession: vi.fn() }));

const closeConfig = vi.hoisted(() => vi.fn());

const OK = { app: 'OK', auth: 'OK', db: 'OK' };
const runtime = {
  certificateNotices: [],
  config: {},
  cuit: 20333333334,
  environment: 'testing',
  pointOfSale: 3,
};

let answer: (health: ArcaHealth) => void;

function withRuntime(overrides: object = {}): void {
  vi.mocked(createInteractiveSession).mockReturnValue({ runtime: { ...runtime, ...overrides } } as never);
}

function notice(
  summary: string,
  environment: 'produccion' | 'testing',
  use?: CertificateExpiryNotice['use'],
): CertificateExpiryNotice {
  return { daysRemaining: -1, environment, expired: true, expiresOn: '20/11/2026', message: summary, summary, use };
}

beforeEach(() => {
  vi.stubEnv('NO_COLOR', '');
  vi.stubEnv('FORCE_COLOR', '1');
  withRuntime();
  vi.mocked(checkArcaHealth).mockImplementation(
    () =>
      new Promise((resolve) => {
        answer = resolve;
      }),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

describe('openStatusHeader: la consulta', () => {
  it.each(['testing', 'produccion'] as const)(
    'consulta el FEDummy del entorno de la sesión (%s), con la señal que cancela',
    async (environment) => {
      withRuntime({ environment });
      vi.mocked(fetchWsfeServerStatus).mockResolvedValue(OK);
      vi.mocked(checkArcaHealth).mockImplementation(async ({ gateway, now }) => {
        expect(await gateway.getServerStatus()).toEqual(OK);
        expect(now()).toBeGreaterThan(0);

        return 'funcionando';
      });

      const header = openStatusHeader({});

      await header.query?.settled;
      expect(header.query?.value()).toBe('funcionando');
      expect(fetchWsfeServerStatus).toHaveBeenCalledExactlyOnceWith(environment, expect.any(AbortSignal));

      const signal = vi.mocked(fetchWsfeServerStatus).mock.calls[0]?.[1];

      expect(signal?.aborted).toBe(false);
      header.cancel();
      expect(signal?.aborted).toBe(true);
    },
  );

  it('sin sesión no consulta y cancelar no hace nada', () => {
    vi.mocked(createInteractiveSession).mockImplementation(() => {
      throw new Error('Falta el CUIT');
    });

    const header = openStatusHeader({});

    header.cancel();
    expect(header.query).toBeUndefined();
    expect(checkArcaHealth).not.toHaveBeenCalled();
    expect(header.text()).toContain(colorize('ARCA SIN VERIFICAR', 'muted'));
  });
});

describe('openStatusHeader: colores', () => {
  it('cada entorno tiene el suyo', () => {
    expect(openStatusHeader({}).text()).toContain(colorize('TESTING', 'testing'));
    withRuntime({ environment: 'produccion' });
    expect(openStatusHeader({}).text()).toContain(colorize('PRODUCCIÓN', 'production'));
    expect(colorize('x', 'testing')).not.toBe(colorize('x', 'production'));
  });

  it('lo que no se sabe va en muted', () => {
    const header = openStatusHeader({});

    expect(header.text()).toContain(colorize('COMPROBANDO ARCA', 'muted'));
    expect(header.settle()).toContain(colorize('ARCA SIN VERIFICAR', 'muted'));
  });

  it.each<[ArcaHealth, string, 'danger' | 'success' | 'warning']>([
    ['funcionando', 'ARCA FUNCIONANDO', 'success'],
    ['con-demoras', 'ARCA CON DEMORAS', 'warning'],
    ['con-problemas', 'ARCA CON PROBLEMAS', 'danger'],
    ['sin-respuesta', 'ARCA SIN RESPUESTA', 'danger'],
  ])('%s', async (health, label, color) => {
    const header = openStatusHeader({});

    answer(health);
    await header.query?.settled;
    expect(header.text()).toContain(colorize(label, color));
  });

  it('una razón social con secuencias de la terminal no las escribe', () => {
    withRuntime({ config: { emisor: { razonSocial: 'A\u001B[2JB' } } });
    expect(stripAnsi(openStatusHeader({}).text())).toContain(' AB ');
    expect(openStatusHeader({}).text()).not.toContain('\u001B[2J');
  });
});

describe('openStatusHeader: certificado activo vencido', () => {
  const active = notice('Venció el de testing.', 'testing');

  beforeEach(() => {
    vi.mocked(createInteractiveSession).mockImplementation(() => {
      throw new CertificateExpiredError(active);
    });
  });

  it('suma los de otro entorno y otro uso, sin repetir el activo', () => {
    vi.mocked(inspectConfiguredCertificates).mockReturnValue([
      notice('Otra lectura del mismo.', 'testing'),
      notice('Venció el de producción.', 'produccion'),
      notice('Venció el de exportación.', 'testing', 'exportacion'),
    ]);

    const text = stripAnsi(openStatusHeader({}).text());

    expect(text).toMatch(/certificado vencido .* ARCA SIN VERIFICAR ━ TESTING/);
    expect(text.indexOf('Venció el de testing.')).toBeGreaterThan(text.indexOf('TESTING'));
    expect(text).toContain('Venció el de producción.');
    expect(text).toContain('Venció el de exportación.');
    expect(text).not.toContain('Otra lectura del mismo.');
    expect(inspectConfiguredCertificates).toHaveBeenCalledWith(
      { cuit: '20333333334' },
      { activeEnvironment: 'testing', now: expect.any(Date) as Date },
    );
    expect(closeConfig).toHaveBeenCalledTimes(1);
  });

  it('si no se pueden leer, queda solo el activo', () => {
    vi.mocked(inspectConfiguredCertificates).mockImplementation(() => {
      throw new Error('ilegible');
    });

    expect(stripAnsi(openStatusHeader({}).text())).toContain('Venció el de testing.');
    expect(closeConfig).toHaveBeenCalledTimes(1);
  });
});

describe('openStatusHeader: lo que queda en el historial y el aviso tardío', () => {
  it('con el resultado a tiempo no debe nada', async () => {
    const header = openStatusHeader({}, '\n');

    answer('con-problemas');
    await header.query?.settled;
    expect(header.settled()).toBe(false);
    expect(stripAnsi(header.settle())).toMatch(/^\n━━ .* ARCA CON PROBLEMAS ━ TESTING ━━$/);
    expect(header.settled()).toBe(true);
    expect([header.text(), header.settle(), header.possibleTexts()]).toEqual(['', '', []]);
  });

  it('con un resultado malo después, lo avisa hasta que queda escrito, y una sola vez', async () => {
    const header = openStatusHeader({});

    header.settle();
    expect([header.text(), header.settle()]).toEqual(['', '']);
    answer('con-demoras');
    await header.query?.settled;

    const text = header.text();

    expect(stripAnsi(text)).toContain('ARCA con demoras. Para más detalle, elegí "Estado de ARCA" en el menú.');
    expect(text.startsWith('\n')).toBe(true);
    expect(text).toContain(colorize('ARCA con demoras', 'warning').split('demoras')[0]);
    expect(header.possibleTexts()).toContain(text);
    expect(header.settle()).toBe(text);
    expect([header.text(), header.settle(), header.possibleTexts()]).toEqual(['', '', []]);
  });

  it('con uno bueno después, nada', async () => {
    const header = openStatusHeader({});

    header.settle();
    answer('funcionando');
    await header.query?.settled;
    expect([header.text(), header.settle()]).toEqual(['', '']);
  });

  it('descartado, nada', async () => {
    const header = openStatusHeader({});

    header.settle();
    header.dismissResult();
    answer('sin-respuesta');
    await header.query?.settled;
    expect([header.text(), header.settle(), header.possibleTexts()]).toEqual(['', '', []]);
  });

  it('antes de quedar, puede decir cada estado', () => {
    const texts = openStatusHeader({})
      .possibleTexts()
      .map((text) => stripAnsi(text).match(/(COMPROBANDO ARCA|ARCA [A-Z ]+?) ━/)?.[1]);

    expect(texts.toSorted()).toEqual([
      'ARCA CON DEMORAS',
      'ARCA CON PROBLEMAS',
      'ARCA FUNCIONANDO',
      'ARCA SIN RESPUESTA',
      'ARCA SIN VERIFICAR',
      'COMPROBANDO ARCA',
    ]);
  });
});
