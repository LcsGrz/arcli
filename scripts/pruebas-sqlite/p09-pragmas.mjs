import path from 'node:path';
import { performance } from 'node:perf_hooks';

import { abrir, carpeta, caso, con, DB, falla, intento, uno } from './comun.mjs';

const d0 = carpeta('p09');
const tocarEsquema = (c) => {
  c.exec('PRAGMA writable_schema=ON');
  c.exec("UPDATE sqlite_schema SET sql=sql WHERE name='t'");
  return 'permitido';
};
const archivo = path.join(d0, 'def.db');
con(archivo, (c) => c.exec('CREATE TABLE t(a)'));
await caso('9 defensive por defecto', (f) => f(`escribir el esquema: ${intento(() => con(archivo, tocarEsquema))}`));
await caso('9 defensive: true explícito', (f) => {
  const x = intento(() => con(archivo, tocarEsquema, { defensive: true }));
  f(`escribir el esquema: ${x}`, falla(x));
});
await caso('9 enableDefensive()', (f) => {
  const activar = (c) => {
    c.enableDefensive(true);
    return tocarEsquema(c);
  };
  f(`${typeof DB.prototype.enableDefensive}; escribir el esquema: ${intento(() => con(archivo, activar))}`);
});
const PRAGMAS = ['busy_timeout', 'foreign_keys', 'trusted_schema', 'synchronous', 'journal_mode', 'fullfsync'];
await caso('9 valores por defecto', (f) => {
  const d = new DB(archivo);
  f(PRAGMAS.map((p) => `${p} ${uno(d, `PRAGMA ${p}`)}`).join(', '));
  d.close();
});
await caso('9 opción timeout', (f) => {
  const v = con(archivo, (c) => uno(c, 'PRAGMA busy_timeout'), { timeout: 5000 });
  f(`busy_timeout ${v}`, v === 5000);
});
await caso('9 trusted_schema=OFF', (f) => {
  const d = new DB(archivo);
  d.exec('PRAGMA trusted_schema=OFF');
  const v = uno(d, 'PRAGMA trusted_schema');
  d.close();
  f(v, v === 0);
});
for (const journal of ['DELETE', 'WAL'])
  for (const p of ['synchronous=NORMAL', 'synchronous=FULL', 'synchronous=EXTRA', 'fullfsync=1'])
    await caso(`9 ms por inserción ${journal} ${p}`, (f) => {
      const x = abrir(path.join(d0, `${journal}${p.replace('=', '')}.db`), journal);
      x.exec(`PRAGMA ${p}; CREATE TABLE t(a)`);
      const ms = [];
      for (let i = 0; i < 100; i++) {
        const t = performance.now();
        x.prepare('INSERT INTO t VALUES(1)').run();
        ms.push(performance.now() - t);
      }
      x.close();
      ms.sort((a, b) => a - b);
      f(`mediana ${ms[50].toFixed(2)}, p95 ${ms[95].toFixed(2)}, peor ${ms[99].toFixed(2)}`);
    });
