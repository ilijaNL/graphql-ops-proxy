import {
  NotFoundError,
  ValidationError,
  GeneratedOperation,
  createGraphqlProxy,
  THeaders,
  ProxyResponse,
  defaultHeaderCopy,
  OpsDef,
  fromPostRequest,
  fromGetRequest,
} from './proxy';

// types imports
import type { GraphqlProxy, RequestFn } from './proxy';

export function convertHeaders(headers: Headers): THeaders {
  const result: THeaders = {};
  for (const [key, value] of headers.entries()) {
    result[key] = value;
  }

  return result;
}

export async function defaultRequest(url: URL, body: string, headers: THeaders) {
  const r = await fetch(url.toString(), {
    headers: headers,
    method: 'POST',
    body: body,
  });

  const response = await r.json();

  return {
    response,
    headers: defaultHeaderCopy(convertHeaders(r.headers)),
  };
}

function sendError(message: string, code: number) {
  return new Response(
    JSON.stringify({
      message: message,
    }),
    { status: code }
  );
}

export function handleResponse({ response, headers }: ProxyResponse, _op: OpsDef) {
  return new Response(typeof response === 'string' ? response : JSON.stringify(response), {
    status: 200,
    headers: (headers ?? {}) as Record<string, string>,
  });
}

/**
 * Create a graphql proxy handler
 */
export function createEdgeHandler(
  /**
   * Request function or undici pool option
   */
  requestOrUrl: RequestFn | URL,
  /**
   * Operations that should be proxied
   */
  operations: Array<GeneratedOperation>,
  options?: Partial<{
    onResponse: typeof handleResponse;
    /**
     * Can be used to add overrides or do other manu
     * @param proxy
     * @returns
     */
    onCreate: (proxy: GraphqlProxy) => void;
    /**
     * Default only copies ['content-encoding', 'content-type'] headers
     * @param proxyHeaders
     * @returns
     */
    resultHeaders: typeof defaultHeaderCopy;
  }>
) {
  const req: RequestFn =
    typeof requestOrUrl === 'function'
      ? requestOrUrl
      : (props: { body: string; headers: THeaders }) => defaultRequest(requestOrUrl, props.body, props.headers);

  const proxy = createGraphqlProxy(operations, req);

  options?.onCreate?.(proxy);

  const toResultHeaders = options?.resultHeaders ?? defaultHeaderCopy;

  const onResponse = options?.onResponse ?? handleResponse;

  async function _request(operation: string, variables: any, headers: THeaders) {
    if (!operation || typeof operation !== 'string') {
      return sendError('no operation defined', 404);
    }

    try {
      const res = await proxy.request(operation, variables, headers);
      const op = proxy.getOperation(operation);
      const { response, headers: _headers } = res;
      return onResponse({ response, headers: toResultHeaders(_headers) }, op);
    } catch (e: unknown) {
      if (e instanceof NotFoundError) {
        return sendError(e.message, 404);
      }

      if (e instanceof ValidationError) {
        return sendError(e.message, 400);
      }

      return sendError((e as Error).message ?? 'internal error', 500);
    }
  }

  return async function handle(req: Request) {
    if (req.method === 'POST') {
      const result = await req.json();
      const payload = fromPostRequest(result);
      // what is best way to convert?
      const headers: THeaders = req.headers as unknown as THeaders;
      return _request(payload.operation as string, payload.variables, headers);
    }

    if (req.method === 'GET') {
      const url = new URL(req.url);
      const params = url.searchParams;

      const payload = fromGetRequest(Object.fromEntries(params.entries()));

      const headers: THeaders = req.headers as unknown as THeaders;
      return _request(payload.operation as string, payload.variables, headers);
    }

    return sendError('not-found', 404);
  };
}
