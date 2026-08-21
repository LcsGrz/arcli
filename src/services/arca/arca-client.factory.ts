import { Arca } from '@arcasdk/core';

import type { ResolvedArcaRuntime } from './arca-context.resolver';

export class ArcaClientFactory {
  public create(runtime: Pick<ResolvedArcaRuntime, 'context'>): Arca {
    return new Arca(runtime.context);
  }
}
