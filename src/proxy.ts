import type { GraphQLError } from 'graphql';

export type OperationType = 'query' | 'mutation' | 'subscription';

export class TypedOperation<Result = Record<string, any>, Variables = Record<string, any>> {
  /**
   * This type is used to ensure that the variables you pass in to the query are assignable to Variables
   * and that the Result is assignable to whatever you pass your result to. The method is never actually
   * implemented, but the type is valid because we list it as optional
   */
  __apiType?: (variables: Variables) => Result;
  constructor(public readonly operation: string, public readonly operationType: OperationType) {}
}

export type GeneratedOperation = {
  operationName: string;
  operationType: 'query' | 'mutation' | 'subscription';
  query: string;
  behaviour: Partial<{
    ttl: number;
  }>;
};

export type RemoteRequestProps = {
  // used for the key
  query: string;
  variables?: Record<string, unknown>;
  headers: THeaders;
};

export type THeaders = Record<string, string | string[] | undefined>;

export type ProxyResponse = { response: any; headers?: THeaders };

export type RequestFn = (props: { body: string; headers: Record<string, string> }) => Promise<ProxyResponse>;

export type CacheOptions = {
  /**
   * Global TTL cache in seconds, use @pcached directive for per operation caching
   */
  cacheTTL: number;
  /**
   * Calculate the key
   */
  cacheKeySerialize: (props: RemoteRequestProps & { operation: string }) => string;
};

export interface IValidationError {
  type: 'validation';
  message: string;
}

export class NotFoundError extends Error {}
export class ValidationError extends Error {}

export type ValidateFn<T> = (input: T, def: OpsDef) => Promise<void | IValidationError> | void | IValidationError;
export type Resolver = (props: { variables?: Record<string, unknown>; headers: THeaders }) => Promise<ProxyResponse>;
export type CustomHandlerFn<R, V> = (this: OpsDef, variables: V, headers: THeaders) => Promise<R> | R;

export class OpsDef {
  private mOperation: OperationType;

  constructor(
    private mDocument: TypedOperation,
    private readonly mQuery: string,
    public readonly request: (req: RemoteRequestProps) => Promise<ProxyResponse>,
    public readonly mBehaviour: Partial<{
      ttl: number;
    }> = {},
    private mValidate: ValidateFn<any> | null = null,
    private mCustomHandler: CustomHandlerFn<any, any> | null = null
  ) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    this.mOperation = mDocument.operationType;
  }

  public setValidate(validate: ValidateFn<any> | null) {
    this.mValidate = validate?.bind(this) ?? null;
  }

  public setCustomHandler(customHandler: CustomHandlerFn<any, any> | null) {
    this.mCustomHandler = customHandler?.bind(this) ?? null;
  }

  // public setDocument(document: DocumentNode) {
  //   const op = getOperationAST(document);
  //   if (!op) {
  //     throw new Error('cannot set operation since not valid: ' + print(document));
  //   }
  //   this.mDocument = document;
  //   this.mOperation = op;
  //   this.mQuery = print(document);
  // }

  get type() {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return this.mOperation;
  }

  get document() {
    return this.mDocument;
  }

  get query() {
    return this.mQuery;
  }

  get operationName() {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return this.mDocument.operation;
  }

  get customHandler() {
    return this.mCustomHandler;
  }

  public async resolve(props: { variables?: Record<string, unknown>; headers: THeaders }) {
    // validate
    if (this.mValidate) {
      const error = await this.mValidate(props.variables, this);
      if (error) {
        throw new ValidationError(error.message);
      }
    }

    if (this.mCustomHandler) {
      const handlerResponse = await this.mCustomHandler(props.variables, props.headers);
      const response: ProxyResponse = {
        headers: {},
        response: { data: handlerResponse },
      };
      return response;
    }

    return this.request({ headers: props.headers, query: this.mQuery, variables: props.variables });
  }
}

function copyHeaders(originalHeaders: Record<string, unknown>, toCopy: string[]) {
  const result: THeaders = {};
  Object.keys(originalHeaders).forEach((key) => {
    if (toCopy.indexOf(key) !== -1) {
      result[key] = originalHeaders[key] as string;
    }
  });
  return result;
}

export type GraphqlProxy = ReturnType<typeof createGraphqlProxy>;

export function createGraphqlProxy(
  operations: Array<GeneratedOperation>,
  request: RequestFn,
  introspectionHeaders: THeaders = {}
) {
  async function _requestRemote(props: RemoteRequestProps): Promise<ProxyResponse> {
    const requestBody = {
      query: props.query,
      variables: props.variables,
    };

    const bodyPayload = JSON.stringify(requestBody);

    const headers = Object.assign({
      ...props.headers,
      'content-length': Buffer.byteLength(bodyPayload),
      'content-type': 'application/json',
    });

    // remove forbidden headers
    // not sure if we should delete this header
    delete headers.host;
    delete headers.connection;
    delete headers['transfer-encoding'];
    // ensure we always return json
    // delete headers['accept-encoding'];

    const { headers: _responseHeaders, response } = await request({
      body: bodyPayload,
      headers: headers,
    });

    return {
      response: response,
      headers: copyHeaders(_responseHeaders ?? {}, ['content-encoding', 'content-type']),
    };
  }

  const opsMap = new Map<string, OpsDef>();

  operations.forEach((oper) => {
    const def = new OpsDef(
      new TypedOperation(oper.operationName, oper.operationType),
      oper.query,
      _requestRemote,
      oper.behaviour
    );

    opsMap.set(oper.operationName, def);
  });

  // only wrap queries with cache

  function getOperation(document: TypedOperation<any, any>) {
    const name = document.operation;

    const doc = opsMap.get(name);
    /* istanbul ignore next */
    if (!doc) {
      throw new Error('no document registered for ' + name);
    }

    return doc;
  }

  return {
    /**
     * Validate all operations against hasura and custom overrides, throws if some operations are not valid
     * This is useful to check during development if all documents are valid or have custom execute
     *
     * Should be called after all overrides are added
     */
    async validate() {
      // fetch introspection
      const ops = Array.from(opsMap.values());
      // filter out custom executions
      const opsToCheck = ops.filter((o) => !o.customHandler);

      // lazy load graphql
      const { getIntrospectionQuery, buildClientSchema, validate, parse } = await import('graphql');

      if (opsToCheck.length === 0) {
        return [];
      }

      // fetch introspection query
      const query = getIntrospectionQuery();
      // validate
      const { response } = await _requestRemote({
        query: query,
        headers: {
          ...introspectionHeaders,
          // only accept json
          ['accept-encoding']: undefined,
        },
      });

      const schema = buildClientSchema(response.data);

      const errors = opsToCheck.reduce((agg, curr) => {
        const errs = validate(schema, parse(curr.query));
        return [...agg, ...errs];
      }, [] as GraphQLError[]);

      return errors;
    },
    // close all undici connections

    getOperations() {
      return Array.from(opsMap.values());
    },
    /**
     * Add input validation for an operation
     */
    addValidation<V>(document: TypedOperation<any, V>, validate: ValidateFn<V>) {
      const ops = getOperation(document);
      ops.setValidate(validate);
    },
    /**
     * Add an operation override. Can be used to implement custom operations
     */
    addOverride<R, V>(document: TypedOperation<R, V>, handler: CustomHandlerFn<R, V>) {
      const ops = getOperation(document);
      ops.setCustomHandler(handler);
    },
    /**
     * Directly call hasura without any validation, caching or overrides
     */
    async rawRequest(query: string, variables: Record<string, unknown> | undefined, headers: THeaders) {
      return _requestRemote({ headers, query, variables });
    },

    /**
     * Send a request
     */
    async request(
      operationName: string,
      variables: Record<string, unknown> | undefined = undefined,
      headers: THeaders = {}
    ): Promise<ProxyResponse> {
      const def = opsMap.get(operationName);
      if (!def) {
        throw new NotFoundError('operation ' + operationName + ' not found');
      }

      const result = await def.resolve({ variables, headers });

      return result;
    },
  };
}
