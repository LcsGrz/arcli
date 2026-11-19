import { Separator } from '@inquirer/select';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InputValidationError } from '../../../lib/errors/app-error';
import { BACK } from '../../../modules/interactive/wizard';
import { stripAnsi } from '../../../ui';
import { runCertificateMenu, runGenerateCertificate } from '../certificate.flow';
import { runConfigMenu, runGuidedSetup } from '../config.flow';
import { askTextStep, chooseOne, chooseStep, confirm } from '../prompts';

import { onlyChoices } from './script';

vi.mock('../prompts', () => ({
  askTextStep: vi.fn(),
  chooseOne: vi.fn(),
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
        ivaReceptorPorDefecto: store.ivaReceptor,
        key: { produccion: store['key.produccion'], testing: store['key.testing'] },
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
  // La validacion real lee los PEM; aca solo se rechaza un CUIT mal formado.
  validateConfigValue: (key: string, value: string) => {
    if (key === 'cuit' && !/^\d{11}$/.test(value)) {
      throw new Error('El CUIT debe tener 11 dígitos');
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
vi.mock('../../spinner', () => ({ startSpinner: () => null }));
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
    vi.mocked(chooseOne).mockResolvedValueOnce('cambiar').mockResolvedValueOnce('volver');
    chooseStepMock
      .mockImplementationOnce(
        async (_message, choices) =>
          onlyChoices(choices).find((choice) => choice.name === 'Condición de venta (PDF de A, B y C)')?.value,
      )
      .mockImplementationOnce(async (_message, choices, defaultValue) => {
        expect(onlyChoices(choices)).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ name: 'Mantener: Billetera virtual', value: 'Billetera virtual' }),
            expect.objectContaining({ name: 'Contado', value: 'contado' }),
            expect.objectContaining({ name: 'Tarjeta de Débito', value: 'tarjeta-debito' }),
          ]),
        );
        expect(defaultValue).toBe('Billetera virtual');

        return 'Billetera virtual';
      })
      .mockResolvedValueOnce(BACK);

    await runConfigMenu();

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

    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      printed += String(chunk);
      return true;
    });

    await runConfigMenu();

    expect(stripAnsi(printed)).toContain('No se encontró el escritorio.');
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
