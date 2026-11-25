import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { abrir, carpeta, caso, con, DB, intento, WIN } from './comun.mjs';

const verModo = (d) => (n) => `${n} ${(fs.statSync(path.join(d, n)).mode & 0o777).toString(8)}`;
for (const mascara of [0o022, 0o077])
  for (const pre of [false, true])
    for (const journal of ['DELETE', 'WAL'])
      await caso(`8 umask ${mascara.toString(8)}${pre ? ' precreada 0600' : ''} ${journal}`, (f) => {
        const vieja = process.umask(mascara);
        try {
          const d = carpeta(`p08-${mascara}${pre}${journal}`);
          const archivo = path.join(d, 'x.db');
          if (pre) fs.writeFileSync(archivo, '', { mode: 0o600 });
          const x = abrir(archivo, journal);
          x.exec('CREATE TABLE t(a); BEGIN IMMEDIATE; INSERT INTO t VALUES(1)');
          const m = fs.readdirSync(d).map(verModo(d));
          x.exec('COMMIT');
          x.close();
          f(m.join(', '), WIN || (!pre && mascara === 0o022) ? undefined : m.every((z) => z.endsWith(' 600')));
        } finally {
          process.umask(vieja);
        }
      });

const leer = (c) => `${c.prepare('SELECT * FROM t').all().length} filas`;
const escribir = (c) => {
  c.exec('INSERT INTO t VALUES(2)');
  return 'escribió';
};
for (const journal of ['DELETE', 'WAL'])
  await caso(`8 carpeta de solo lectura ${journal}`, (f) => {
    const d = carpeta(`p08ro${journal}`);
    const archivo = path.join(d, 'x.db');
    const x = abrir(archivo, journal);
    x.exec('CREATE TABLE t(a); INSERT INTO t VALUES(1)');
    x.close();
    fs.chmodSync(d, 0o500);
    try {
      f(
        intento(() => con(archivo, leer)),
        undefined,
        ': leer',
      );
      f(
        intento(() => con(archivo, leer, { readOnly: true })),
        undefined,
        ': leer con readOnly',
      );
      f(
        intento(() => con(archivo, escribir)),
        undefined,
        ': escribir',
      );
      const crear = () => {
        new DB(path.join(d, 'n.db')).close();
        return 'creó';
      };
      f(intento(crear), undefined, ': crear');
      fs.chmodSync(archivo, 0o400);
      f(
        intento(() => con(archivo, escribir)),
        undefined,
        ': escribir con el archivo en 0400',
      );
    } finally {
      fs.chmodSync(d, 0o700);
      fs.chmodSync(archivo, 0o600);
    }
  });

// Con la ruta completa: lo primero en el PATH podría ser otro.
const ICACLS = path.join(process.env.SystemRoot ?? '', 'System32', 'icacls.exe');
const icacls = (...a) => execFileSync(ICACLS, a, { encoding: 'utf8' });
const permisosDe = (archivo) =>
  icacls(archivo)
    .replace(archivo, '')
    .split('\n')
    .filter((z) => z.includes(':('))
    .map((z) => z.trim())
    .join(' ; ');
if (WIN)
  for (const que of ['nada', 'archivo', 'carpeta'])
    for (const journal of ['DELETE', 'WAL'])
      await caso(`8 ACL restringiendo ${que} ${journal}`, (f) => {
        const d = carpeta(`p08acl${que}${journal}`);
        const archivo = path.join(d, 'x.db');
        const yo = os.userInfo().username;
        if (que === 'carpeta') icacls(d, '/inheritance:r', '/grant:r', `${yo}:(OI)(CI)F`);
        if (que === 'archivo') {
          fs.writeFileSync(archivo, '');
          icacls(archivo, '/inheritance:r', '/grant:r', `${yo}:F`);
        }
        const x = abrir(archivo, journal);
        x.exec('CREATE TABLE t(a); BEGIN IMMEDIATE; INSERT INTO t VALUES(1)');
        for (const n of fs.readdirSync(d)) {
          const p = intento(() => permisosDe(path.join(d, n)));
          f(p, undefined, `: ${n}`);
        }
        x.exec('COMMIT');
        x.close();
      });
