import type { IncomingHttpHeaders } from 'http';

export type OperationType = 'query' | 'mutation' | 'subscription';

export type TypedOperation<R = any, V = any> = {
  operation: string;
  operationType: OperationType;
  __apiType?: (v: V) => R;
};

export type GeneratedOperation = {
  operationName: string;
  operationType: OperationType;
  query: string;
  behaviour: Partial<{
    ttl: number;
  }> &
    Record<string, any>;
};

export function toNodeHeaders(headers: Headers): IncomingHttpHeaders {
  const result: IncomingHttpHeaders = {};
  for (const [key, value] of headers) {
    // see https://github.com/vercel/next.js/blob/1088b3f682cbe411be2d1edc502f8a090e36dee4/packages/next/src/server/web/utils.ts#L29 for a reference impl
    // if (key.toLowerCase() === 'set-cookie') {
    //   // We may have gotten a comma joined string of cookies, or multiple
    //   // set-cookie headers. We need to merge them into one header array
    //   // to represent all the cookies.
    //   cookies.push(...splitCookiesString(value))
    //   result[key] = cookies.length === 1 ? cookies[0] : cookies
    // } else {
    //   result[key] = value
    // }

    result[key] = value;
  }
  return result;
}

export const defaultParseFn: OnParseFn = async (req) => {
  if (req.method === 'POST') {
    const body = await req.json();
    const payload = fromPostRequest(body);

    return {
      headers: new Headers(req.headers),
      operation: payload.operation,
      variables: payload.variables,
    };
  }

  if (req.method === 'GET') {
    const url = new URL(req.url);
    const params = url.searchParams;
    const payload = fromGetRequest(Object.fromEntries(params.entries()));

    return {
      headers: new Headers(req.headers),
      operation: payload.operation,
      variables: payload.variables,
    };
  }

  throw new Error('method not supported');
};

export type RemoteRequestProps = {
  // used for the key
  query: string;
  variables?: Record<string, unknown>;
  headers: Headers;
};

export function fromPostRequest(body: any): Partial<{ operation: string; variables: Record<string, any> }> {
  const operation = body.op ?? body.operationName ?? body.operation ?? body.query;
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

export type ParsedRequest = {
  operation?: string;
  variables?: Record<string, any>;
  headers: Headers;
};

export type OnParseFn = (req: Request, proxy: GraphQLProxy) => Promise<ParsedRequest> | ParsedRequest;

export class NotFoundError extends Error {}

const noOp = (props: RemoteRequestProps) => props;
export type PreRequestHandler = (this: OpsDef, props: RemoteRequestProps) => RemoteRequestProps;

export class OpsDef {
  private mOperation: OperationType;
  private mPreHandler: PreRequestHandler = noOp;

  constructor(
    private mDocument: TypedOperation,
    private readonly mQuery: string,
    public readonly request: (req: RemoteRequestProps) => Promise<Response>,
    public readonly mBehaviour: Partial<{
      ttl: number;
    }> = {}
  ) {
    this.mOperation = mDocument.operationType;
  }

  get type() {
    return this.mOperation;
  }

  get query() {
    return this.mQuery;
  }

  get operationName() {
    return this.mDocument.operation;
  }

  public setPrehandler(preHandler: PreRequestHandler) {
    this.mPreHandler = preHandler.bind(this);
  }

  public async resolve(props: { variables?: Record<string, unknown>; headers: Headers }) {
    const requestBody = this.mPreHandler({ headers: props.headers, query: this.mQuery, variables: props.variables });
    return await this.request(requestBody);
  }
}

// export function copyHeaders(originalHeaders: IncomingHttpHeaders | OutgoingHttpHeaders, toCopy: string[]) {
//   const result: IncomingHttpHeaders = {};
//   Object.keys(originalHeaders).forEach((key) => {
//     if (toCopy.indexOf(key) !== -1) {
//       result[key] = originalHeaders[key] as string;
//     }
//   });
//   return result;
// }

// const defaultHeadersToCopy = ['content-encoding', 'content-type', 'content-length'];

// export const defaultHeaderCopy = (proxyHeaders?: IncomingHttpHeaders | OutgoingHttpHeaders) => {
//   return copyHeaders(proxyHeaders ?? {}, defaultHeadersToCopy);
// };

export type GraphQLProxy = ReturnType<typeof createGraphqlProxy>;

export type RequestFn = (props: { body: string; headers: Headers }) => Promise<Response>;

export function createGraphqlProxy(operations: Array<GeneratedOperation>, request: RequestFn) {
  async function _requestRemote(props: RemoteRequestProps): Promise<Response> {
    const requestBody = {
      query: props.query,
      variables: props.variables,
    };

    const bodyPayload = JSON.stringify(requestBody);

    // we since we generating new body ensure this header is not proxied through
    props.headers.delete('content-length');

    props.headers.set('content-type', 'application/json');
    props.headers.set('accept', 'application/json');

    props.headers.delete('host');
    props.headers.delete('connection');
    props.headers.delete('keep-alive');

    return request({
      body: bodyPayload,
      headers: props.headers,
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
      throw new Error('no operation registered for ' + operation);
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
     * Ability to override the request params for an operation
     * @param name
     * @param handler
     */
    setPreHandler(operationName: string, handler: PreRequestHandler) {
      const ops = getOperation(operationName);
      ops.setPrehandler(handler);
    },
    /**
     * Send a request
     */
    async request(
      operationName: string,
      variables: Record<string, unknown> | undefined = undefined,
      headers: Headers = new Headers()
    ): Promise<Response> {
      const def = opsMap.get(operationName);
      if (!def) {
        throw new NotFoundError('operation ' + operationName + ' not found');
      }

      const result = await def.resolve({ variables, headers });
      return result;
    },
  };
}
