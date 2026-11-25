import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BillingExecutionResult } from '../../../modules/billing/billing.types.internal';
import { getVoucherKindByShortcut } from '../../../modules/billing/voucher-kind-map';
import { toPdfFailure } from '../../../modules/pdf/pdf-failure';
import { findDownloadedBrowser } from '../pdf-browser';
import { exportBillingPdf, TESTING_FOOTER } from '../pdf-exporter';
import { createPdfFileExporter } from '../pdf-file-exporter';
import {
  BROWSER_DOWNLOAD_TIMEOUT_MS,
  NPM_INSTALL_TIMEOUT_MS,
  PDF_PLUGIN_VERSION,
  PdfPlugin,
  type ProcessRunner,
  runProcessWithSpawn,
} from '../pdf-plugin';

const temporaryDirectories: string[] = [];

function createTempDir(): string {
  const directory = mkdtempSync(join(tmpdir(), 'arcli-pdf-plugin-'));

  temporaryDirectories.push(directory);

  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    // En Windows un proceso recien cortado puede seguir usando la carpeta un momento (EPERM/EBUSY): se reintenta.
    rmSync(directory, { force: true, maxRetries: 10, recursive: true, retryDelay: 100 });
  }
});

/** Simula lo que deja `npm install` en la carpeta del plugin. */
function fakeNpmInstall(root: string, version = PDF_PLUGIN_VERSION): void {
  const sdk = join(root, 'node_modules', '@arcasdk', 'pdf');
  const puppeteer = join(root, 'node_modules', 'puppeteer');

  mkdirSync(sdk, { recursive: true });
  mkdirSync(puppeteer, { recursive: true });
  writeFileSync(join(sdk, 'package.json'), JSON.stringify({ main: 'index.js', name: '@arcasdk/pdf', version }));
  writeFileSync(
    join(sdk, 'index.js'),
    'exports.InvoicePdfGenerator = class { constructor(o) { this.o = o; } async generate(d) { return Buffer.from(JSON.stringify({ d, o: this.o })); } };',
  );
  writeFileSync(join(puppeteer, 'package.json'), JSON.stringify({ name: 'puppeteer', version: '25.0.0' }));
}

function fakeBrowserDownload(cacheDir: string): void {
  const folder = join(cacheDir, 'chrome-headless-shell', 'mac_arm-1', 'chrome-headless-shell-mac-arm64');

  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, process.platform === 'win32' ? 'chrome-headless-shell.exe' : 'chrome-headless-shell'), '');
}

describe('PdfPlugin', () => {
  it('reports missing until the package and a browser are there', () => {
    const path = join(createTempDir(), 'pdf');
    const plugin = new PdfPlugin({ env: {}, findSystemBrowser: () => undefined, path });

    expect(plugin.getStatus()).toMatchObject({ installed: false, version: PDF_PLUGIN_VERSION });
    expect(() => plugin.load()).toThrow(/falta instalar el plugin/);

    fakeNpmInstall(path);

    expect(plugin.getStatus().installed).toBe(false);
    expect(() => plugin.load()).toThrow(/No se encontró un navegador/);
  });

  it('installs with npm ignoring scripts and skips the browser download when the system has one', async () => {
    const path = join(createTempDir(), 'pdf');
    const runProcess = vi.fn<ProcessRunner>(async (_command, _args, options) => {
      fakeNpmInstall(options.cwd);

      return { code: 0, output: '' };
    });
    const plugin = new PdfPlugin({ env: {}, findSystemBrowser: () => '/Applications/Chrome', path, runProcess });

    const status = await plugin.install();

    expect(runProcess).toHaveBeenCalledTimes(1);
    expect(runProcess.mock.calls[0][1]).toEqual(
      expect.arrayContaining(['--ignore-scripts', `@arcasdk/pdf@${PDF_PLUGIN_VERSION}`]),
    );
    expect(JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'))).toMatchObject({ private: true });
    expect(status).toMatchObject({ browser: '/Applications/Chrome', browserSource: 'sistema', installed: true });
  });

  it('downloads chrome-headless-shell into the plugin folder when there is no browser', async () => {
    const path = join(createTempDir(), 'pdf');
    const runProcess = vi.fn<ProcessRunner>(async (_command, args, options) => {
      if (args[0] === 'install') {
        fakeNpmInstall(options.cwd);
      } else {
        fakeBrowserDownload(options.env.PUPPETEER_CACHE_DIR ?? '');
      }

      return { code: 0, output: '' };
    });
    const plugin = new PdfPlugin({ env: {}, findSystemBrowser: () => undefined, path, runProcess });

    const status = await plugin.install();

    expect(runProcess).toHaveBeenCalledTimes(2);
    expect(runProcess.mock.calls[1][1]).toEqual(
      expect.arrayContaining(['browsers', 'install', 'chrome-headless-shell']),
    );
    expect(status).toMatchObject({ browserSource: 'descargado', installed: true });
    expect(findDownloadedBrowser(join(path, 'browsers'))).toBeDefined();
  });

  it('turns an npm failure into PDF_PLUGIN_INSTALL_ERROR with the last lines of output', async () => {
    const plugin = new PdfPlugin({
      env: {},
      findSystemBrowser: () => undefined,
      path: join(createTempDir(), 'pdf'),
      runProcess: async () => ({ code: 1, output: 'npm error code ECONNREFUSED' }),
    });

    await expect(plugin.install()).rejects.toMatchObject({
      code: 'PDF_PLUGIN_INSTALL_ERROR',
      details: { salida: 'npm error code ECONNREFUSED' },
    });
  });

  it('limits npm and the browser download and explains a timeout', async () => {
    const path = join(createTempDir(), 'pdf');
    const runProcess = vi.fn<ProcessRunner>(async (_command, args, options) => {
      if (args[0] === 'install') {
        fakeNpmInstall(options.cwd);

        return { code: 0, output: '' };
      }

      return { code: null, output: 'Downloading...', timedOut: true };
    });
    const plugin = new PdfPlugin({ env: {}, findSystemBrowser: () => undefined, path, runProcess });

    await expect(plugin.install()).rejects.toMatchObject({
      code: 'PDF_PLUGIN_INSTALL_ERROR',
      message: expect.stringMatching(/no terminó en 15 minutos/),
    });
    expect(runProcess.mock.calls.map(([, , options]) => options.timeoutMs)).toEqual([
      NPM_INSTALL_TIMEOUT_MS,
      BROWSER_DOWNLOAD_TIMEOUT_MS,
    ]);
  });

  it('kills a process that does not finish in time', async () => {
    const started = Date.now();
    const result = await runProcessWithSpawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], {
      cwd: createTempDir(),
      env: process.env,
      timeoutMs: 200,
    });

    expect(result).toMatchObject({ code: null, timedOut: true });
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('treats another installed version as missing', () => {
    const path = join(createTempDir(), 'pdf');

    fakeNpmInstall(path, '0.1.0');

    const plugin = new PdfPlugin({ env: {}, findSystemBrowser: () => '/chrome', path });

    expect(plugin.getStatus()).toMatchObject({ installed: false, installedVersion: '0.1.0' });
    expect(() => plugin.load()).toThrow(/versión 0.1.0/);
  });

  it('prefers the configured browser and removes everything on uninstall', () => {
    const path = join(createTempDir(), 'pdf');

    fakeNpmInstall(path);

    const plugin = new PdfPlugin({
      configuredBrowser: '/mi/chrome',
      env: {},
      findSystemBrowser: () => '/chrome',
      path,
    });

    expect(plugin.getStatus()).toMatchObject({ browser: '/mi/chrome', browserSource: 'config' });

    plugin.uninstall();

    expect(existsSync(path)).toBe(false);
  });
});

describe('exportBillingPdf', () => {
  const voucherKind = getVoucherKindByShortcut('fc');

  function createResult(environment: 'produccion' | 'testing'): BillingExecutionResult {
    if (!voucherKind) {
      throw new Error('fc');
    }

    return {
      dryRun: false,
      environment,
      payload: {
        CantReg: 1,
        CbteFch: '20261003',
        CbteTipo: 11,
        Concepto: 2,
        CondicionIVAReceptorId: 5,
        DocNro: 0,
        DocTipo: 99,
        ImpIVA: 0,
        ImpNeto: 1000,
        ImpOpEx: 0,
        ImpTotConc: 0,
        ImpTotal: 1000,
        ImpTrib: 0,
        MonCotiz: 1,
        MonId: 'PES',
        PtoVta: 3,
      },
      response: {
        cae: '76123456789012',
        caeVencimiento: '20261013',
        errors: [],
        events: [],
        observaciones: [],
        observacion: null,
        arcaNumber: 125,
        raw: { cae: '1', caeFchVto: '1', response: { FeDetResp: { FECAEDetResponse: [{ CbteDesde: 125 }] } } },
        resultado: 'A',
        suggestions: [],
        status: 'aprobado',
      },
      voucherKind,
    };
  }

  const config = {
    cuit: '20123456786',
    emisor: { domicilio: 'Calle 123', inicioActividades: '20200301', razonSocial: 'Ana Gomez' },
  };

  it('writes testing PDFs to a subfolder with the testing footer', async () => {
    const folder = createTempDir();
    const render = vi.fn(async () => new Uint8Array([1, 2, 3]));

    const path = await exportBillingPdf({ config, folder, renderer: { render }, result: createResult('testing') });

    expect(path).toBe(join(folder, 'testing', '20123456786', 'factura-c_0003-00000125.pdf'));
    expect(readFileSync(path)).toEqual(Buffer.from([1, 2, 3]));
    expect(render).toHaveBeenCalledWith(expect.objectContaining({ cbteDesde: 125 }), {
      footerText: TESTING_FOOTER,
      logo: undefined,
    });
  });

  it('un render que termina despues de cortar no deja un archivo', async () => {
    const controller = new AbortController();
    const folder = createTempDir();
    const exporter = createPdfFileExporter({
      folder,
      renderer: {
        render: async () => {
          controller.abort();

          return new Uint8Array([1]);
        },
      },
      signal: controller.signal,
    });

    await expect(
      exporter.export({ extras: {}, family: 'billing', result: createResult('testing') }, config),
    ).rejects.toMatchObject({ code: 'PDF_GENERATION_ERROR', message: 'Se cortó antes de generar el PDF.' });
    expect(readdirSync(folder)).toEqual([]);
  });

  it('never overwrites a PDF and keeps each issuer in its own folder', async () => {
    const folder = createTempDir();
    const render = vi.fn(async () => new Uint8Array([1]));
    const result = createResult('produccion');

    const first = await exportBillingPdf({ config, folder, renderer: { render }, result });
    const again = await exportBillingPdf({ config, folder, renderer: { render }, result });
    const otherIssuer = await exportBillingPdf({
      config: { ...config, cuit: '27111111117' },
      folder,
      renderer: { render },
      result,
    });

    expect(first).toBe(join(folder, '20123456786', 'factura-c_0003-00000125.pdf'));
    expect(again).toBe(join(folder, '20123456786', 'factura-c_0003-00000125-2.pdf'));
    expect(otherIssuer).toBe(join(folder, '27111111117', 'factura-c_0003-00000125.pdf'));
  });

  it('escapes HTML in every text before rendering, because the plugin template does not', async () => {
    const render = vi.fn(async () => new Uint8Array([1]));

    await exportBillingPdf({
      config: { ...config, emisor: { ...config.emisor, razonSocial: 'Gomez & Hijos' } },
      extras: {
        condicionVenta: '<script>alert(1)</script>',
        descripcion: '<img src=x onerror=alert(1)>',
        receptorNombre: 'Cliente "SA"',
      },
      folder: createTempDir(),
      renderer: { render },
      result: createResult('produccion'),
    });

    const [data] = render.mock.calls[0] as unknown as [
      {
        condicionVenta: string;
        emisor: { razonSocial: string };
        items: Array<{ descripcion: string }>;
        receptor: { razonSocial: string };
      },
    ];

    expect(data.emisor.razonSocial).toBe('Gomez &amp; Hijos');
    expect(data.condicionVenta).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(data.items[0]?.descripcion).toBe('&lt;img src=x onerror=alert(1)&gt;');
    expect(data.receptor.razonSocial).toBe('Cliente &quot;SA&quot;');
    expect(JSON.stringify(data)).not.toMatch(/[<>]/);
  });

  it('writes production PDFs to the folder itself with the logo as data URL', async () => {
    const folder = createTempDir();
    const logo = join(folder, 'logo.png');

    writeFileSync(logo, 'png');

    const render = vi.fn(async () => new Uint8Array([1]));
    const path = await exportBillingPdf({
      config: { ...config, emisor: { ...config.emisor, logo } },
      folder,
      renderer: { render },
      result: createResult('produccion'),
    });

    expect(path).toBe(join(folder, '20123456786', 'factura-c_0003-00000125.pdf'));
    expect(render).toHaveBeenCalledWith(expect.anything(), {
      footerText: undefined,
      logo: `data:image/png;base64,${Buffer.from('png').toString('base64')}`,
    });
  });

  it('loads the installed SDK and renders through it', async () => {
    const path = join(createTempDir(), 'pdf');

    fakeNpmInstall(path);

    const renderer = new PdfPlugin({ env: {}, findSystemBrowser: () => '/chrome', path }).load();
    const bytes = await renderer.render({ cbteDesde: 1 } as never, { footerText: 'x' });

    expect(JSON.parse(Buffer.from(bytes).toString())).toEqual({ d: { cbteDesde: 1 }, o: { footerText: 'x' } });
    expect(process.env.PUPPETEER_EXECUTABLE_PATH).toBe('/chrome');

    delete process.env.PUPPETEER_EXECUTABLE_PATH;
  });

  it('un error de archivo del SDK va traducido, con la misma sugerencia', async () => {
    const path = join(createTempDir(), 'pdf');

    fakeNpmInstall(path);
    writeFileSync(
      join(path, 'node_modules', '@arcasdk', 'pdf', 'index.js'),
      `exports.InvoicePdfGenerator = class { async generate() { throw Object.assign(new Error("EACCES: permission denied, open '/Users/ana/x/y.json'"), { code: 'EACCES', path: '/Users/ana/x/y.json', syscall: 'open' }); } };`,
    );

    const renderer = new PdfPlugin({ env: {}, findSystemBrowser: () => '/chrome', path }).load();

    await expect(renderer.render({} as never, {})).rejects.toMatchObject({
      code: 'PDF_GENERATION_ERROR',
      message: 'No se pudo generar el PDF: No se pudo abrir .../x/y.json: no tenés permiso.',
      suggestion: expect.stringContaining('pdfNavegador'),
    });

    delete process.env.PUPPETEER_EXECUTABLE_PATH;
  });

  it('nombra el package.json del plugin si es una carpeta', () => {
    const path = join(createTempDir(), 'pdf');
    const manifest = join(path, 'node_modules', '@arcasdk', 'pdf', 'package.json');

    mkdirSync(manifest, { recursive: true });

    expect(() => new PdfPlugin({ env: {}, findSystemBrowser: () => undefined, path }).getStatus()).toThrow(
      expect.objectContaining({ code: 'EISDIR', path: manifest }),
    );
  });

  it('describes failures for the output', () => {
    expect(toPdfFailure(new Error('boom'))).toEqual({ error: { code: 'PDF_GENERATION_ERROR', message: 'boom' } });
  });

  it('un error de archivo sale con la ruta abreviada y qué hacer, con el mismo código', () => {
    const path = '/Users/ana/Documents/facturas';
    const error = Object.assign(new Error(`EACCES: permission denied, mkdir '${path}'`), {
      code: 'EACCES',
      path,
      syscall: 'mkdir',
    });

    expect(toPdfFailure(error)).toEqual({
      error: {
        code: 'PDF_GENERATION_ERROR',
        message: 'No se pudo crear la carpeta .../Documents/facturas: no tenés permiso.',
        suggestion: expect.stringContaining('permiso'),
      },
    });
  });
});

describe('al cortar', () => {
  it.each(['antes', 'durante'])('corta el proceso de la instalación (%s)', async (when) => {
    const controller = new AbortController();

    if (when === 'antes') {
      controller.abort();
    } else {
      setTimeout(() => controller.abort(), 200);
    }

    const start = performance.now();
    const result = await runProcessWithSpawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], {
      cwd: createTempDir(),
      env: process.env,
      signal: controller.signal,
      timeoutMs: 20_000,
    });

    expect(result).toEqual({ code: null, output: '' });
    expect(performance.now() - start).toBeLessThan(10_000);
  });

  it('a un proceso que no hace caso lo mata, y recién ahí sigue', async () => {
    const controller = new AbortController();
    const folder = createTempDir();
    const pidFile = join(folder, 'pid');
    const result = runProcessWithSpawn(
      process.execPath,
      [
        '-e',
        "process.on('SIGTERM', () => {}); require('fs').writeFileSync('pid', String(process.pid)); setInterval(() => {}, 1000)",
      ],
      { cwd: folder, env: process.env, signal: controller.signal, timeoutMs: 20_000 },
    );

    await vi.waitFor(() => expect(readFileSync(pidFile, 'utf8')).not.toBe(''), { timeout: 10_000 });
    controller.abort();
    expect(await result).toEqual({ code: null, output: '', timedOut: false });
    await vi.waitFor(() => expect(() => process.kill(Number(readFileSync(pidFile, 'utf8')), 0)).toThrow());
  });

  it('una instalación a medias no pasa por instalada, y la siguiente empieza de cero', async () => {
    const path = join(createTempDir(), 'pdf');
    const leftover = join(path, 'node_modules', 'a-medias');
    let cut = true;
    const plugin = new PdfPlugin({
      env: {},
      findSystemBrowser: () => '/Applications/Chrome',
      path,
      runProcess: async () => {
        fakeNpmInstall(path);

        if (cut) {
          writeFileSync(leftover, '');
        }

        return { code: cut ? null : 0, output: '' };
      },
    });

    await expect(plugin.install()).rejects.toMatchObject({ code: 'PDF_PLUGIN_INSTALL_ERROR' });
    expect(plugin.getStatus().installed).toBe(false);
    expect(() => plugin.load()).toThrow(/falta instalar/);

    cut = false;
    expect((await plugin.install()).installed).toBe(true);
    expect(existsSync(leftover)).toBe(false);
  });

  it.each([
    ['0.1.0', '0.1.0'],
    [PDF_PLUGIN_VERSION, undefined],
  ])('si falla la instalación sobre %s, informa la versión %s y no está instalado', async (found, informed) => {
    const path = join(createTempDir(), 'pdf');

    fakeNpmInstall(path, found);
    writeFileSync(join(path, 'node_modules.incompleto'), '');

    const plugin = new PdfPlugin({ env: {}, findSystemBrowser: () => '/Applications/Chrome', path });

    expect(plugin.getStatus()).toMatchObject({ installed: false, installedVersion: informed });
    expect(() => plugin.load()).toThrow(informed ? /está en la versión 0.1.0/ : /falta instalar/);
  });

  it('un package.json a medio escribir de una instalación cortada no es un error', () => {
    const path = join(createTempDir(), 'pdf');

    fakeNpmInstall(path);
    writeFileSync(join(path, 'node_modules', '@arcasdk', 'pdf', 'package.json'), '{"name"');
    writeFileSync(join(path, 'node_modules.incompleto'), '');

    expect(new PdfPlugin({ env: {}, findSystemBrowser: () => '/x', path }).getStatus().installed).toBe(false);
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'si lo que quedó a medias no se puede borrar, es un error de la instalación',
    async () => {
      const path = join(createTempDir(), 'pdf');
      const locked = join(path, 'node_modules', '@arcasdk');

      fakeNpmInstall(path);
      writeFileSync(join(path, 'node_modules.incompleto'), '');
      chmodSync(locked, 0o555);

      const runProcess = vi.fn<ProcessRunner>();

      try {
        await expect(
          new PdfPlugin({ env: {}, findSystemBrowser: () => '/x', path, runProcess }).install(),
        ).rejects.toMatchObject({
          code: 'PDF_PLUGIN_INSTALL_ERROR',
          message: expect.stringContaining('No se pudo borrar la instalación a medias'),
        });
        expect(runProcess).not.toHaveBeenCalled();
      } finally {
        chmodSync(locked, 0o755);
      }
    },
  );

  it.each([
    ['sin marca, se instala sobre lo que hay', false],
    ['con marca y sin nada que borrar, también se instala', true],
  ])('%s', async (_name, marked) => {
    const path = join(createTempDir(), 'pdf');
    const previous = join(path, 'node_modules', 'de-antes');

    mkdirSync(marked ? path : join(path, 'node_modules'), { recursive: true });
    writeFileSync(marked ? join(path, 'node_modules.incompleto') : previous, '');

    const plugin = new PdfPlugin({
      env: {},
      findSystemBrowser: () => '/x',
      path,
      runProcess: async () => {
        fakeNpmInstall(path);

        return { code: 0, output: '' };
      },
    });

    expect((await plugin.install()).installed).toBe(true);
    expect(existsSync(previous)).toBe(!marked);
    expect(existsSync(join(path, 'node_modules.incompleto'))).toBe(false);
  });

  it('un navegador descargado a medias no se usa', async () => {
    const path = join(createTempDir(), 'pdf');
    let cut = true;
    const plugin = new PdfPlugin({
      env: {},
      findSystemBrowser: () => undefined,
      path,
      runProcess: async (_command, args, options) => {
        if (args[0] === 'install') {
          fakeNpmInstall(path);

          return { code: 0, output: '' };
        }

        fakeBrowserDownload(options.env.PUPPETEER_CACHE_DIR ?? '');

        return { code: cut ? null : 0, output: '' };
      },
    });

    await expect(plugin.install()).rejects.toMatchObject({ code: 'PDF_PLUGIN_INSTALL_ERROR' });
    expect(plugin.getStatus()).toMatchObject({ browser: undefined, installed: false });

    cut = false;
    expect((await plugin.install()).installed).toBe(true);
  });
});
