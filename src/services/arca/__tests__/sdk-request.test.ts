import { expect, it } from 'vitest';

import type { SdkRequest } from '../sdk-request';

interface Sdk {
  readonly Iva?: Array<{ readonly Id: number }>;
  readonly PeriodoAsoc?: { readonly FchDesde: string } | null;
  readonly PtoVta: number;
}

/** Una solicitud con solo campos del SDK, y tres con un campo de más. */
interface Known {
  readonly Iva?: Array<{ readonly Id: number }>;
  readonly PeriodoAsoc?: { readonly FchDesde: string };
  readonly PtoVta: number;
}
interface ExtraAtRoot extends Known {
  readonly PtoVtaa?: number;
}
interface ExtraInList {
  readonly Iva?: Array<{ readonly Id: number; readonly Idd?: number }>;
  readonly PtoVta: number;
}
interface ExtraInObject {
  readonly PeriodoAsoc?: { readonly FchDesde: string; readonly FchDesdee?: string };
  readonly PtoVta: number;
}

// Lo controla `yarn typecheck`: si `SdkRequest` deja pasar el campo de más, el `@ts-expect-error` sobra y no compila.
it('una solicitud con un campo que el SDK no tiene no compila', () => {
  const known: Known = { PtoVta: 3 };
  const root: ExtraAtRoot = known;
  const list: ExtraInList = { PtoVta: 3 };
  const object: ExtraInObject = { PtoVta: 3 };

  const accepted: SdkRequest<Known, Sdk> = known;
  // @ts-expect-error PtoVtaa no existe en el SDK.
  const rejectedRoot: SdkRequest<ExtraAtRoot, Sdk> = root;
  // @ts-expect-error Iva[].Idd no existe en el SDK.
  const rejectedList: SdkRequest<ExtraInList, Sdk> = list;
  // @ts-expect-error PeriodoAsoc.FchDesdee no existe en el SDK.
  const rejectedObject: SdkRequest<ExtraInObject, Sdk> = object;

  expect([accepted, rejectedRoot, rejectedList, rejectedObject]).toHaveLength(4);
});
