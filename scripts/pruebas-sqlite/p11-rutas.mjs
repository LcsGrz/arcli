import fs from 'node:fs';
import path from 'node:path';

import { abrir, carpeta, caso, con, contar, hijo, intento, WIN } from './comun.mjs';

const rutas = {
  'con espacios': 'mis documentos de arca',
  'con acentos y ñ': 'José Ñandú áéíóú',
  'con ñ descompuesta (NFD)': 'Ñandú'.normalize('NFD'),
  'con emoji': 'caja 🧾',
  'con apóstrofo': "D'Angelo",
  'con # y %20': 'a#b%20c',
  'con ; & y paréntesis': 'a;b&c (copia en conflicto)',
  ...(WIN ? {} : { 'con ?': 'a?mode=ro' }),
};
for (const [nombre, sub] of Object.entries(rutas))
  for (const journal of ['DELETE', 'WAL'])
    await caso(`11 ruta ${nombre} ${journal}`, async (f) => {
      const d = carpeta(`p11 ${journal}/${sub}`);
      const archivo = path.join(d, `${sub}.db`);
      const x = abrir(archivo, journal);
      x.exec('CREATE TABLE t(k TEXT PRIMARY KEY,v)');
      await hijo('escritor', archivo, '-', 5000, 20, 'a', 'immediate').fin;
      x.prepare('VACUUM INTO ?').run(`${archivo}.copia`);
      x.close();
      const r = [contar(archivo), contar(`${archivo}.copia`)];
      const esta = fs.existsSync(archivo);
      f(`base ${r[0]}; copia ${r[1]}; archivo en su lugar: ${esta}`, esta && r.every((z) => z === 'ok, 20 filas'));
    });

for (const largo of [200, 250, 259, 300])
  await caso(`11 ruta de ${largo} caracteres`, (f) => {
    let dir = carpeta('p11largo');
    // Carpetas de 50 hasta cerca, y el resto en el nombre del archivo.
    while (dir.length + 51 + 10 < largo) dir = path.join(dir, 'a'.repeat(50));
    fs.mkdirSync(dir, { recursive: true });
    const archivo = path.join(dir, `${'b'.repeat(Math.max(1, largo - dir.length - 4))}.db`);
    const usar = (c) => {
      c.exec('CREATE TABLE t(a); INSERT INTO t VALUES(1)');
      return 'ok';
    };
    f(`${archivo.length} caracteres: ${intento(() => con(archivo, usar))}`);
  });
