import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import { abrir, carpeta, caso, con, espera, hastaSalida, hijo, integridad, intento, sqlite, uno } from './comun.mjs';

const d0 = carpeta('p07');
const copiaEn = (d, destino) => d.prepare('VACUUM INTO ?').run(destino);
const verCopia = (c) => `${integridad(c)}, ${uno(c, 'SELECT count(*) FROM t')} filas, ${uno(c, 'PRAGMA journal_mode')}`;
for (const journal of ['DELETE', 'WAL']) {
  for (const pausa of [1, 50]) {
    await caso(`7 copia en caliente ${journal}, escrituras cada ${pausa} ms`, async (f) => {
      const archivo = path.join(d0, `hot${journal}${pausa}.db`);
      const x = abrir(archivo, journal);
      x.exec('CREATE TABLE t(k TEXT PRIMARY KEY,v); BEGIN');
      for (let i = 0; i < 20000; i++) x.prepare('INSERT INTO t VALUES(?,?)').run(`i${i}`, 'z'.repeat(200));
      x.exec('COMMIT');
      const h = hijo('continuo', archivo, journal, 10000, pausa);
      try {
        await hastaSalida(h);
        const formas = {
          'VACUUM INTO': (dst) => copiaEn(x, dst),
          'copyFile del .db': (dst) => fs.copyFileSync(archivo, dst),
          'backup rate 1000000': (dst) => sqlite.backup(x, dst, { rate: 1000000 }),
          'backup por defecto': (dst) => sqlite.backup(x, dst),
        };
        for (const [i, [nombre, copiar]] of Object.entries(formas).entries()) {
          const dst = `${archivo}.copia${i}`;
          const t = performance.now();
          let error = '';
          try {
            // No cancela el backup: solo deja de esperarlo.
            await Promise.race([
              Promise.resolve().then(() => copiar(dst)),
              espera(3000, null, { ref: false }).then(() => Promise.reject(new Error('más de 3 s'))),
            ]);
          } catch (e) {
            error = `, error ${e.errcode ?? e.code ?? ''} ${e.message}`;
          }
          const ms = Math.round(performance.now() - t);
          const r = String(intento(() => con(dst, verCopia, { readOnly: true, timeout: 0 })));
          const modo = intento(() => (fs.statSync(dst).mode & 0o777).toString(8));
          const ok = nombre === 'VACUUM INTO' ? !error && r.startsWith('ok, 2') : undefined;
          f(`${ms} ms, ${r}, modo ${modo}${error}`, ok, `: ${nombre}`);
        }
        const otra = String(intento(() => copiaEn(x, `${archivo}.copia0`)));
        f(otra, otra.startsWith('ERROR'), ': VACUUM INTO sobre existente');
      } finally {
        await h.fin;
        f(h.out.trim().split('\n').at(-1), undefined, ': escritor');
        x.close();
      }
    });
  }
}
await caso('7 VACUUM INTO + rename', (f) => {
  const x = abrir(path.join(d0, 'viva.db'));
  x.exec('CREATE TABLE t(k); INSERT INTO t VALUES(1)');
  const destino = path.join(d0, 'copia.db');
  try {
    for (const sub of [' nuevo', ' sobre existente']) {
      copiaEn(x, `${destino}.tmp`);
      fs.renameSync(`${destino}.tmp`, destino);
      const r = con(destino, integridad);
      f(r, r === 'ok', sub);
    }
  } finally {
    x.close();
  }
});
