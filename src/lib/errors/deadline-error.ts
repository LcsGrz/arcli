/**
 * ARCA, o el login en WSAA, no termino de contestar un pedido en su plazo. ARCLI dejo de esperar; si el pedido emitia,
 * ARCA pudo haberlo autorizado igual, asi que el texto no dice que no se emitio.
 */
export class ArcaDeadlineError extends Error {
  public readonly service: 'ARCA' | 'WSAA';

  public constructor(service: 'ARCA' | 'WSAA', ms: number) {
    super(`${service} no contestó en ${ms / 1000} segundos.`);
    this.name = 'ArcaDeadlineError';
    this.service = service;
  }
}
