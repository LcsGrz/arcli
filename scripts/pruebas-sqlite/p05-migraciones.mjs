import fs from 'node:fs';
import path from 'node:path';

import { abrir, carpeta, caso, con, falla, hastaSalida, hijo, integridad, intento, uno } from './comun.mjs';

const d0 = carpeta('p05');
const verEstado = (c) =>
  `versión ${uno(c, 'PRAGMA user_version')}, ${c.prepare('PRAGMA table_info(c)').all().length} columnas, ${integridad(c)}`;
for (const journal of ['DELETE', 'WAL']) {
  for (const tx of ['si', 'no']) {
    await caso(`5 kill x20 migrando ${journal} ${tx === 'si' ? 'con' : 'sin'} transacción`, async (f) => {
      const archivo = path.join(d0, `${journal}${tx}.db`);
      const x = abrir(archivo, journal);
      x.exec('CREATE TABLE c(a); PRAGMA user_version=1; BEGIN');
      const s = x.prepare('INSERT INTO c VALUES(?)');
      for (let i = 0; i < 5000; i++) s.run('z'.repeat(200));
      x.exec('COMMIT');
      x.close();
      const vistos = {};
      for (let k = 0; k < 20; k++) {
        const h = hijo('migra', archivo, journal, tx);
        let reintento = '';
        try {
          await hastaSalida(h);
        } catch (e) {
          reintento = `, reintentar: ${/Error: (.*)/.exec(e.message)?.[1] ?? e.message.slice(-120)}`;
        }
        h.kill('SIGKILL');
        await h.fin;
        const v = con(archivo, verEstado) + reintento;
        vistos[v] = (vistos[v] ?? 0) + 1;
      }
      f(vistos, tx === 'si' ? vistos['versión 1, 1 columnas, ok'] === 20 : undefined);
    });
  }
}
for (const modo of ['afuera', 'adentro']) {
  await caso(`5 cuatro procesos x20, versión leída ${modo} de la transacción`, async (f) => {
    const c = {};
    for (let k = 0; k < 20; k++) {
      const h = [1, 2, 3, 4].map(() => hijo('migra2', path.join(d0, `${modo}${k}.db`), modo));
      await Promise.all(h.map((x) => x.fin));
      for (const x of h) {
        const s = x.out.trim() || x.err.slice(-150);
        c[s] = (c[s] ?? 0) + 1;
      }
    }
    f(c, modo === 'adentro' ? c.ok === 80 : undefined);
  });
}
await caso('5 base de versión más nueva', (f) => {
  const archivo = path.join(d0, 'ver.db');
  let x = abrir(archivo);
  x.exec('CREATE TABLE c(a); PRAGMA user_version=99');
  x.close();
  const mirar = (c) => [uno(c, 'PRAGMA user_version'), intento(() => c.exec('CREATE TABLE z(a)'))];
  const [v, escribir] = con(archivo, mirar, { readOnly: true });
  f(`versión ${v}, escribir: ${escribir}`, v === 99 && falla(escribir), ' con readOnly');
  const antes = fs.readFileSync(archivo);
  for (const journal of ['DELETE', 'WAL']) {
    x = abrir(archivo, journal);
    uno(x, 'PRAGMA user_version');
    x.close();
    f(`modifica el archivo: ${!antes.equals(fs.readFileSync(archivo))}`, undefined, `, journal_mode=${journal}`);
  }
});
