import { createRequestPool, withCache } from './node';
import {
  createGraphqlProxy,
  NotFoundError,
  ValidationError,
  GeneratedOperation,
  defaultHeaderCopy,
  fromGetRequest,
  fromPostRequest,
  OnParseFn,
} from './proxy';
import { validateProxy } from './utils';

// types imports
import type { NextApiRequest, NextApiResponse } from 'next';
import type { IncomingHttpHeaders, OutgoingHttpHeaders, ServerResponse } from 'http';
import type { Pool } from 'undici';
import type { GraphqlProxy, RequestFn } from './proxy';
import type { CacheOptions } from './node';

function setHeaders(headers: OutgoingHttpHeaders, res: ServerResponse) {
  Object.entries(headers).forEach(([key, value]) => {
    if (value) {
      res.setHeader(key, value);
    }
  });
}

export const defaultParseFn: OnParseFn<NextApiRequest> = (req) => {
  if (req.method === 'POST') {
    const body = req.body;
    const payload = fromPostRequest(body);

    return {
      headers: req.headers,
      operation: payload.operation,
      variables: payload.variables,
    };
  }

  if (req.method === 'GET') {
    const payload = fromGetRequest(req.query as Record<string, string>);

    return {
      headers: req.headers,
      operation: payload.operation,
      variables: payload.variables,
    };
  }

  throw new Error('method not supported');
};

function sendError(res: NextApiResponse, code: number, message: string) {
  return res.status(code).send({
    message: message,
  });
}

/**
 * Create a graphql proxy handler
 */
export function createNextHandler(
  /**
   * URL of the graphql origin
   */
  url: URL,
  /**
   * Operations that should be proxied
   */
  operations: Array<GeneratedOperation>,
  options?: Partial<{
    /**
     * Request function or undici pool option
     */
    request: Partial<Pool.Options> | RequestFn;
    /**
     * Should it use @async dedupe cache?
     */
    withCache: boolean | Partial<CacheOptions>;
    /**
     * Should it validate all operations against schema. It is recommended to turn it on when extending schema
     *
     */
    validate: boolean | IncomingHttpHeaders;
    /**
     * Can be used to add overrides or do other manu
     * @param proxy
     * @returns
     */
    onCreate: (proxy: GraphqlProxy) => void;
    onParse: OnParseFn<NextApiRequest>;
    /**
     * Default only copies ['content-encoding', 'content-type'] headers
     * @param proxyHeaders
     * @returns
     */
    resultHeaders: (proxyHeaders?: OutgoingHttpHeaders) => OutgoingHttpHeaders;
  }>
) {
  let mProxy: GraphqlProxy;
  if (typeof options?.request === 'function') {
    mProxy = createGraphqlProxy(operations, options.request);
  } else {
    const requestPool = createRequestPool(url, options?.request);
    mProxy = createGraphqlProxy(operations, requestPool.request);
  }

  options?.onCreate?.(mProxy);

  const mToResultHeaders = options?.resultHeaders ?? defaultHeaderCopy;
  const mOnParse = options?.onParse ?? defaultParseFn;

  if (options?.withCache) {
    withCache(mProxy.getOperations(), typeof options.withCache === 'object' ? options.withCache : {});
  }

  async function mValidateOps() {
    const errors = await validateProxy(mProxy, typeof options?.validate === 'object' ? options?.validate : {});
    if (errors.length) {
      throw new Error(errors.map((e) => e.message).join(', '));
    }
  }

  // what is a better location?
  if (options?.validate) {
    mValidateOps();
  }

  async function rawRequest(
    operation: string | undefined,
    variables: any,
    headers: IncomingHttpHeaders,
    res: NextApiResponse
  ) {
    if (!operation || typeof operation !== 'string') {
      return sendError(res, 404, 'no operation defined');
    }

    try {
      const proxyResponse = await mProxy.request(operation, variables, headers);

      setHeaders(mToResultHeaders(proxyResponse.headers), res);

      return res.send(proxyResponse.response);
    } catch (e: any) {
      if (e instanceof NotFoundError) {
        return sendError(res, 404, e.message);
      }

      if (e instanceof ValidationError) {
        return sendError(res, 400, e.message);
      }

      return sendError(res, 500, e.message ?? 'internal error');
    }
  }

  async function handle(req: NextApiRequest, res: NextApiResponse) {
    try {
      if (req.method === 'POST') {
        const parsed = await mOnParse(req, mProxy);
        return rawRequest(parsed.operation, parsed.variables, parsed.headers, res);
      }

      if (req.method === 'GET') {
        const parsed = await mOnParse(req, mProxy);
        return rawRequest(parsed.operation, parsed.variables, parsed.headers, res);
      }

      return sendError(res, 404, 'not-found');
    } catch (e: any) {
      return sendError(res, 500, e.message ?? 'internal error');
    }
  }

  handle.rawRequest = rawRequest;

  return handle;
}
