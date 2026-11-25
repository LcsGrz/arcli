import fs from 'node:fs';
import path from 'node:path';

import { abrir, carpeta, caso, con, espera, hastaSalida, hijo, integridad, intento, uno } from './comun.mjs';

const d0 = carpeta('p03');
for (const journal of ['DELETE', 'WAL']) {
  for (const modo of ['victima', 'confirmador']) {
    const titulo = modo === 'victima' ? 'a mitad de transacción' : 'confirmando de a una';
    await caso(`3 kill x20 ${titulo} ${journal}`, async (f) => {
      const archivo = path.join(d0, `${modo}${journal}.db`);
      const d = abrir(archivo, journal);
      d.exec('CREATE TABLE t(k TEXT PRIMARY KEY,v)');
      d.close();
      const r = { sanas: 0, parciales: 0, perdidas: 0, confirmadas: 0, acompanante: 0, errores: [], peorMs: 0 };
      for (let i = 0; i < 20; i++) {
        const h = hijo(modo, archivo, journal);
        await hastaSalida(h);
        await espera(Math.random() * 30);
        h.kill('SIGKILL');
        await h.fin;
        if (['-journal', '-wal'].some((s) => fs.existsSync(archivo + s))) r.acompanante++;
        // timeout 0: si el muerto dejara un bloqueo tomado, se ve.
        const t = Date.now();
        const mirar = (c) => ({ sana: integridad(c), n: uno(c, 'SELECT count(*) FROM t') });
        const visto = intento(() => con(archivo, mirar, { timeout: 0 }));
        r.peorMs = Math.max(r.peorMs, Date.now() - t);
        if (typeof visto === 'string') {
          r.errores.push(visto);
          continue;
        }
        if (visto.sana === 'ok') r.sanas++;
        if (modo === 'victima') r.parciales += visto.n ? 1 : 0;
        else {
          // Solo líneas completas: el kill puede cortar la última.
          const avisada = Number(h.out.slice(0, h.out.lastIndexOf('\n')).split('\n').at(-1));
          r.perdidas += Math.max(0, avisada - visto.n);
          r.confirmadas = visto.n;
        }
      }
      const datos =
        modo === 'victima' ? `parciales ${r.parciales}` : `confirmadas ${r.confirmadas}, perdidas ${r.perdidas}`;
      f(
        `${r.sanas}/20 sanas, ${datos}, quedó journal o wal ${r.acompanante}/20, peor reapertura ${r.peorMs} ms, errores al reabrir con timeout 0: ${r.errores.length} ${r.errores[0] ?? ''}`,
        r.sanas === 20 && !r.parciales && !r.perdidas,
      );
    });
  }
}
