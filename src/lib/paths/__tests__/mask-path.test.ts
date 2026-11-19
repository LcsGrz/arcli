import { describe, expect, it } from 'vitest';

import { maskPath, shortenPath } from '../mask-path';

describe('mask-path', () => {
  it('keeps the filename and last directory only', () => {
    expect(maskPath('/Users/ana/secretos/cert.pem')).toBe('.../secretos/cert.pem');
  });

  it('handles plain filenames', () => {
    expect(maskPath('cert.pem')).toBe('.../cert.pem');
  });

  // TEST-19: bordes de la ruta.
  it('se detiene en un tramo `.` en vez de mostrarlo', () => {
    expect(maskPath('./cert.pem')).toBe('.../cert.pem');
    expect(maskPath('a/./b')).toBe('.../b');
  });

  it('ignora las barras repetidas o finales', () => {
    expect(maskPath('/Users//ana//cert.pem')).toBe('.../ana/cert.pem');
    expect(maskPath('//cert.pem')).toBe('.../cert.pem');
    expect(maskPath('/Users/ana/')).toBe('.../Users/ana');
  });

  it('con más profundidad muestra más tramos, sin pasar la raíz', () => {
    expect(maskPath('/Users/ana/arcli/certificados/20123456786', 3)).toBe('.../arcli/certificados/20123456786');
    expect(maskPath('/a/b', 5)).toBe('.../a/b');
  });

  it('una ruta vacía o solo la raíz queda como está', () => {
    expect(maskPath('')).toBe('');
    expect(maskPath('   ')).toBe('   ');
    expect(maskPath('/')).toBe('/');
  });
});

describe('shortenPath (TEST-19)', () => {
  it('desde la carpeta arcli si la ruta está adentro', () => {
    expect(shortenPath('/Users/ana/Library/Preferences/arcli/certificados/20123456786/x.crt')).toBe(
      '.../arcli/certificados/20123456786/x.crt',
    );
    expect(shortenPath('/arcli/tickets')).toBe('.../arcli/tickets');
  });

  it('una ruta relativa que empieza en arcli no se trata como la carpeta de arcli', () => {
    expect(shortenPath('arcli/certificados/20123456786/x.crt')).toBe('.../20123456786/x.crt');
  });

  it('fuera de arcli usa maskPath', () => {
    expect(shortenPath('/Users/ana/secretos/cert.pem')).toBe('.../secretos/cert.pem');
  });
});
