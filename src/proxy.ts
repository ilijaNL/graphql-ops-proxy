import type { OutgoingHttpHeaders, IncomingHttpHeaders } from 'http';

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
  headers: IncomingHttpHeaders;
};

export type ProxyResponse<R = any> = { response: R; headers?: OutgoingHttpHeaders };
export type RequestFn<R = any> = (props: { body: string; headers: IncomingHttpHeaders }) => Promise<ProxyResponse<R>>;

export interface IValidationError {
  type: 'validation';
  message: string;
}

export function fromPostRequest(body: any): Partial<{ operation: string; variables: Record<string, any> }> {
  const operation = body.op ?? body.operation ?? body.query;
  const variables = body.v ?? body.variables;
  return {
    operation,
    variables,
  };
}

export function fromGetRequest(query: Record<string, string>): ReturnType<typeof fromPostRequest> {
  const operation = query['op'] ?? query['operation'] ?? query['query'];
  const variables = query['v'] ?? query['variables'];

  return {
    operation,
    variables: variables ? (typeof variables === 'string' ? JSON.parse(variables) : variables) : undefined,
  };
}

export class NotFoundError extends Error {}
export class ValidationError extends Error {}

export type ValidateFn<T> = (input: T, def: OpsDef) => Promise<void | IValidationError> | void | IValidationError;

export type CustomHandlerFn<R, V> = (
  this: OpsDef,
  variables: V,
  headers: IncomingHttpHeaders
) => Promise<ProxyResponse<R>> | ProxyResponse<R>;

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
    return this.mOperation;
  }

  get query() {
    return this.mQuery;
  }

  get operationName() {
    return this.mDocument.operation;
  }

  get customHandler() {
    return this.mCustomHandler;
  }

  public async resolve(props: { variables?: Record<string, unknown>; headers: IncomingHttpHeaders }) {
    // validate
    if (this.mValidate) {
      const error = await this.mValidate(props.variables, this);
      if (error) {
        throw new ValidationError(error.message);
      }
    }

    if (this.mCustomHandler) {
      const handlerResponse = await this.mCustomHandler(props.variables, props.headers);
      const resp: ProxyResponse = {
        response: {
          // convert to data since this is what all graphql servers return
          data: handlerResponse.response,
        },
        headers: handlerResponse.headers,
      };

      return resp;
    }

    return this.request({ headers: props.headers, query: this.mQuery, variables: props.variables });
  }
}

export function copyHeaders(originalHeaders: IncomingHttpHeaders | OutgoingHttpHeaders, toCopy: string[]) {
  const result: IncomingHttpHeaders = {};
  Object.keys(originalHeaders).forEach((key) => {
    if (toCopy.indexOf(key) !== -1) {
      result[key] = originalHeaders[key] as string;
    }
  });
  return result;
}

const defaultHeadersToCopy = ['content-encoding', 'content-type', 'content-length'];

export const defaultHeaderCopy = (proxyHeaders?: IncomingHttpHeaders | OutgoingHttpHeaders) => {
  return copyHeaders(proxyHeaders ?? {}, defaultHeadersToCopy);
};

export type GraphqlProxy = ReturnType<typeof createGraphqlProxy>;

export function createGraphqlProxy(operations: Array<GeneratedOperation>, request: RequestFn) {
  async function _requestRemote(props: RemoteRequestProps): Promise<ProxyResponse> {
    const requestBody = {
      query: props.query,
      variables: props.variables,
    };

    const bodyPayload = JSON.stringify(requestBody);

    const headers: IncomingHttpHeaders = {
      ...props.headers,
      // always expect json since this is for graphql...
      'content-type': 'application/json',
    };

    // remove forbidden headers
    delete headers.host; // not sure if we should delete this header
    delete headers.connection;
    // delete headers['keep-alive'];
    // delete headers['transfer-encoding'];

    return await request({
      body: bodyPayload,
      headers: headers,
    });
  }

  const opsMap = new Map<string, OpsDef>();

  // transform from json to opsDefs
  operations.forEach((oper) => {
    const def = new OpsDef(
      { operation: oper.operationName, operationType: oper.operationType },
      oper.query,
      _requestRemote,
      oper.behaviour
    );

    opsMap.set(oper.operationName, def);
  });

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
    async request<R = any>(
      operationName: string,
      variables: Record<string, unknown> | undefined = undefined,
      headers: IncomingHttpHeaders = {}
    ): Promise<ProxyResponse<R>> {
      const def = opsMap.get(operationName);
      if (!def) {
        throw new NotFoundError('operation ' + operationName + ' not found');
      }

      const result = await def.resolve({ variables, headers });

      return result;
    },
  };
}
