/** Los campos de `Own`, a cualquier profundidad, que no existen en `Sdk`. */
type UnknownFields<Own, Sdk> = Own extends readonly (infer OwnItem)[]
  ? Sdk extends readonly (infer SdkItem)[]
    ? UnknownFields<OwnItem, SdkItem>
    : never
  : Own extends object
    ? {
        [Key in keyof Own & string]-?: Key extends keyof Sdk
          ? UnknownFields<NonNullable<Own[Key]>, NonNullable<Sdk[Key]>>
          : Key;
      }[keyof Own & string]
    : never;

/**
 * La solicitud propia, si todos sus campos existen en la del SDK; si no, el nombre del que sobra, y no compila. Hace
 * falta porque a una variable TypeScript no le controla los campos de mas: un opcional mal escrito pasaria sin aviso y
 * no llegaria a ARCA. Los tipos de los campos los comprueba la asignacion al SDK.
 */
export type SdkRequest<Own, Sdk> = [UnknownFields<Own, Sdk>] extends [never] ? Own : UnknownFields<Own, Sdk>;
