import {
  NotFoundError,
  ValidationError,
  GeneratedOperation,
  createGraphqlProxy,
  defaultHeaderCopy,
  OpsDef,
  fromPostRequest,
  fromGetRequest,
} from './proxy';

// types imports
import type { GraphqlProxy, RequestFn } from './proxy';
import type { IncomingHttpHeaders, OutgoingHttpHeaders } from 'http';

export function toNodeHeaders(headers: Headers): IncomingHttpHeaders {
  const result: IncomingHttpHeaders = {};
  for (const [key, value] of headers) {
    // see https://github.com/vercel/next.js/blob/1088b3f682cbe411be2d1edc502f8a090e36dee4/packages/next/src/server/web/utils.ts#L29
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

export function fromNodeHeaders(object: OutgoingHttpHeaders): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(object)) {
    const values = Array.isArray(value) ? value : [value];
    for (let v of values) {
      if (typeof v === 'undefined') continue;
      if (typeof v === 'number') {
        v = v.toString();
      }

      headers.append(key, v);
    }
  }
  return headers;
}

export async function defaultRequest(url: URL, body: string, headers: IncomingHttpHeaders) {
  const r = await fetch(url.toString(), {
    headers: fromNodeHeaders(headers),
    method: 'POST',
    body: body,
  });

  return {
    response: r.body,
    headers: defaultHeaderCopy(toNodeHeaders(r.headers)),
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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function handleResponse(response: BodyInit, headers: OutgoingHttpHeaders, _op: OpsDef) {
  return new Response(response, {
    status: 200,
    headers: fromNodeHeaders(headers),
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
    proxyHeaders: (headers: IncomingHttpHeaders) => IncomingHttpHeaders;
    onResponse: typeof handleResponse;
    /**
     * Can be used to add overrides or do other manu
     * @param proxy
     * @returns
     */
    onCreate: (proxy: GraphqlProxy) => void;
  }>
) {
  const req: RequestFn =
    typeof requestOrUrl === 'function'
      ? requestOrUrl
      : (props) => defaultRequest(requestOrUrl, props.body, props.headers);

  const proxy = createGraphqlProxy(operations, req);

  options?.onCreate?.(proxy);

  const onResponse = options?.onResponse ?? handleResponse;

  async function _request(operation: string, variables: any, inHeaders: Headers) {
    if (!operation || typeof operation !== 'string') {
      return sendError('no operation defined', 404);
    }

    try {
      let headers = toNodeHeaders(inHeaders);
      if (options?.proxyHeaders) {
        headers = options.proxyHeaders(headers);
      }
      const res = await proxy.request<BodyInit>(operation, variables, headers);
      const op = proxy.getOperation(operation);
      return onResponse(res.response, res.headers ?? {}, op);
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
      return _request(payload.operation as string, payload.variables, req.headers);
    }

    if (req.method === 'GET') {
      const url = new URL(req.url);
      const params = url.searchParams;

      const payload = fromGetRequest(Object.fromEntries(params.entries()));

      return _request(payload.operation as string, payload.variables, req.headers);
    }

    return sendError('not-found', 404);
  };
}
