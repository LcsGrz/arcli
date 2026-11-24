import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { describeFileError, errorText, isFileSystemError, withFilePath } from '../file-error';

/** Un error como los arma Node: `CODIGO: descripcion, operacion 'ruta'`. */
function nodeError(code: string, syscall: string, path?: string, dest?: string): NodeJS.ErrnoException {
  const target = path === undefined ? '' : ` '${path}'`;

  return Object.assign(new Error(`${code}: some english text, ${syscall}${target}`), { code, dest, path, syscall });
}

const PATH = '/Users/ana/Documents/facturas/datos.json';
const CONFIG = '/Users/ana/Library/Preferences/arcli/config.json';

const folder = mkdtempSync(join(tmpdir(), 'arcli-errores-'));

afterAll(() => rmSync(folder, { force: true, recursive: true }));

describe('describeFileError', () => {
  it.each([
    ['EACCES', 'open', 'No se pudo abrir .../facturas/datos.json: no tenés permiso.'],
    ['EPERM', 'mkdir', 'No se pudo crear la carpeta .../facturas/datos.json: el sistema no lo permite.'],
    ['EISDIR', 'read', 'No se pudo leer .../facturas/datos.json: es una carpeta.'],
    ['ENOTDIR', 'open', 'No se pudo abrir .../facturas/datos.json: una parte de la ruta no es una carpeta.'],
    ['EROFS', 'open', 'No se pudo abrir .../facturas/datos.json: el disco es de solo lectura.'],
    ['ENOSPC', 'write', 'No se pudo escribir .../facturas/datos.json: no queda espacio en el disco.'],
    ['ENOENT', 'open', 'No se pudo abrir .../facturas/datos.json: no existe.'],
    ['EEXIST', 'mkdir', 'No se pudo crear la carpeta .../facturas/datos.json: ya hay un archivo con ese nombre.'],
    ['EACCES', 'unlink', 'No se pudo borrar .../facturas/datos.json: no tenés permiso.'],
  ])('%s al hacer %s dice qué, dónde y por qué, sin la carpeta del usuario', (code, syscall, message) => {
    const description = describeFileError(nodeError(code, syscall, PATH));

    expect(description?.message).toBe(message);
    expect(description?.suggestion).toMatch(/^[A-ZÁ].*\.$/);
    expect(JSON.stringify(description)).not.toMatch(/Users|english|EACCES|EPERM/);
  });

  it('sin ruta dice igual qué se quiso hacer', () => {
    expect(describeFileError(nodeError('ENOSPC', 'write'))?.message).toBe(
      'No se pudo escribir el archivo: no queda espacio en el disco.',
    );
    expect(describeFileError(nodeError('EPERM', 'mkdir'))?.message).toBe(
      'No se pudo crear la carpeta: el sistema no lo permite.',
    );
  });

  it.each([
    nodeError('EACCES', 'open', `${CONFIG}.tmp-1763999999999a1b2c3`),
    nodeError('EACCES', 'rename', `${CONFIG}.tmp-1763999999999a1b2c3`, CONFIG),
  ])('nombra el archivo y no el temporal con el que se guarda (%#)', (error) => {
    expect(describeFileError(error)?.message).toBe('No se pudo escribir .../arcli/config.json: no tenés permiso.');
  });

  it.each([
    ['ENOENT', 'No se pudo copiar .../facturas/datos.json: no existe.'],
    ['EACCES', 'No se pudo copiar .../otra/copia.json: no tenés permiso.'],
  ])('al copiar, %s nombra el que falla', (code, message) => {
    expect(describeFileError(nodeError(code, 'copyfile', PATH, '/otra/copia.json'))?.message).toBe(message);
  });

  it('nombra la .app de macOS y no una carpeta de adentro', () => {
    expect(describeFileError(nodeError('EPERM', 'mkdir', '/usr/lib/ARCLI.app/Contents/MacOS'))?.message).toBe(
      'No se pudo crear la carpeta .../lib/ARCLI.app: el sistema no lo permite.',
    );
  });

  it.each([
    Object.assign(new Error('connect EACCES 10.0.0.1:443'), { code: 'EACCES', syscall: 'connect' }),
    Object.assign(new Error('connect EPERM 10.0.0.1:443'), { code: 'EPERM', syscall: 'connect' }),
    Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET', syscall: 'read' }),
    Object.assign(new Error('write EPERM'), { code: 'EPERM', syscall: 'write' }),
    Object.assign(new Error('spawn npm EACCES'), { code: 'EACCES', path: 'npm', syscall: 'spawn npm' }),
    nodeError('EIO', 'read', PATH),
    nodeError('EACCES', 'constructor', PATH),
    nodeError('constructor', 'open', PATH),
    new Error('EACCES: permission denied'),
    'EACCES',
    undefined,
  ])('la red, los procesos y lo desconocido salen como hoy (%#)', (error) => {
    expect(describeFileError(error)).toBeUndefined();
  });

  it('reconoce un error real de Node', () => {
    const read = () => withFilePath(folder, () => readFileSync(folder, 'utf8'));

    expect(read).toThrow(expect.objectContaining({ code: 'EISDIR', path: folder }));

    try {
      read();
    } catch (error) {
      expect(describeFileError(error)?.message).toMatch(/^No se pudo leer \.\.\.\/.*: es una carpeta\.$/);
    }
  });
});

describe('errorText', () => {
  it('traduce un error de archivo y deja el resto igual', () => {
    expect(errorText(nodeError('EISDIR', 'read', PATH))).toBe(
      'No se pudo leer .../facturas/datos.json: es una carpeta.',
    );
    expect(errorText(new Error('boom'))).toBe('boom');
    expect(errorText('texto')).toBe('texto');
  });
});

describe('withFilePath', () => {
  it.each([
    ['sin ruta', nodeError('EISDIR', 'read'), PATH],
    ['con la suya', nodeError('EACCES', 'open', '/otra/ruta'), '/otra/ruta'],
    ['de otra cosa', new Error('boom') as NodeJS.ErrnoException, undefined],
  ])('un error %s', (_name, error, expected) => {
    expect(() =>
      withFilePath(PATH, () => {
        throw error;
      }),
    ).toThrow(error);
    expect(error.path).toBe(expected);
  });
});

describe('isFileSystemError', () => {
  it('reconoce los de Node', () => {
    expect(isFileSystemError(nodeError('EIO', 'read'))).toBe(true);
    expect(isFileSystemError(new Error('x'))).toBe(false);
  });
});
