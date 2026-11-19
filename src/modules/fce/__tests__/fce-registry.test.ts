import { describe, expect, it } from 'vitest';

import { latestFceRegistryState } from '../fce-registry';

describe('latestFceRegistryState (TEST-19)', () => {
  it('toma el estado de fecha más reciente aunque el historial venga desordenado', () => {
    expect(
      latestFceRegistryState([
        { estado: 'Aceptado', fechaHoraEstado: '2026-10-05T10:00:00' },
        { estado: 'PendienteRecepcion', fechaHoraEstado: '2026-10-01T09:00:00' },
        { estado: 'Recepcionado', fechaHoraEstado: '2026-10-02T09:00:00' },
      ]),
    ).toBe('Aceptado');
  });

  it('con dos estados a la misma hora gana el último del historial', () => {
    expect(
      latestFceRegistryState([
        { estado: 'PendienteRecepcion', fechaHoraEstado: '2026-10-01T09:00:00' },
        { estado: 'Recepcionado', fechaHoraEstado: '2026-10-02T09:00:00' },
        { estado: 'Rechazado', fechaHoraEstado: '2026-10-02T09:00:00' },
      ]),
    ).toBe('Rechazado');
  });

  it('sin historial no hay estado', () => {
    expect(latestFceRegistryState([])).toBeUndefined();
  });
});
