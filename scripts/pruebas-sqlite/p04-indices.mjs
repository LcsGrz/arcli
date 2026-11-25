import path from 'node:path';

import { abrir, carpeta, caso, intento } from './comun.mjs';

const d = abrir(path.join(carpeta('p04'), 'c.db'));
d.exec(
  'CREATE TABLE c(cae TEXT PRIMARY KEY NOT NULL,tipo INTEGER NOT NULL,pv INTEGER NOT NULL,numero INTEGER NOT NULL,importe TEXT,pdf TEXT,UNIQUE(tipo,pv,numero)) STRICT',
);
const A = '74000000000001';
const B = '74000000000009';
const alta = (verbo, ...v) => intento(() => d.prepare(`INSERT ${verbo} INTO c VALUES(?,?,?,?,?,?)`).run(...v).changes);
const UPSERT =
  'INSERT INTO c VALUES(?,?,?,?,?,?) ON CONFLICT(cae) DO UPDATE SET importe=coalesce(c.importe,excluded.importe),pdf=coalesce(c.pdf,excluded.pdf) WHERE c.tipo=excluded.tipo AND c.pv=excluded.pv AND c.numero=excluded.numero RETURNING importe,pdf';
const upsert = (...v) => intento(() => d.prepare(UPSERT).get(...v) ?? 'sin fila');
const espero = (nombre, medir, ok) =>
  caso(`4 ${nombre}`, (f) => {
    const medido = medir();
    f(medido, ok(medido));
  });
const error = (n) => (x) => String(x).startsWith(`ERROR ${n} `);

await espero(
  'alta',
  () => alta('', A, 6, 1, 10, '100.00', null),
  (x) => Number(x) === 1,
);
await espero('CAE repetido', () => alta('', A, 6, 1, 11, '1', null), error(1555));
await espero('tipo+PV+número repetido', () => alta('', B, 6, 1, 10, '1', null), error(2067));
await espero(
  'upsert completa sin pisar',
  () => upsert(A, 6, 1, 10, '999', 'a.pdf'),
  (x) => x.importe === '100.00' && x.pdf === 'a.pdf',
);
await espero(
  'upsert mismo CAE otro número',
  () => upsert(A, 6, 1, 55, '1', null),
  (x) => x === 'sin fila',
);
await espero('upsert otro CAE mismo número', () => upsert(B, 6, 1, 10, '1', null), error(2067));
await espero(
  'OR IGNORE otro CAE mismo número',
  () => alta('OR IGNORE', B, 6, 1, 10, '1', null),
  (x) => Number(x) === 0,
);
await espero(
  'OR REPLACE borra el anterior',
  () => {
    alta('OR REPLACE', B, 6, 1, 10, '1', null);
    return d.prepare('SELECT cae FROM c').all();
  },
  (x) => x.length === 1 && x[0].cae === B,
);
await espero('STRICT tipo malo', () => alta('', '1', 'x', 1, 1, null, null), error(3091));
await espero('undefined como parámetro', () => alta('', '2', 1, 2, 3, undefined, null), error('ERR_INVALID_ARG_TYPE'));
await espero(
  'entero mayor a 2^53',
  () => intento(() => d.prepare('SELECT 9007199254740993 x').get().x),
  error('ERR_OUT_OF_RANGE'),
);
d.close();
