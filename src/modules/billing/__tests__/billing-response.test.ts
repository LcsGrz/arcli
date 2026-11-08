import { describe, expect, it } from 'vitest';

import { createDryRunResponse } from '../billing-response';

describe('createDryRunResponse', () => {
  it('la vista previa no tiene CAE y su estado lo dice, en lugar de un "observado" que no pasó', () => {
    expect(createDryRunResponse()).toMatchObject({ cae: null, resultado: null, status: 'previsualizacion' });
  });
});
