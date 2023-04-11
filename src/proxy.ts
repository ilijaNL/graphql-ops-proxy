export type OperationType = 'query' | 'mutation' | 'subscription';

export type TypedOperation<R = any, V = any> = {
  operation: string;
  operationType: OperationType;
  __apiType?: (v: V) => R;
};

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

export type THeaders = Record<string, string>;

export type ProxyResponse = { response: any; headers?: THeaders };

export type RequestFn = (props: { body: string; headers: Record<string, string> }) => Promise<ProxyResponse>;

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

export function copyHeaders(originalHeaders: Record<string, unknown>, toCopy: string[]) {
  const result: THeaders = {};
  Object.keys(originalHeaders).forEach((key) => {
    if (toCopy.indexOf(key) !== -1) {
      result[key] = originalHeaders[key] as string;
    }
  });
  return result;
}

export const defaultHeaderCopy = (proxyHeaders?: THeaders | undefined) => {
  return copyHeaders(proxyHeaders ?? {}, ['content-encoding', 'content-type']);
};

export type GraphqlProxy = ReturnType<typeof createGraphqlProxy>;

export function createGraphqlProxy(operations: Array<GeneratedOperation>, request: RequestFn) {
  async function _requestRemote(props: RemoteRequestProps): Promise<ProxyResponse> {
    const requestBody = {
      query: props.query,
      variables: props.variables,
    };

    const bodyPayload = JSON.stringify(requestBody);

    const headers = Object.assign({
      ...props.headers,
      // always expect json
      'content-type': 'application/json',
    });

    // remove forbidden headers
    delete headers.host; // not sure if we should delete this header
    delete headers.connection;
    delete headers['transfer-encoding'];

    return await request({
      body: bodyPayload,
      headers: headers,
    });
  }

  const opsMap = new Map<string, OpsDef>();

  operations.forEach((oper) => {
    const def = new OpsDef(
      { operation: oper.operationName, operationType: oper.operationType },
      oper.query,
      _requestRemote,
      oper.behaviour
    );

    opsMap.set(oper.operationName, def);
  });

  // only wrap queries with cache

  function getOperation(operation: string) {
    const doc = opsMap.get(operation);
    /* istanbul ignore next */
    if (!doc) {
      throw new Error('no document registered for ' + operation);
    }

    return doc;
  }

  return {
    rawRequest: _requestRemote,
    getOperation,
    getOperations() {
      return Array.from(opsMap.values());
    },
    /**
     * Add input validation for an operation
     */
    addValidation<V>(document: TypedOperation<any, V>, validate: ValidateFn<V>) {
      const ops = getOperation(document.operation);
      ops.setValidate(validate);
    },
    /**
     * Add an operation override. Can be used to implement custom operations
     */
    addOverride<R, V>(document: TypedOperation<R, V>, handler: CustomHandlerFn<R, V>) {
      const ops = getOperation(document.operation);
      ops.setCustomHandler(handler);
    },
    /**
     * Directly call proxy without any validation, caching or overrides
     */
    // async rawRequest(query: string, variables: Record<string, unknown> | undefined, headers: THeaders) {
    //   return _requestRemote({ headers, query, variables });
    // },

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
