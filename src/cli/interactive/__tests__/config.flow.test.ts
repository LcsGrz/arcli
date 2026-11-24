import { Separator } from '@inquirer/core';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError, ConfigurationError, InputValidationError } from '../../../lib/errors/app-error';
import { parseConfigValue } from '../../../modules/config/config-value-parser';
import { BACK } from '../../../modules/interactive/wizard';
import { stripAnsi } from '../../../ui';
import { runCertificateMenu, runGenerateCertificate } from '../certificate.flow';
import { runConfigMenu, runGuidedSetup } from '../config.flow';
import { askTextStep, chooseOne, chooseStep, confirm } from '../prompts';

import { createScript, onlyChoices, rejecting, type ScriptedAnswer } from './script';

let script = createScript([]);

vi.mock('../prompts', () => ({
  askTextStep: vi.fn(),
  chooseOne: vi.fn(),
  chooseOrTypeStep: (...args: Parameters<typeof script.chooseOrTypeStep>) => script.chooseOrTypeStep(...args),
  chooseStep: vi.fn(),
  confirm: vi.fn(),
  fitPageSize: () => 12,
}));

const store: Record<string, string> = {};
const install = vi.fn(async () => ({ installed: true }));
const uninstall = vi.fn();
const createShortcut = vi.hoisted(() => vi.fn());

vi.mock('../../../modules/desktop-shortcut/installer', () => ({
  createDesktopShortcut: createShortcut,
  currentDesktopShortcutEnvironment: () => ({}),
}));

vi.mock('../../../modules/config/config.service', () => ({
  ConfigService: class {
    public close() {}
    public ensureInitialized() {}
    public getConfig() {
      return {
        cert: { produccion: store['cert.produccion'], testing: store['cert.testing'] },
        conceptoPorDefecto: store.concepto,
        condicionVenta: store.condicionVenta,
        cuit: store.cuit,
        emisor: { razonSocial: store['emisor.razonSocial'] },
        entornoPorDefecto: store.entorno ?? 'testing',
        exportacion: {
          actividad: store['exportacion.actividad'] ? Number(store['exportacion.actividad']) : undefined,
          cert: { testing: store['exportacion.cert.testing'] },
          key: { testing: store['exportacion.key.testing'] },
        },
        ivaReceptorPorDefecto: store.ivaReceptor,
        key: { produccion: store['key.produccion'], testing: store['key.testing'] },
        monedaPorDefecto: store.moneda,
        output: {},
        puntoVentaPorDefecto: store.puntoVenta ? Number(store.puntoVenta) : undefined,
      };
    }
    public getPath() {
      return '/tmp/config.json';
    }
    public getPluginsPath() {
      return '/tmp/plugins';
    }
    public resolvePaths() {
      return { pdfFolder: '/tmp/pdf', ticketPath: '/tmp/tickets' };
    }
    public setValue(key: string, value: string) {
      store[key] = value;
    }
    public unsetValue(key: string) {
      delete store[key];
    }
  },
  // La validacion real lee los PEM; aca solo se rechaza un CUIT mal formado. La moneda y la actividad de exportacion
  // pasan por el parser real, el de `arcli config establecer` (TUI-39).
  validateConfigValue: (key: string, value: string) => {
    if (key === 'cuit' && !/^\d{11}$/.test(value)) {
      throw new Error('El CUIT debe tener 11 dígitos');
    }

    if (key === 'moneda' || key === 'exportacion.actividad') {
      parseConfigValue(key === 'moneda' ? 'monedaPorDefecto' : key, value);
    }
  },
}));
const pluginStatus = vi.hoisted(() =>
  vi.fn((): Record<string, unknown> => ({ installed: false, path: '/tmp/plugins/pdf', version: '0.2.1' })),
);

vi.mock('../../../services/pdf/pdf-plugin', () => ({
  PdfPlugin: class {
    public getStatus = pluginStatus;
    public install = install;
    public uninstall = uninstall;
  },
}));
vi.mock('../../spinner', () => ({
  startSpinner: () => null,
  withSpinner: <T>(_message: string, run: () => Promise<T>) => run(),
}));

/**
 * TUI-39: la tabla de actividades de WSFEX para "Actividad de exportación". Se supone que la configuración la consulta
 * como los comandos: el entorno y el certificado de `loadArcaRuntime` y el gateway de WSFEX de `ArcaClientFactory`
 * (que usa el certificado de exportación si está configurado). Sin certificado, `loadArcaRuntime` falla como el real.
 */
const exportRuntime = vi.hoisted(() => vi.fn((): unknown => ({ config: {}, environment: 'testing' })));
const exportActivities = vi.hoisted(() =>
  vi.fn(async () => [
    { id: 620100, name: 'SERVICIOS DE CONSULTORES EN INFORMATICA' },
    { id: 471100, name: 'VENTA AL POR MENOR EN HIPERMERCADOS' },
  ]),
);

vi.mock('../../arca-runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../arca-runtime')>()),
  loadArcaRuntime: () => exportRuntime(),
}));

vi.mock('../../../services/arca/arca-client.factory', () => ({
  ArcaClientFactory: class {
    public createExportGateway() {
      return { getActivities: exportActivities };
    }
  },
}));
vi.mock('../certificate.flow', () => ({ runCertificateMenu: vi.fn(), runGenerateCertificate: vi.fn() }));

const askTextMock = vi.mocked(askTextStep);
const chooseStepMock = vi.mocked(chooseStep);

beforeEach(() => {
  for (const key of Object.keys(store)) {
    delete store[key];
  }

  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('runGuidedSetup', () => {
  it('pide lo obligatorio, los defaults y opcionalmente los datos del PDF, y guarda cada respuesta', async () => {
    askTextMock
      .mockResolvedValueOnce('20123456786')
      .mockResolvedValueOnce('/certs/testing.crt')
      .mockResolvedValueOnce('/certs/testing.key')
      .mockResolvedValueOnce('3')
      .mockResolvedValueOnce('Ana Gomez')
      .mockResolvedValueOnce('Calle 123')
      .mockResolvedValueOnce('1/03/2020')
      .mockResolvedValueOnce('Exento');
    chooseStepMock
      .mockResolvedValueOnce('tengo')
      .mockResolvedValueOnce('servicios')
      .mockResolvedValueOnce('consumidor-final');
    vi.mocked(confirm).mockResolvedValueOnce(true);

    await runGuidedSetup();

    expect(store).toMatchObject({
      'cert.testing': '/certs/testing.crt',
      concepto: 'servicios',
      cuit: '20123456786',
      'emisor.domicilio': 'Calle 123',
      'emisor.iibb': 'Exento',
      'emisor.inicioActividades': '1/03/2020',
      'emisor.razonSocial': 'Ana Gomez',
      ivaReceptor: 'consumidor-final',
      'key.testing': '/certs/testing.key',
      puntoVenta: '3',
    });
  });

  it('sin certificado, lo saca en el momento y no pide la clave', async () => {
    vi.mocked(runGenerateCertificate).mockImplementationOnce(async () => {
      store['cert.testing'] = '/arcli/certificados/testing.crt';
      store['key.testing'] = '/arcli/certificados/testing.key';

      return 'importado';
    });
    askTextMock.mockResolvedValueOnce('20123456786').mockResolvedValueOnce('3');
    chooseStepMock
      .mockResolvedValueOnce('sacar')
      .mockResolvedValueOnce('servicios')
      .mockResolvedValueOnce('consumidor-final');
    vi.mocked(confirm).mockResolvedValueOnce(false);

    await runGuidedSetup();

    expect(runGenerateCertificate).toHaveBeenCalledWith('testing');
    expect(askTextMock).toHaveBeenCalledTimes(2);
    expect(store).toMatchObject({ 'key.testing': '/arcli/certificados/testing.key', puntoVenta: '3' });
  });

  it('con entorno produccion pide el certificado de produccion', async () => {
    store.entorno = 'produccion';
    askTextMock
      .mockResolvedValueOnce('20123456786')
      .mockResolvedValueOnce('/certs/produccion.crt')
      .mockResolvedValueOnce('/certs/produccion.key')
      .mockResolvedValueOnce('3');
    chooseStepMock
      .mockResolvedValueOnce('tengo')
      .mockResolvedValueOnce('servicios')
      .mockResolvedValueOnce('consumidor-final');
    vi.mocked(confirm).mockResolvedValueOnce(false);

    await runGuidedSetup();

    expect(chooseStepMock).toHaveBeenNthCalledWith(
      1,
      '¿Ya tenés el certificado de producción de ARCA?',
      expect.anything(),
    );
    expect(store).toMatchObject({
      'cert.produccion': '/certs/produccion.crt',
      'key.produccion': '/certs/produccion.key',
    });
    expect(store['cert.testing']).toBeUndefined();
    expect(
      stripAnsi(
        vi
          .mocked(process.stdout.write)
          .mock.calls.map(([chunk]) => String(chunk))
          .join(''),
      ),
    ).toContain('Ya podés emitir en producción');
  });

  it('respeta --produccion de `arcli interactivo` aunque la config diga testing', async () => {
    vi.mocked(runGenerateCertificate).mockResolvedValueOnce(BACK);
    // Volver desde el certificado vuelve al CUIT, y Esc ahi cancela la guiada.
    askTextMock.mockResolvedValueOnce('20123456786').mockResolvedValueOnce(BACK);
    chooseStepMock.mockResolvedValueOnce('sacar');

    await runGuidedSetup({ produccion: true });

    expect(runGenerateCertificate).toHaveBeenCalledWith('produccion');
  });

  it('valida con las mismas reglas que config establecer y no deja vacio lo obligatorio', async () => {
    askTextMock.mockImplementationOnce(async (_message, options) => {
      expect(options?.validate?.('123')).toMatch(/11 dígitos/);
      expect(options?.validate?.('')).toMatch(/obligatorio/);

      return BACK;
    });

    await runGuidedSetup();

    expect(store).toEqual({});
  });
});

describe('runConfigMenu', () => {
  it('cambia un dato de una lista de opciones', async () => {
    vi.mocked(chooseOne).mockResolvedValueOnce('cambiar').mockResolvedValueOnce('volver');
    chooseStepMock
      .mockImplementationOnce(
        async (_message, choices) => onlyChoices(choices).find((choice) => choice.name === 'Concepto')?.value,
      )
      .mockResolvedValueOnce('productos')
      // Despues de guardar vuelve a la lista; "Volver" sale.
      .mockResolvedValueOnce(BACK);

    await runConfigMenu();

    expect(store.concepto).toBe('productos');

    // Los datos van agrupados: un titulo por seccion, en orden.
    const headers = (chooseStepMock.mock.calls[0]?.[1] ?? [])
      .filter((item) => Separator.isSeparator(item) && item.separator.trim())
      .map((item) => stripAnsi((item as Separator).separator));

    expect(headers).toEqual([
      'Cuenta',
      'Certificados',
      'Al facturar',
      'Factura de crédito electrónica (FCE)',
      'Factura de exportación (E)',
      'Monotributo',
      'Datos del emisor (PDF)',
      'PDF',
      'Salida y listados',
    ]);
  });

  it('preserva una condición de venta personalizada y muestra etiquetas amigables', async () => {
    store.condicionVenta = 'Billetera virtual';
    script = createScript([[/^Condición de venta/, '']]);
    vi.mocked(chooseOne).mockResolvedValueOnce('cambiar').mockResolvedValueOnce('volver');
    chooseStepMock
      .mockImplementationOnce(
        async (_message, choices) =>
          onlyChoices(choices).find((choice) => choice.name === 'Condición de venta (PDF de A, B y C)')?.value,
      )
      .mockResolvedValueOnce(BACK);

    await runConfigMenu();

    const [, rows, options] = script.chooseOrTypeStep.mock.calls[0] ?? [];

    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Contado', value: 'contado' }),
        expect.objectContaining({ label: 'Tarjeta de Débito', value: 'tarjeta-debito' }),
      ]),
    );
    expect(options?.previous).toBe('Billetera virtual');
    expect(store.condicionVenta).toBe('Billetera virtual');
  });

  it('muestra toda la configuracion', async () => {
    store.cuit = '20333333334';
    vi.mocked(chooseOne).mockResolvedValueOnce('ver').mockResolvedValueOnce('volver');

    let printed = '';

    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      printed += String(chunk);
      return true;
    });

    await runConfigMenu();

    expect(stripAnsi(printed)).toContain('20-33333333-4');
    expect(stripAnsi(printed)).toContain('Filas por lista');
  });

  it('borra un dato de texto con "-"', async () => {
    store['emisor.razonSocial'] = 'Viejo';
    vi.mocked(chooseOne).mockResolvedValueOnce('cambiar').mockResolvedValueOnce('volver');
    chooseStepMock
      .mockImplementationOnce(
        async (_message, choices) => onlyChoices(choices).find((choice) => choice.name === 'Razón social')?.value,
      )
      .mockResolvedValueOnce(BACK);
    askTextMock.mockImplementationOnce(async (message, options) => {
      expect(message).toContain('"-" para borrar');
      expect(options?.defaultValue).toBe('Viejo');

      return '-';
    });

    await runConfigMenu();

    expect(store['emisor.razonSocial']).toBeUndefined();
  });

  it('abre los certificados de ARCA desde configuracion', async () => {
    vi.mocked(chooseOne).mockResolvedValueOnce('certificados').mockResolvedValueOnce('volver');

    await runConfigMenu();

    expect(runCertificateMenu).toHaveBeenCalled();
  });

  it('instala el plugin de PDF desde configuracion', async () => {
    vi.mocked(chooseOne).mockResolvedValueOnce('pdf').mockResolvedValueOnce('volver');
    chooseStepMock.mockResolvedValueOnce('instalar');

    await runConfigMenu();

    expect(install).toHaveBeenCalledTimes(1);
    expect(uninstall).not.toHaveBeenCalled();
  });

  it('crea el acceso directo desde configuracion', async () => {
    createShortcut.mockReturnValueOnce({ path: '/Escritorio/ARCLI.app', replaced: false });
    vi.mocked(chooseOne).mockResolvedValueOnce('acceso-directo').mockResolvedValueOnce('volver');

    let printed = '';

    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      printed += String(chunk);
      return true;
    });

    await runConfigMenu();

    expect(createShortcut).toHaveBeenCalledWith(undefined, expect.anything());
    expect(stripAnsi(printed)).toContain('/Escritorio/ARCLI.app');
  });

  it('si no se puede crear el acceso directo, avisa y sigue en el menu', async () => {
    createShortcut.mockImplementationOnce(() => {
      throw new InputValidationError('No se encontró el escritorio.');
    });
    vi.mocked(chooseOne).mockResolvedValueOnce('acceso-directo').mockResolvedValueOnce('volver');

    let printed = '';

    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      printed += String(chunk);
      return true;
    });

    await runConfigMenu();

    expect(stripAnsi(printed)).toContain('No se encontró el escritorio.');
    expect(chooseOne).toHaveBeenCalledTimes(2);
  });

  it.each([
    [
      'con su sugerencia',
      new AppError('No se pudo crear el acceso directo.', {
        code: 'DESKTOP_SHORTCUT_ERROR',
        suggestion: 'Revisá que tengas permisos en esa carpeta.',
      }),
      'Revisá que tengas permisos en esa carpeta.',
    ],
    [
      'un error del sistema de archivos',
      Object.assign(new Error('EPERM: operation not permitted, mkdir'), { code: 'EPERM', syscall: 'mkdir' }),
      'EPERM',
    ],
  ])('si no se puede crear el acceso directo, lo muestra %s y sigue en el menu', async (_name, error, expected) => {
    createShortcut.mockImplementationOnce(() => {
      throw error;
    });
    vi.mocked(chooseOne).mockResolvedValueOnce('acceso-directo').mockResolvedValueOnce('volver');

    let printed = '';

    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      printed += String(chunk);
      return true;
    });

    await runConfigMenu();

    expect(stripAnsi(printed)).toContain(expected);
    expect(chooseOne).toHaveBeenCalledTimes(2);
  });

  it('instala y desinstala el autocompletado desde configuracion', async () => {
    const shell = process.env.SHELL;
    const rc = join(process.env.HOME ?? '', '.zshrc');

    process.env.SHELL = '/bin/zsh';

    try {
      vi.mocked(chooseOne).mockResolvedValueOnce('completado').mockResolvedValueOnce('volver');
      chooseStepMock.mockResolvedValueOnce('instalar');
      await runConfigMenu();

      expect(readFileSync(rc, 'utf8')).toContain('eval "$(arcli completado zsh)"');

      vi.mocked(chooseOne).mockResolvedValueOnce('completado').mockResolvedValueOnce('volver');
      chooseStepMock.mockResolvedValueOnce('desinstalar');
      await runConfigMenu();

      expect(readFileSync(rc, 'utf8')).not.toContain('arcli completado');
    } finally {
      process.env.SHELL = shell;
    }
  });
});

describe('configuración: volver, cancelar y dejar como estaba', () => {
  function printed(): string {
    return stripAnsi(
      vi
        .mocked(process.stdout.write)
        .mock.calls.map(([chunk]) => String(chunk))
        .join(''),
    ).replace(/[│┃╏\s]+/g, ' ');
  }

  // Una respuesta guionada que sobra no tiene que pasar al test siguiente.
  afterEach(() => {
    askTextMock.mockReset();
    chooseStepMock.mockReset();
    vi.mocked(chooseOne).mockReset();
    vi.mocked(confirm).mockReset();
  });

  /** Elige la opcion por su nombre, como la persona en la lista. */
  const pick = (name: string) => async (_message: string, choices: Parameters<typeof chooseStep>[1]) =>
    onlyChoices(choices).find((choice) => choice.name === name)?.value as never;
  /** Elige un dato de "Modificar configuración" por su clave. */
  const pickField = (key: string) => async (_message: string, choices: Parameters<typeof chooseStep>[1]) =>
    onlyChoices(choices).find((choice) => (choice.value as { key?: string }).key === key)?.value as never;

  it('volver desde "¿Ya tenés el certificado?" vuelve al CUIT, y Esc ahi cancela dejando lo ya guardado', async () => {
    askTextMock.mockResolvedValueOnce('20123456786').mockResolvedValueOnce(BACK);
    chooseStepMock.mockResolvedValueOnce(BACK);

    await runGuidedSetup();

    expect(askTextMock).toHaveBeenCalledTimes(2);
    expect(store).toEqual({ cuit: '20123456786' });
    expect(printed()).toContain('Configuración guiada cancelada. Lo ya respondido quedó guardado.');
    expect(confirm).not.toHaveBeenCalled();
  });

  it('con el pedido del certificado pendiente, avisa que falta cargarlo en lugar de decir que ya se puede emitir', async () => {
    vi.mocked(runGenerateCertificate).mockResolvedValueOnce('pendiente');
    askTextMock.mockResolvedValueOnce('20123456786').mockResolvedValueOnce('3');
    chooseStepMock
      .mockResolvedValueOnce('sacar')
      .mockImplementationOnce(pick('Dejar sin configurar'))
      .mockImplementationOnce(pick('Dejar sin configurar'));
    vi.mocked(confirm).mockResolvedValueOnce(false);

    await runGuidedSetup();

    // "Dejar sin configurar" no guarda nada.
    expect(store).toEqual({ cuit: '20123456786', puntoVenta: '3' });
    expect(printed()).toContain('falta cargar el certificado de testing');
    expect(printed()).not.toContain('Ya podés emitir');
  });

  it('con el certificado ya cargado no pregunta si lo tenés, y Enter lo deja como estaba', async () => {
    store['cert.testing'] = '/certs/testing.crt';
    store['key.testing'] = '/certs/testing.key';
    askTextMock
      .mockResolvedValueOnce('20123456786')
      .mockImplementationOnce(async (message, options) => {
        // El obligatorio no ofrece borrarlo con "-".
        expect(message).not.toContain('"-" para borrar');
        expect(options?.defaultValue).toBe('/certs/testing.crt');

        return '';
      })
      .mockResolvedValueOnce('/certs/testing.key')
      .mockResolvedValueOnce('3');
    chooseStepMock.mockResolvedValueOnce('servicios').mockResolvedValueOnce('consumidor-final');
    vi.mocked(confirm).mockResolvedValueOnce(false);

    await runGuidedSetup();

    expect(chooseStepMock).not.toHaveBeenCalledWith(
      expect.stringMatching(/Ya tenés el certificado/),
      expect.anything(),
    );
    expect(store['cert.testing']).toBe('/certs/testing.crt');
    expect(printed()).toContain('Ya podés emitir en testing');
  });

  // Entre comillas simples o dobles. Los espacios escapados con "\" no se prueban aca: en Windows "\" separa carpetas.
  it('un archivo arrastrado a la terminal se guarda sin comillas', async () => {
    askTextMock
      .mockResolvedValueOnce('20123456786')
      .mockResolvedValueOnce("'/mis certs/testing.crt'")
      .mockResolvedValueOnce('"/mis certs/testing.key"')
      .mockResolvedValueOnce('3');
    chooseStepMock
      .mockResolvedValueOnce('tengo')
      .mockImplementationOnce(pick('Dejar sin configurar'))
      .mockImplementationOnce(pick('Dejar sin configurar'));
    vi.mocked(confirm).mockResolvedValueOnce(false);

    await runGuidedSetup();

    expect(store).toMatchObject({
      'cert.testing': '/mis certs/testing.crt',
      'key.testing': '/mis certs/testing.key',
    });
  });

  describe('modificar un dato', () => {
    it('Enter o el mismo valor dicen "Sin cambios."; volver no dice nada y vuelve a la lista con el dato marcado', async () => {
      store.cuit = '20123456786';
      vi.mocked(chooseOne).mockResolvedValueOnce('cambiar').mockResolvedValueOnce('volver');
      chooseStepMock
        .mockImplementationOnce(pickField('cuit'))
        .mockImplementationOnce(pickField('cuit'))
        .mockImplementationOnce(pickField('cuit'))
        .mockResolvedValueOnce(BACK);
      askTextMock.mockResolvedValueOnce('').mockResolvedValueOnce('20123456786').mockResolvedValueOnce(BACK);

      await runConfigMenu();

      expect(printed().match(/Sin cambios\./g)).toHaveLength(2);
      expect(printed()).not.toContain('Guardado.');
      // La lista vuelve con el ultimo dato elegido marcado.
      expect((chooseStepMock.mock.calls[3]?.[2] as { key: string } | undefined)?.key).toBe('cuit');
      expect(store.cuit).toBe('20123456786');
    });

    it('volver desde una lista de opciones no cambia nada; "Quitar el valor por defecto" lo borra', async () => {
      store.concepto = 'servicios';
      vi.mocked(chooseOne).mockResolvedValueOnce('cambiar').mockResolvedValueOnce('volver');
      chooseStepMock
        .mockImplementationOnce(pick('Concepto'))
        .mockResolvedValueOnce(BACK)
        .mockImplementationOnce(pick('Concepto'))
        .mockImplementationOnce(pick('Quitar el valor por defecto'))
        .mockResolvedValueOnce(BACK);

      await runConfigMenu();

      expect(store.concepto).toBeUndefined();
      expect(printed()).toContain('Dato borrado.');
    });

    it('un valor nuevo se valida y se guarda', async () => {
      vi.mocked(chooseOne).mockResolvedValueOnce('cambiar').mockResolvedValueOnce('volver');
      chooseStepMock.mockImplementationOnce(pickField('cuit')).mockResolvedValueOnce(BACK);
      askTextMock.mockImplementationOnce(async (message, options) => {
        // Sin valor actual no hay nada que borrar, y vacio queda sin configurar.
        expect(message).not.toContain('"-" para borrar');
        expect(options?.validate?.('')).toBe(true);
        expect(options?.validate?.('-')).toMatch(/11 dígitos/);

        return '20123456786';
      });

      await runConfigMenu();

      expect(store.cuit).toBe('20123456786');
      expect(printed()).toContain('Guardado.');
    });
  });

  it('revisa la configuracion desde el menu', async () => {
    vi.mocked(chooseOne).mockResolvedValueOnce('revisar').mockResolvedValueOnce('volver');

    await runConfigMenu();

    expect(printed()).toMatch(/CUIT/);
  });

  it('abre la configuracion guiada desde el menu con el entorno de `arcli interactivo`', async () => {
    vi.mocked(chooseOne).mockResolvedValueOnce('guiada').mockResolvedValueOnce('volver');
    askTextMock.mockResolvedValueOnce('20123456786');
    chooseStepMock.mockResolvedValueOnce(BACK);
    askTextMock.mockResolvedValueOnce(BACK);

    await runConfigMenu({ produccion: true });

    expect(chooseStepMock).toHaveBeenCalledWith('¿Ya tenés el certificado de producción de ARCA?', expect.anything());
  });

  describe('plugin de PDF', () => {
    it('instalado, ofrece desinstalarlo', async () => {
      pluginStatus.mockReturnValue({ installed: true, installedVersion: '0.2.1', path: '/tmp/plugins/pdf' });
      vi.mocked(chooseOne).mockResolvedValueOnce('pdf').mockResolvedValueOnce('volver');
      chooseStepMock.mockImplementationOnce(async (_message, choices) => {
        expect(onlyChoices(choices).map((choice) => choice.name)).toEqual(['Desinstalar']);

        return 'desinstalar' as never;
      });

      try {
        await runConfigMenu();
      } finally {
        pluginStatus.mockReset();
        pluginStatus.mockReturnValue({ installed: false, path: '/tmp/plugins/pdf', version: '0.2.1' });
      }

      expect(uninstall).toHaveBeenCalledOnce();
      expect(install).not.toHaveBeenCalled();
      expect(printed()).toContain('Plugin de PDF desinstalado.');
    });

    it('con una version vieja ofrece actualizar; volver no instala nada', async () => {
      pluginStatus.mockReturnValueOnce({ installed: false, installedVersion: '0.1.0', path: '/tmp/plugins/pdf' });
      vi.mocked(chooseOne).mockResolvedValueOnce('pdf').mockResolvedValueOnce('volver');
      chooseStepMock.mockImplementationOnce(async (_message, choices) => {
        expect(onlyChoices(choices).map((choice) => choice.name)).toEqual(['Actualizar']);

        return BACK as never;
      });

      await runConfigMenu();

      expect(install).not.toHaveBeenCalled();
      expect(uninstall).not.toHaveBeenCalled();
    });
  });

  describe('autocompletado', () => {
    let shell: string | undefined;

    beforeEach(() => {
      shell = process.env.SHELL;
      process.env.SHELL = '/bin/desconocido';
    });

    afterEach(() => {
      process.env.SHELL = shell;
    });

    it('si no reconoce el shell lo pregunta, y volver ahi no hace nada', async () => {
      vi.mocked(chooseOne).mockResolvedValueOnce('completado').mockResolvedValueOnce('volver');
      chooseStepMock.mockResolvedValueOnce(BACK);

      await runConfigMenu();

      expect(chooseStepMock).toHaveBeenCalledTimes(1);
      expect(chooseStepMock.mock.calls[0]?.[0]).toBe('¿Qué shell usás?');
    });

    it('con el shell elegido muestra el estado; volver desde la accion no instala', async () => {
      vi.mocked(chooseOne).mockResolvedValueOnce('completado').mockResolvedValueOnce('volver');
      chooseStepMock.mockResolvedValueOnce('bash').mockResolvedValueOnce(BACK);

      await runConfigMenu();

      expect(chooseStepMock.mock.calls[1]?.[0]).toBe('¿Qué hacemos con el autocompletado?');
      expect(printed()).toMatch(/bash/i);
      expect(readFileSync(join(process.env.HOME ?? '', '.bashrc'), { encoding: 'utf8', flag: 'a+' })).not.toContain(
        'arcli completado',
      );
    });
  });

  it('un error inesperado al crear el acceso directo no se tapa', async () => {
    createShortcut.mockImplementationOnce(() => {
      throw new TypeError('roto');
    });
    vi.mocked(chooseOne).mockResolvedValueOnce('acceso-directo');

    await expect(runConfigMenu()).rejects.toThrow('roto');
  });
});

/**
 * Criterio 10 (TUI-35): un dato con valores conocidos (la condición de venta) es una lista donde también se escribe. Un
 * valor guardado que no es de la lista arranca escrito o como fila, sin la fila "Mantener: …" aparte, y "Quitar el
 * valor por defecto" y "Dejar sin configurar" siguen.
 */
describe('configuración: un dato con valores conocidos, de una lista donde también se escribe (TUI-35)', () => {
  const FIELD_LIST = '¿Qué querés modificar?';

  function printed(): string {
    return stripAnsi(
      vi
        .mocked(process.stdout.write)
        .mock.calls.map(([chunk]) => String(chunk))
        .join(''),
    ).replace(/[│┃╏\s]+/g, ' ');
  }

  /**
   * Abre "Condición de venta" en "Modificar configuración", responde `answer` y vuelve. Cualquier otra lista (la de hoy,
   * con "Mantener: …") se cierra con Esc, así el test falla en lo que mira y no por quedarse sin respuestas.
   */
  async function changeSaleCondition(answer: string): Promise<void> {
    let opened = false;

    script = createScript([[/^Condición de venta/, answer]]);
    vi.mocked(chooseOne).mockResolvedValueOnce('cambiar').mockResolvedValueOnce('volver');
    chooseStepMock.mockImplementation(async (message, choices) => {
      if (message !== FIELD_LIST || opened) {
        return BACK;
      }

      opened = true;

      return onlyChoices(choices).find((choice) => (choice.value as { key?: string }).key === 'condicionVenta')
        ?.value as never;
    });

    await runConfigMenu();

    expect(script.asked).toEqual([expect.stringMatching(/^Condición de venta/)]);
  }

  /** Las filas que mostró la lista de la condición de venta. */
  function offeredRows(): string[] {
    return (script.chooseOrTypeStep.mock.calls[0]?.[1] ?? []).map((row) => stripAnsi(row.label).trim());
  }

  afterEach(() => {
    chooseStepMock.mockReset();
    vi.mocked(chooseOne).mockReset();
  });

  it('un valor guardado que no es de la lista arranca escrito o como fila, sin "Mantener: …": Enter lo deja', async () => {
    store.condicionVenta = 'Billetera virtual';

    await changeSaleCondition('');

    expect(offeredRows().filter((row) => /Mantener/.test(row))).toEqual([]);
    expect(offeredRows()).toContain('Quitar el valor por defecto');
    expect(store.condicionVenta).toBe('Billetera virtual');
    expect(printed()).toContain('Sin cambios.');
  });

  it('un texto escrito que no es de la lista se guarda tal cual', async () => {
    store.condicionVenta = 'contado';

    await changeSaleCondition('Mercado Pago');

    expect(store.condicionVenta).toBe('Mercado Pago');
    expect(printed()).toContain('Guardado.');
  });

  it('elegir una de la lista guarda su clave', async () => {
    await changeSaleCondition('Cuenta Corriente');

    expect(store.condicionVenta).toBe('cuenta-corriente');
  });

  it('"Quitar el valor por defecto" lo borra', async () => {
    store.condicionVenta = 'Billetera virtual';

    await changeSaleCondition('Quitar el valor por defecto');

    expect(store.condicionVenta).toBeUndefined();
    expect(printed()).toContain('Dato borrado.');
  });

  it('elegir la de la lista que se lee igual que el texto guardado no lo cambia', async () => {
    store.condicionVenta = 'Contado';

    await changeSaleCondition('');

    expect(store.condicionVenta).toBe('Contado');
    expect(printed()).toContain('Sin cambios.');
    expect(printed()).not.toContain('Guardado.');
  });

  it('un texto escrito igual a los valores internos de "Quitar" o "Dejar" se guarda como texto', async () => {
    store.condicionVenta = 'contado';

    await changeSaleCondition('__borrar__');

    expect(store.condicionVenta).toBe('__borrar__');
    expect(printed()).toContain('Guardado.');
  });

  it('sin valor guardado, "Dejar sin configurar" no guarda nada', async () => {
    await changeSaleCondition('Dejar sin configurar');

    expect(offeredRows()).not.toContain('Quitar el valor por defecto');
    expect(store.condicionVenta).toBeUndefined();
    expect(printed()).toContain('Sin cambios.');
  });
});

/**
 * TUI-39: la moneda y la actividad de exportación de "Modificar configuración", de una lista donde también se escribe.
 * Las dos se validan como `arcli config establecer` (`parseConfigValue`). Lo que hoy funciona (escribir un código válido,
 * el error de uno inválido, Enter con un valor propio, y la actividad sin certificado o sin red) va en tests normales:
 * el guion responde igual a la pregunta de texto o a la lista.
 */
describe('configuración: la moneda y la actividad de exportación de una lista donde también se escribe (TUI-39)', () => {
  const FIELD_LIST = '¿Qué querés modificar?';

  function printed(): string {
    return stripAnsi(
      vi
        .mocked(process.stdout.write)
        .mock.calls.map(([chunk]) => String(chunk))
        .join(''),
    ).replace(/[│┃╏\s]+/g, ' ');
  }

  /**
   * Abre el dato `key` (o cada uno, en orden) en "Modificar configuración", responde con el guion y vuelve. Cualquier
   * otra lista se cierra con Esc, así el test falla en lo que mira y no por quedarse sin respuestas.
   */
  async function changeField(key: string | readonly string[], steps: Steps): Promise<void> {
    let opened = 0;

    script = createScript(steps);
    askTextMock.mockImplementation((...args) => script.askTextStep(...args));
    vi.mocked(chooseOne).mockResolvedValueOnce('cambiar').mockResolvedValueOnce('volver');
    chooseStepMock.mockImplementation(async (message, choices) => {
      const next = [key].flat()[opened];

      if (message !== FIELD_LIST || next === undefined) {
        return BACK;
      }

      opened += 1;

      return onlyChoices(choices).find((choice) => (choice.value as { key?: string }).key === next)?.value as never;
    });

    await runConfigMenu();

    expect(script.remaining()).toBe(0);
  }

  /** La lista de una pregunta, si la pregunta fue una lista. */
  function listCall(question: RegExp) {
    return script.chooseOrTypeStep.mock.calls.find(([message]) => question.test(message));
  }

  function listedLabels(question: RegExp): string[] {
    return (listCall(question)?.[1] ?? []).map((row) => stripAnsi(row.label).replace(/\s+/g, ' ').trim());
  }

  type Steps = ReadonlyArray<readonly [RegExp, ScriptedAnswer]>;

  const INVALID_CURRENCY =
    /^El código de moneda "ZZZZ" no es válido: tiene que ser un código de moneda de 3 caracteres/;

  // Con el certificado de facturación de testing (rutas ficticias: ARCA está simulado), como pide `arcli fe`.
  beforeEach(() => {
    store['cert.testing'] = '/certs/testing.crt';
    store['key.testing'] = '/certs/testing.key';
    exportRuntime.mockImplementation(() => ({ config: {}, environment: 'testing' }));
    exportActivities.mockImplementation(async () => [
      { id: 620100, name: 'SERVICIOS DE CONSULTORES EN INFORMATICA' },
      { id: 471100, name: 'VENTA AL POR MENOR EN HIPERMERCADOS' },
    ]);
  });

  afterEach(() => {
    chooseStepMock.mockReset();
    askTextMock.mockReset();
    vi.mocked(chooseOne).mockReset();
  });

  // Sin valor guardado, la lista arranca en "Dejar sin configurar": Enter con el filtro vacío no guarda la primera fila.
  it.each([
    ['condicionVenta', /^Condición de venta/],
    ['moneda', /^Moneda/],
    ['exportacion.actividad', /^Actividad de exportación/],
  ])('sin valor guardado, Enter en la lista de %s no guarda nada: "Sin cambios."', async (key, question) => {
    await changeField(key, [[question, '']]);

    expect(listedLabels(question)).toContain('Dejar sin configurar');
    expect(store[key]).toBeUndefined();
    expect(printed()).toContain('Sin cambios.');
  });

  describe('moneda', () => {
    it('`usd` elige la fila DOL, y con USD guardado elegir DOL es "Sin cambios."', async () => {
      store.moneda = 'USD';

      await changeField('moneda', [[/^Moneda/, '']]);

      expect(listCall(/^Moneda/)?.[2].previous).toBe('DOL');
      expect(printed()).toContain('Sin cambios.');
    });

    // Criterio 4: lo de hoy.
    it('un código que no es de moneda da el error de `arcli config establecer` y uno válido escrito se guarda', async () => {
      await changeField('moneda', [[/^Moneda/, rejecting('XAU', ['ZZZZ', INVALID_CURRENCY])]]);

      expect(store.moneda).toBe('XAU');
      expect(printed()).toContain('Guardado.');
    });

    // Criterio 4: lo de hoy.
    it('con un valor guardado que no es de la lista, Enter lo deja: "Sin cambios."', async () => {
      store.moneda = 'XAU';

      await changeField('moneda', [[/^Moneda/, '']]);

      expect(store.moneda).toBe('XAU');
      expect(printed()).toContain('Sin cambios.');
    });

    // Criterio 4.
    // La fila guarda el código de ARCA, como el default PES (decisión del 23/11): buscar "estadounidense" o "usd" la encuentra.
    it('elegir el dólar de la lista de monedas guarda DOL', async () => {
      await changeField('moneda', [[/^Moneda/, 'estadounidense']]);

      expect(listedLabels(/^Moneda/).some((label) => /d[oó]lar/i.test(label))).toBe(true);
      expect(store.moneda).toBe('DOL');
      expect(printed()).toContain('Guardado.');
    });

    // Criterio 4.
    it('en la lista también se escribe: un código inválido da el error de `parseConfigValue`', async () => {
      await changeField('moneda', [[/^Moneda/, rejecting('XAU', ['ZZZZ', INVALID_CURRENCY])]]);

      expect(listCall(/^Moneda/)).toBeDefined();
      expect(store.moneda).toBe('XAU');
    });

    // Criterio 4.
    it('un valor guardado que no es de la lista arranca escrito en la lista', async () => {
      store.moneda = 'XAU';

      await changeField('moneda', [[/^Moneda/, '']]);

      const [, rows, options] = listCall(/^Moneda/) ?? [];

      expect(rows?.length ?? 0).toBeGreaterThan(0);
      expect(rows?.some((row) => row.value === 'XAU')).toBe(false);
      expect(options?.previous).toBe('XAU');
      expect(store.moneda).toBe('XAU');
      expect(printed()).toContain('Sin cambios.');
    });
  });

  describe('actividad de exportación', () => {
    const ACTIVITY = /^Actividad de exportación/;

    // Con la tabla, también el certificado de exportación de testing, que la consulta usa si está.
    beforeEach(() => {
      store['exportacion.cert.testing'] = '/certs/wsfex-testing.crt';
      store['exportacion.key.testing'] = '/certs/wsfex-testing.key';
    });

    // Criterio 5.
    it('con la tabla de WSFEX disponible, se elige de la lista por la descripción y guarda el código', async () => {
      await changeField('exportacion.actividad', [[ACTIVITY, 'consultores']]);

      expect(listedLabels(ACTIVITY)).toContain('620100 SERVICIOS DE CONSULTORES EN INFORMATICA');
      expect(String(store['exportacion.actividad'])).toBe('620100');
      expect(printed()).toContain('Guardado.');
    });

    // Criterio 5.
    it('con la tabla, "Quitar el valor por defecto" borra la actividad guardada', async () => {
      store['exportacion.actividad'] = '620100';

      await changeField('exportacion.actividad', [[ACTIVITY, 'Quitar el valor por defecto']]);

      expect(listedLabels(ACTIVITY)).toContain('Quitar el valor por defecto');
      expect(store['exportacion.actividad']).toBeUndefined();
      expect(printed()).toContain('Dato borrado.');
    });

    // Criterio 5.
    it('con la tabla y sin actividad guardada, "Dejar sin configurar" no guarda nada', async () => {
      await changeField('exportacion.actividad', [[ACTIVITY, 'Dejar sin configurar']]);

      expect(listedLabels(ACTIVITY)).toContain('Dejar sin configurar');
      expect(store['exportacion.actividad']).toBeUndefined();
      expect(printed()).toContain('Sin cambios.');
    });

    // Un código guardado que no es una fila (6201, contenido en 620100) arranca escrito: Enter lo deja, como el componente.
    it('con 6201 guardado y 620100 en la tabla, Enter da "Sin cambios."', async () => {
      store['exportacion.actividad'] = '6201';

      await changeField('exportacion.actividad', [[ACTIVITY, '']]);

      expect(listCall(ACTIVITY)?.[2].previous).toBe('6201');
      expect(printed()).toContain('Sin cambios.');
    });

    it('la tabla se consulta una vez por menú, y de nuevo si se guarda un certificado', async () => {
      const keep = [ACTIVITY, 'Dejar sin configurar'] as const;
      const activity = 'exportacion.actividad';

      await changeField(
        [activity, activity, 'exportacion.cert.testing', activity],
        [keep, keep, [/^Certificado de exportación/, '/certs/otro.crt'], keep],
      );

      expect(exportActivities).toHaveBeenCalledTimes(2);
    });

    // Criterio 5: lo de hoy, que tiene que seguir sin certificado. El error es el de `arcli config establecer`.
    it('sin certificado se pregunta como texto: un valor que no es entero da el error y el código escrito se guarda', async () => {
      for (const key of ['cert.testing', 'key.testing', 'exportacion.cert.testing', 'exportacion.key.testing']) {
        delete store[key];
      }

      exportRuntime.mockImplementation(() => {
        throw new ConfigurationError('Falta el certificado de testing.');
      });

      await changeField('exportacion.actividad', [
        [ACTIVITY, rejecting('620100', ['abc', /^El valor "abc" no es un entero positivo válido\.$/])],
      ]);

      expect(exportActivities).not.toHaveBeenCalled();
      expect(String(store['exportacion.actividad'])).toBe('620100');
      expect(printed()).toContain('Guardado.');
    });

    // Criterio 5: lo de hoy, que tiene que seguir si ARCA falla. Como hoy, "-" borra la guardada y el menú sigue.
    it('si la consulta de la tabla falla, se pregunta como texto y "-" borra la actividad guardada, sin cortar el menú', async () => {
      store['exportacion.actividad'] = '620100';
      exportActivities.mockImplementation(async () => {
        throw new Error('ECONNRESET');
      });

      await changeField('exportacion.actividad', [[ACTIVITY, '-']]);

      expect(store['exportacion.actividad']).toBeUndefined();
      expect(printed()).toContain('Dato borrado.');
      expect(vi.mocked(chooseOne)).toHaveBeenCalledTimes(2);
    });
  });
});
