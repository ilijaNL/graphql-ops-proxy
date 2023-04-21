import {
  NotFoundError,
  GeneratedOperation,
  createGraphqlProxy,
  OnParseFn,
  defaultParseFn,
  OpsDef,
  ParsedRequest,
} from './proxy';

// types imports
import type { GraphQLProxy, RequestFn } from './proxy';

export async function defaultRequest(url: URL, body: string, headers: Headers) {
  const r = await fetch(url.toString(), {
    headers: headers,
    method: 'POST',
    body: body,
  });

  return r;
}

function sendError(message: string, code: number) {
  return new Response(
    JSON.stringify({
      message: message,
    }),
    { status: code }
  );
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
    proxyHeaders: (headers: Headers) => Headers;
    /**
     * Can be used to add additiona headers etc
     * @param response
     * @returns
     */
    onResponse: (
      response: Response,
      props: { op: OpsDef; originHeaders: Headers; parsedRequest: ParsedRequest; proxy: GraphQLProxy }
    ) => Response;
    onParse: OnParseFn;
    /**
     * Can be used to add overrides or do other manu
     * @param proxy
     * @returns
     */
    onCreate: (proxy: GraphQLProxy) => void;
  }>
) {
  const mReq: RequestFn =
    typeof requestOrUrl === 'function'
      ? requestOrUrl
      : (props) => defaultRequest(requestOrUrl, props.body, props.headers);

  const mProxy = createGraphqlProxy(operations, mReq);

  options?.onCreate?.(mProxy);
  const mOnParse = options?.onParse ?? defaultParseFn;

  async function rawRequest(parsedRequest: ParsedRequest) {
    const { operation, variables } = parsedRequest;
    if (!operation || typeof operation !== 'string') {
      return sendError('no operation defined', 404);
    }

    try {
      let headers = parsedRequest.headers;
      if (options?.proxyHeaders) {
        headers = options.proxyHeaders(headers);
      }

      const result = await mProxy.request(operation, variables, headers);
      const resultHeaders = new Headers({
        'content-type': result.headers.get('content-type') ?? 'application/json',
      });

      const response = new Response(result.body, {
        headers: resultHeaders,
        status: result.status,
        statusText: result.statusText,
      });

      // somehow this is autoAssigned in different envs such as cloudflare workers
      response.headers.delete('content-length');

      return options?.onResponse
        ? options.onResponse(response, {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            op: mProxy.getOperation(operation)!,
            originHeaders: result.headers,
            parsedRequest: parsedRequest,
            proxy: mProxy,
          })
        : response;
    } catch (e: unknown) {
      if (e instanceof NotFoundError) {
        return sendError(e.message, 404);
      }

      throw e;
    }
  }

  async function handle(req: Request) {
    try {
      if (req.method === 'POST') {
        const parsed = await mOnParse(req, mProxy);
        return await rawRequest(parsed);
      }

      if (req.method === 'GET') {
        const parsed = await mOnParse(req, mProxy);
        return await rawRequest(parsed);
      }
      return sendError('not-found', 404);
    } catch (e: any) {
      return sendError(e.message ?? 'internal error', 500);
    }
  }

  handle.rawRequest = rawRequest;

  return handle;
}
