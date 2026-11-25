import path from 'node:path';

import { abrir, carpeta, caso, con, hijo, integridad, uno } from './comun.mjs';

const d0 = carpeta('p02');
const correr = async (archivo, journal, n, ids, { timeout, tx, pragma = '-' }) => {
  const d = abrir(archivo, journal);
  d.exec('CREATE TABLE t(k TEXT PRIMARY KEY,v)');
  d.close();
  const h = ids.map((id) => hijo('escritor', archivo, pragma, timeout, n, id, tx));
  await Promise.all(h.map((x) => x.fin));
  const roto = (x) => JSON.stringify({ w: 0, locked: 0, otros: { [x.err.slice(-200)]: 1 }, maxMs: 0, totalMs: 0 });
  const o = h.map((x) => JSON.parse(x.out || roto(x)));
  const suma = (k) => o.reduce((t, x) => t + x[k], 0);
  const peor = (k) => Math.max(...o.map((x) => x[k]));
  const [filas, sana] = con(archivo, (c) => [uno(c, 'SELECT count(*) FROM t'), integridad(c)]);
  const otros = Object.keys(Object.assign({}, ...o.map((x) => x.otros)));
  const total = n * ids.length;
  return {
    texto: `${filas}/${total} filas, confirmadas ${suma('w')}, locked ${suma('locked')}, peor espera ${peor('maxMs')} ms, total ${peor('totalMs')} ms, integridad ${sana}, otros errores: ${otros.join(' ; ') || 'ninguno'}`,
    sinPerdidas: filas === suma('w') && sana === 'ok',
    completas: filas === total,
  };
};
for (const journal of ['DELETE', 'TRUNCATE', 'WAL']) {
  for (const timeout of [0, 5000]) {
    for (const tx of ['immediate', 'deferred']) {
      await caso(`2 dos procesos ${journal} ${tx} timeout ${timeout}`, async (f) => {
        const r = await correr(path.join(d0, `${journal}${timeout}${tx}.db`), journal, 300, ['a', 'b'], {
          timeout,
          tx,
        });
        // Lo exigido: IMMEDIATE con 5 s no falla nunca. En los demás, solo que no se pierda nada confirmado.
        f(r.texto, r.sinPerdidas && (tx !== 'immediate' || timeout === 0 || r.completas));
      });
    }
  }
}
for (const journal of ['DELETE', 'WAL']) {
  await caso(`2 ocho procesos ${journal} immediate timeout 5000`, async (f) => {
    const r = await correr(path.join(d0, `ocho${journal}.db`), journal, 100, [...'abcdefgh'], {
      timeout: 5000,
      tx: 'immediate',
      pragma: journal,
    });
    f(r.texto, r.sinPerdidas && r.completas);
  });
}
