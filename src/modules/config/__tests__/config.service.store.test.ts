import { describe, expect, it } from 'vitest';

import { nodeLocalFiles } from '../../../services/files/local-files';
import { MemoryConfigStore } from '../../../testing/memory-config-store';
import { CONFIG_DEFAULTS } from '../config.schemas';
import { ConfigService } from '../config.service';
import type { StoredConfig } from '../config-store';

/**
 * ARQ-12 PR 3: ConfigService lee y escribe por el puerto `ConfigStore`. Cada operación que escribe es un solo `update`
 * y decide sobre lo que relee ahí: si otro proceso escribió en el medio, su cambio queda. Sin bloqueo entre procesos
 * (ARQ-26), esto es lo que se puede afirmar: el fake corre `beforeUpdate` justo antes de releer.
 */

const CUIT = '20123456786';
const CBU = '0110599520000012345678';
const OTHER_CBU = '0170099220000067797370';
const ALIAS = 'mi.alias.cbu';
const OTHER_ALIAS = 'otro.alias.cbu';

/** Una config sana y completa: abrirla no escribe. */
const HEALTHY: StoredConfig = { ...CONFIG_DEFAULTS, cuit: CUIT, monedaPorDefecto: 'USD' };

function createService(store: MemoryConfigStore): ConfigService {
  return new ConfigService({ files: nodeLocalFiles, store });
}

/** El servicio abierto sobre `initial`, con los contadores en cero y otro proceso que escribe antes de cada `update`. */
function openWithConcurrentWriter(initial: StoredConfig, otherProcess: (saved: StoredConfig) => void) {
  const store = new MemoryConfigStore({ initial });
  const service = createService(store);

  store.updates = 0;
  store.writes.length = 0;
  store.beforeUpdate = otherProcess;

  return { service, store };
}

/** Otro proceso guardó la razón social. */
const savesBusinessName = (saved: StoredConfig) => {
  saved.emisor = { ...(saved.emisor as object), razonSocial: 'Ana Ficticia' };
};

const WRITES: ReadonlyArray<
  readonly [name: string, initial: StoredConfig, write: (service: ConfigService) => unknown]
> = [
  ['setValue', HEALTHY, (service) => service.setValue('moneda', 'pes')],
  ['unsetValue', HEALTHY, (service) => service.unsetValue('moneda')],
  [
    'changeValues',
    HEALTHY,
    (service) =>
      service.changeValues({
        remove: ['moneda'],
        set: [
          ['puntoVenta', '3'],
          ['concepto', 'productos'],
        ],
      }),
  ],
  ['repairValue', HEALTHY, (service) => service.repairValue('moneda', 'pes')],
  ['repairUnset', HEALTHY, (service) => service.repairUnset('moneda')],
  // Con otra clave rota guarda solo lo pedido, sin normalizar: la otra rama de repair.
  ['repairValue con otra clave rota', { ...HEALTHY, cuit: '123' }, (service) => service.repairValue('moneda', 'pes')],
  ['repairUnset con otra clave rota', { ...HEALTHY, cuit: '123' }, (service) => service.repairUnset('moneda')],
  ['initialize', HEALTHY, (service) => service.initialize()],
];

describe('ConfigService sobre el puerto ConfigStore (ARQ-12 PR 3)', () => {
  describe('relee al escribir: conserva lo que otro proceso guardó en el medio', () => {
    it.each(WRITES)('%s', (_name, initial, write) => {
      const { service, store } = openWithConcurrentWriter(initial, savesBusinessName);

      write(service);

      expect(store.read()).toMatchObject({ emisor: { razonSocial: 'Ana Ficticia' } });
    });

    it('al completar los defaults al abrir', () => {
      const store = new MemoryConfigStore({ initial: { cuit: CUIT } });

      store.beforeUpdate = savesBusinessName;
      createService(store);

      expect(store.read()).toEqual({ ...CONFIG_DEFAULTS, cuit: CUIT, emisor: { razonSocial: 'Ana Ficticia' } });
    });

    it('el valor que se pide gana sobre el que guardó el otro proceso en la misma clave', () => {
      const { service, store } = openWithConcurrentWriter(HEALTHY, (saved) => {
        saved.monedaPorDefecto = 'EUR';
      });

      service.setValue('moneda', 'pes');

      expect(store.read()).toMatchObject({ cuit: CUIT, monedaPorDefecto: 'PES' });
    });
  });

  describe('los avisos del CBU y su alias salen de lo releído', () => {
    /** Otro proceso guardó una cuenta con alias. */
    const savesAccount = (saved: StoredConfig) => {
      saved.cbu = CBU;
      saved.aliasCbu = OTHER_ALIAS;
    };

    it('cambiar el CBU borra el alias que otro proceso guardó con el CBU anterior, y lo avisa', () => {
      const { service, store } = openWithConcurrentWriter({ ...HEALTHY, cbu: CBU }, savesAccount);
      const change = service.repairValue('cbu', OTHER_CBU);

      expect(change.warnings).toEqual([expect.stringContaining(`Se borró el alias ${OTHER_ALIAS}`)]);
      expect(store.read()).toMatchObject({ cbu: OTHER_CBU });
      expect(store.read()).not.toHaveProperty('aliasCbu');
    });

    it('guardar la cuenta sin alias avisa que borró el alias que otro proceso guardó', () => {
      const { service, store } = openWithConcurrentWriter({ ...HEALTHY, cbu: CBU }, savesAccount);
      const change = service.repairValue('cuenta', OTHER_CBU);

      expect(change.warnings).toEqual([expect.stringContaining(`Se borró el alias ${OTHER_ALIAS}`)]);
      expect(store.read()).not.toHaveProperty('aliasCbu');
    });

    it('borrar la cuenta avisa que borró también el alias que otro proceso guardó', () => {
      const { service, store } = openWithConcurrentWriter({ ...HEALTHY, cbu: CBU }, savesAccount);
      const change = service.repairUnset('cuenta');

      expect(change.warnings).toEqual([expect.stringContaining(`Se borró también el alias ${OTHER_ALIAS}`)]);
      expect(store.read()).not.toHaveProperty('cbu');
      expect(store.read()).not.toHaveProperty('aliasCbu');
    });

    it('si otro proceso ya borró el alias, no avisa de un alias que no estaba', () => {
      const { service, store } = openWithConcurrentWriter({ ...HEALTHY, aliasCbu: ALIAS, cbu: CBU }, (saved) => {
        delete saved.aliasCbu;
      });
      const change = service.repairValue('cbu', OTHER_CBU);

      expect(change.warnings).toBeUndefined();
      expect(store.read()).toMatchObject({ cbu: OTHER_CBU });
    });
  });

  describe('cada operación que escribe es un solo update', () => {
    it.each(WRITES)('%s', (_name, initial, write) => {
      const store = new MemoryConfigStore({ initial });
      const service = createService(store);

      store.updates = 0;
      write(service);

      expect(store.updates).toBe(1);
    });

    it('abrir una config completa no escribe; una a la que le faltan defaults, una vez', () => {
      const complete = new MemoryConfigStore({ initial: HEALTHY });
      const incomplete = new MemoryConfigStore({ initial: { cuit: CUIT } });

      createService(complete);
      createService(incomplete);

      expect({ complete: complete.updates, incomplete: incomplete.updates }).toEqual({ complete: 0, incomplete: 1 });
    });

    it('abrir una config con una clave rota no la completa ni escribe', () => {
      const store = new MemoryConfigStore({ initial: { cuit: '123' } });

      createService(store);

      expect(store.writes).toEqual([]);
      expect(store.read()).toEqual({ cuit: '123' });
    });

    it('leer la config no escribe', () => {
      const store = new MemoryConfigStore({ initial: HEALTHY });
      const service = createService(store);

      service.getConfig();
      service.getPath();

      expect(store.updates).toBe(0);
      expect(service.getPath()).toBe(store.path);
    });

    it('un valor inválido no escribe nada', () => {
      const store = new MemoryConfigStore({ initial: HEALTHY });
      const service = createService(store);

      expect(() => service.setValue('cuit', 'abc')).toThrow(/El CUIT "abc" no es válido/);
      expect(() =>
        service.changeValues({
          remove: [],
          set: [
            ['moneda', 'pes'],
            ['cuit', 'abc'],
          ],
        }),
      ).toThrow();
      expect(store.writes).toEqual([]);
      expect(store.read()).toEqual(HEALTHY);
    });
  });
});
