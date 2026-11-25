import fs from 'node:fs';
import path from 'node:path';

import { abrir, carpeta, caso, DB, integridad, intento, uno } from './comun.mjs';

const d0 = carpeta('p06');
const base = path.join(d0, 'b.db');
{
  const x = abrir(base);
  x.exec('CREATE TABLE c(a TEXT PRIMARY KEY,b); PRAGMA user_version=1; BEGIN');
  for (let i = 0; i < 3000; i++) x.prepare('INSERT INTO c VALUES(?,?)').run(`k${i}`, 'v'.repeat(300));
  x.exec('COMMIT');
  x.close();
}
const B = fs.readFileSync(base);
const mitad = B.length >> 1;
// Lo que no avisa ninguna consulta ni integrity_check: se sabe, no es un fallo de la prueba.
const CIEGOS = ['un byte de un valor', '0 bytes', '1 byte'];
const casos = {
  'cabecera rota': (b) => b.fill(0xff, 0, 16),
  'tamaño de página roto': (b) => b.fill(0xff, 16, 18),
  'esquema roto': (b) => b.fill(0xff, 100, 400),
  'página del medio': (b) => b.fill(0xff, mitad, mitad + 4096),
  'un byte de un valor': (b) => b.fill(0x21, b.lastIndexOf('v'.repeat(300)) + 5, b.lastIndexOf('v'.repeat(300)) + 6),
  'truncada a la mitad': (b) => b.subarray(0, mitad),
  'truncada no múltiplo': (b) => b.subarray(0, b.length - 777),
  'truncada a 100 bytes': (b) => b.subarray(0, 100),
  '0 bytes': () => Buffer.alloc(0),
  '1 byte': () => Buffer.from('x'),
  'es un JSON': () => Buffer.from('{"hola":1}\n'.repeat(500)),
  'es un zip': () => Buffer.from(`PK\x03\x04${'\0'.repeat(5000)}`),
};
const corto = (x) => {
  const e = /^ERROR (\S+)/.exec(String(x));
  return e ? `error ${e[1]}` : String(x).slice(0, 50);
};
let n = 0;
for (const [nombre, danar] of Object.entries(casos)) {
  await caso(`6 ${nombre}`, (f) => {
    const archivo = path.join(d0, `d${n++}.db`);
    fs.writeFileSync(archivo, danar(Buffer.from(B)));
    let d;
    const abre = intento(() => {
      d = new DB(archivo, { timeout: 1000 });
    });
    if (!d) {
      f(`abrir: ${abre}`, false);
      return;
    }
    const lecturas = {
      versión: () => uno(d, 'PRAGMA user_version'),
      contar: () => JSON.stringify(Object.values(d.prepare('SELECT count(*) n,sum(length(b)) s FROM c').get())),
      fila: () => uno(d, "SELECT length(b) FROM c WHERE a='k5'"),
      quick: () => uno(d, 'PRAGMA quick_check(1)'),
      integridad: () => integridad(d),
    };
    const r = Object.entries(lecturas).map(([k, g]) => [k, corto(intento(g))]);
    d.close();
    f(
      r.map(([k, v]) => `${k} ${v}`).join('; '),
      CIEGOS.includes(nombre) ? undefined : Object.fromEntries(r).integridad !== 'ok',
    );
  });
}
for (const [nombre, abrirla] of [
  ['carpeta en vez de archivo', () => new DB(d0)],
  ['carpeta inexistente', () => new DB(path.join(d0, 'no', 'x.db'))],
  ['readOnly inexistente', () => new DB(path.join(d0, 'no.db'), { readOnly: true })],
])
  await caso(`6 ${nombre}`, (f) => {
    const x = intento(abrirla);
    f(String(x), String(x).startsWith('ERROR 14'));
  });
