import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CertificateExpiredError } from '../../modules/config/certificate-expiry';
import { MISSING_CUIT_MESSAGE } from '../../modules/config/config.schemas';
import { ConfigService } from '../../modules/config/config.service';
import { getConfigField } from '../../modules/interactive/config-fields';
import { ArcaExportGateway } from '../../services/arca/arca-export.gateway';
import { stripAnsi } from '../../ui';
import { buildRuntimeChecks } from '../commands/config.command';
import { configFieldLists } from '../interactive/config-lists';
import { createInteractiveSession } from '../interactive/session';
import { createProgram } from '../program';

import { PROFILE_CUIT, useArcaProfileFixture } from './arca-profile.fixture';

/**
 * Caracterizacion de las otras entradas del perfil de ARCA (REV-48): la sesion del asistente, las listas de la
 * config, `arcli monotributo` y la validacion de `config revisar`. Fijan lo que se ve hoy (runtime, avisos, errores
 * y mensajes) sin entrar por la clase que resuelve el perfil por dentro: el refactor la reemplaza.
 */

// Ningun test llega a ARCA: el cliente del SDK es un doble que solo registra con que contexto se creo.
const Arca = vi.hoisted(() => vi.fn());

vi.mock('@arcasdk/core', async (original) => ({
  ...(await original<typeof import('@arcasdk/core')>()),
  Arca,
}));

vi.mock('../spinner', () => ({ startSpinner: () => null, withSpinner: (_text: unknown, run: () => unknown) => run() }));

// La pagina de categorias del monotributo es publica y no usa el perfil: sin red, queda la tabla incluida.
vi.mock('../../modules/monotributo/monotributo.source', () => ({
  fetchMonotributoPage: async () => ({ ok: false, reason: 'sin-conexion' }),
}));

const profile = useArcaProfileFixture();
const BOTH_FLAGS_MESSAGE = 'Usá `--testing` o `--produccion`, pero no ambos a la vez.';

beforeEach(() => {
  Arca.mockClear();
});

describe('sesion de ARCA del asistente (createInteractiveSession)', () => {
  it('recibe el runtime completo del perfil y crea el cliente con su contexto', () => {
    profile.writeConfig(profile.configWith(profile.healthy, { puntoVentaPorDefecto: 7 }));

    const session = createInteractiveSession({});

    expect(session.runtime).toMatchObject({
      certificateNotices: [],
      environment: 'testing',
      outputJson: false,
      outputRaw: false,
      pointOfSale: 7,
    });
    expect(session.runtime.config.cuit).toBe(PROFILE_CUIT);
    expect(session.runtime.context).toMatchObject({
      cert: profile.healthy.pem,
      cuit: 20123456786,
      production: false,
      ticketPath: join(profile.configDirectory, 'tickets'),
    });
    expect(Arca).toHaveBeenCalledWith(session.runtime.context);
  });

  it('respeta los flags de entorno y de salida', () => {
    profile.writeConfig(
      profile.configWith(profile.healthy, {
        cert: { produccion: profile.other.certPath, testing: profile.healthy.certPath },
        key: { produccion: profile.other.keyPath, testing: profile.healthy.keyPath },
      }),
    );

    const session = createInteractiveSession({ bruto: true, json: true, produccion: true });

    expect(session.runtime).toMatchObject({ environment: 'produccion', outputJson: true, outputRaw: true });
    expect(session.runtime.context).toMatchObject({ cert: profile.other.pem, production: true });
  });

  it('con el certificado por vencer no escribe el aviso: lo deja en el runtime para la barra del asistente', () => {
    profile.writeConfig(profile.configWith(profile.expiring));

    const session = createInteractiveSession({});

    expect(session.runtime.certificateExpiry).toMatchObject({ environment: 'testing', expired: false });
    // Los dos entornos usan el mismo certificado: un aviso por entorno, el activo primero.
    expect(session.runtime.certificateNotices).toEqual([
      expect.objectContaining({ environment: 'testing', expired: false }),
      expect.objectContaining({ environment: 'produccion', expired: false }),
    ]);
    expect(profile.stdout + profile.stderr).toBe('');
  });

  it('con el certificado vencido corta con CertificateExpiredError, sin crear el cliente ni escribir nada', () => {
    profile.writeConfig(profile.configWith(profile.expiring));
    profile.moveClockAfterExpiry(profile.expiring, 5);

    expect(() => createInteractiveSession({})).toThrow(CertificateExpiredError);
    expect(Arca).not.toHaveBeenCalled();
    expect(profile.stdout + profile.stderr).toBe('');
  });

  it.each([
    ['sin CUIT', { cert: { testing: 'x' }, key: { testing: 'x' } }, MISSING_CUIT_MESSAGE],
    [
      'sin certificado',
      { cuit: PROFILE_CUIT },
      'Falta la ruta del certificado para testing. Configurala con `arcli config establecer cert.testing <ruta>`.',
    ],
  ])('con la config incompleta (%s) da el error de configuracion de siempre', (_case, config, message) => {
    profile.writeConfig(config);

    expect(() => createInteractiveSession({})).toThrow(
      expect.objectContaining({ code: 'CONFIGURATION_ERROR', message }),
    );
    expect(Arca).not.toHaveBeenCalled();
  });

  it('--testing y --produccion juntos: INPUT_VALIDATION_ERROR (REV-58)', () => {
    profile.writeConfig(profile.configWith(profile.healthy));

    expect(() => createInteractiveSession({ produccion: true, testing: true })).toThrow(
      expect.objectContaining({ code: 'INPUT_VALIDATION_ERROR', message: BOTH_FLAGS_MESSAGE }),
    );
  });
});

describe('listas de la config: actividades de WSFEX (configFieldLists)', () => {
  const ACTIVITY = getConfigField('exportacion.actividad');
  const FALLBACK = 'No se pudo consultar la tabla de actividades de WSFEX: escribí el código.';

  function spyActivities() {
    return vi
      .spyOn(ArcaExportGateway.prototype, 'getActivities')
      .mockResolvedValue([{ id: 620100, name: 'SERVICIOS DE CONSULTORES EN INFORMATICA' }]);
  }

  it('con un perfil valido consulta la tabla con el contexto del perfil y la devuelve como lista', async () => {
    const getActivities = spyActivities();

    profile.writeConfig(profile.configWith(profile.healthy));

    const list = await configFieldLists().of(ACTIVITY);

    expect(getActivities).toHaveBeenCalledTimes(1);
    expect(Arca).toHaveBeenCalledWith(expect.objectContaining({ cert: profile.healthy.pem, production: false }));
    expect(list?.rows).toEqual([expect.objectContaining({ value: '620100' })]);
  });

  it('usa los flags de entorno que recibe', async () => {
    spyActivities();
    profile.writeConfig(
      profile.configWith(profile.healthy, {
        cert: { produccion: profile.other.certPath, testing: profile.healthy.certPath },
        key: { produccion: profile.other.keyPath, testing: profile.healthy.keyPath },
      }),
    );

    await configFieldLists({ produccion: true }).of(ACTIVITY);

    expect(Arca).toHaveBeenCalledWith(expect.objectContaining({ cert: profile.other.pem, production: true }));
  });

  it('con el certificado por vencer consulta igual y no escribe el aviso del certificado', async () => {
    spyActivities();
    profile.writeConfig(profile.configWith(profile.expiring));

    const list = await configFieldLists().of(ACTIVITY);

    expect(list?.rows).toHaveLength(1);
    expect(profile.stdout + profile.stderr).toBe('');
  });

  it.each([
    ['sin certificado', () => ({ cuit: PROFILE_CUIT })],
    ['sin CUIT', () => ({ cert: { testing: profile.healthy.certPath }, key: { testing: profile.healthy.keyPath } })],
    ['con --testing y --produccion', () => profile.configWith(profile.healthy)],
  ])('si el perfil falla (%s) la actividad se escribe: undefined y un aviso, sin romper', async (name, config) => {
    const getActivities = spyActivities();

    profile.writeConfig(config());

    const flags = name === 'con --testing y --produccion' ? { produccion: true, testing: true } : {};
    const list = await configFieldLists(flags).of(ACTIVITY);

    expect(list).toBeUndefined();
    expect(getActivities).not.toHaveBeenCalled();
    expect(Arca).not.toHaveBeenCalled();
    expect(stripAnsi(profile.stdout)).toContain(FALLBACK);
    expect(profile.stderr).toBe('');
  });

  it('con el certificado vencido tambien cae a escribirla, sin el aviso del certificado', async () => {
    const getActivities = spyActivities();

    profile.writeConfig(profile.configWith(profile.expiring));
    profile.moveClockAfterExpiry(profile.expiring, 5);

    expect(await configFieldLists().of(ACTIVITY)).toBeUndefined();
    expect(getActivities).not.toHaveBeenCalled();
    expect(stripAnsi(profile.stdout)).toContain(FALLBACK);
    expect(stripAnsi(profile.stdout + profile.stderr)).not.toContain('certificado de testing');
  });
});

describe('arcli monotributo', () => {
  async function runMonotributo(...argv: string[]): Promise<Record<string, unknown>> {
    await createProgram().parseAsync(['node', 'arcli', 'monotributo', '--json', ...argv]);

    return JSON.parse(profile.stdout) as Record<string, unknown>;
  }

  it.each([
    [[], 'testing', false],
    [[], 'produccion', true],
    [['--testing'], 'produccion', false],
    [['--produccion'], 'testing', true],
  ] as const)(
    'flags %j con entorno %s en la config: consulta el padron en produccion=%s',
    async (flags, configured, production) => {
      profile.writeConfig(
        profile.configWith(profile.healthy, {
          cert: { produccion: profile.other.certPath, testing: profile.healthy.certPath },
          entornoPorDefecto: configured,
          key: { produccion: profile.other.keyPath, testing: profile.healthy.keyPath },
        }),
      );

      // El cliente falso no responde al padron: la tabla sale igual, sin la categoria propia.
      expect(await runMonotributo(...flags)).toMatchObject({ tuCategoria: null });
      expect(Arca).toHaveBeenCalledWith(
        expect.objectContaining({ cert: (production ? profile.other : profile.healthy).pem, production }),
      );
    },
  );

  it('--testing y --produccion juntos: INPUT_VALIDATION_ERROR con el texto de siempre', async () => {
    profile.writeConfig(profile.configWith(profile.healthy));

    expect(await profile.runJsonError(['monotributo', '--testing', '--produccion'])).toMatchObject({
      codigo: 'INPUT_VALIDATION_ERROR',
      error: BOTH_FLAGS_MESSAGE,
    });
    expect(Arca).not.toHaveBeenCalled();
  });

  it('sin CUIT, con --json: no es un error; la tabla sale sin categoria y sin consultar el padron', async () => {
    profile.writeConfig({ cert: { testing: profile.healthy.certPath }, key: { testing: profile.healthy.keyPath } });

    expect(await runMonotributo()).toMatchObject({ categorias: expect.any(Array), tuCategoria: null });
    expect(Arca).not.toHaveBeenCalled();
    expect(profile.stderr).toBe('');
  });

  it('sin certificado, con --json: no es un error; la tabla sale sin categoria y sin crear el cliente', async () => {
    profile.writeConfig({ cuit: PROFILE_CUIT });

    expect(await runMonotributo()).toMatchObject({ categorias: expect.any(Array), tuCategoria: null });
    expect(Arca).not.toHaveBeenCalled();
    expect(profile.stderr).toBe('');
  });

  it('con el certificado vencido, con --json: la tabla sale sin categoria, sin cliente y sin aviso', async () => {
    profile.writeConfig(profile.configWith(profile.expiring));
    profile.moveClockAfterExpiry(profile.expiring, 5);

    expect(await runMonotributo()).toMatchObject({ tuCategoria: null });
    expect(Arca).not.toHaveBeenCalled();
    expect(profile.stderr).toBe('');
  });

  it('con el certificado por vencer no escribe el aviso del certificado', async () => {
    profile.writeConfig(profile.configWith(profile.expiring));

    await runMonotributo();

    expect(Arca).toHaveBeenCalled();
    expect(profile.stderr).toBe('');
    expect(profile.stdout).not.toContain('El certificado de testing');
  });
});

describe('config revisar: validacion de cada entorno (buildRuntimeChecks)', () => {
  /** Lo que hace `config revisar`: lee la config y valida cada entorno con ella. */
  function checks(config: Record<string, unknown>) {
    profile.writeConfig(config);

    const service = new ConfigService();

    try {
      return buildRuntimeChecks(service.getConfig());
    } finally {
      service.close();
    }
  }

  it('valida el entorno por defecto aunque no tenga nada cargado', () => {
    expect(checks({ cuit: PROFILE_CUIT })).toEqual([
      {
        environment: 'testing',
        error:
          'Falta la ruta del certificado para testing. Configurala con `arcli config establecer cert.testing <ruta>`.',
      },
    ]);
  });

  it('con todo en orden, sin error', () => {
    expect(
      checks({
        cert: { testing: profile.healthy.certPath },
        cuit: PROFILE_CUIT,
        key: { testing: profile.healthy.keyPath },
      }),
    ).toEqual([{ environment: 'testing' }]);
  });

  it('valida tambien el otro entorno si tiene cert o key cargados', () => {
    expect(checks({ ...profile.configWith(profile.healthy), key: { testing: profile.healthy.keyPath } })).toEqual([
      { environment: 'testing' },
      {
        environment: 'produccion',
        error:
          'Falta la ruta de la clave privada para producción. Configurala con `arcli config establecer key.produccion <ruta>`.',
      },
    ]);
  });

  it('sin CUIT: el mensaje de siempre en cada entorno', () => {
    expect(checks({ cert: { testing: profile.healthy.certPath }, key: { testing: profile.healthy.keyPath } })).toEqual([
      { environment: 'testing', error: MISSING_CUIT_MESSAGE },
    ]);
  });

  it.each([
    ['certificado', 'cert', 'La ruta del certificado no existe: '],
    ['clave', 'key', 'La ruta de la clave privada no existe: '],
  ] as const)('el archivo de %s no existe: error con la ruta enmascarada', (_name, field, prefix) => {
    const missing = join(profile.configDirectory, 'no-existe.pem');
    const config = {
      cert: { testing: profile.healthy.certPath },
      cuit: PROFILE_CUIT,
      key: { testing: profile.healthy.keyPath },
    };

    const [check] = checks({ ...config, [field]: { testing: missing } });

    expect(check?.error).toMatch(new RegExp(`^${prefix}\\.{3}[\\\\/].*no-existe\\.pem$`));
    expect(check?.error).not.toContain(profile.configDirectory);
  });

  it('no lee los PEM: un archivo que existe pero no es PEM no da error', () => {
    const notPem = join(profile.configDirectory, 'cert.pem');

    writeFileSync(notPem, 'no es un certificado', 'utf8');

    expect(checks({ cert: { testing: notPem }, cuit: PROFILE_CUIT, key: { testing: notPem } })).toEqual([
      { environment: 'testing' },
    ]);
  });

  it('no mira el vencimiento: un certificado vencido valida', () => {
    profile.moveClockAfterExpiry(profile.expiring, 5);

    expect(
      checks({
        cert: { testing: profile.expiring.certPath },
        cuit: PROFILE_CUIT,
        key: { testing: profile.expiring.keyPath },
      }),
    ).toEqual([{ environment: 'testing' }]);
  });

  it('con --json, los errores salen en "validaciones" del JSON de config revisar', async () => {
    profile.writeConfig({ cuit: PROFILE_CUIT });

    await createProgram().parseAsync(['node', 'arcli', 'config', 'revisar', '--json']);

    expect(profile.stdout).toContain(
      'Falta la ruta del certificado para testing. Configurala con `arcli config establecer cert.testing <ruta>`.',
    );
  });
});
