import { createRequestPool, withCache } from './node';
import {
  createGraphqlProxy,
  NotFoundError,
  ValidationError,
  GeneratedOperation,
  defaultHeaderCopy,
  fromGetRequest,
  fromPostRequest,
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

    /**
     * Default only copies ['content-encoding', 'content-type'] headers
     * @param proxyHeaders
     * @returns
     */
    resultHeaders: (proxyHeaders?: OutgoingHttpHeaders) => OutgoingHttpHeaders;
  }>
) {
  let proxy: GraphqlProxy;
  if (typeof options?.request === 'function') {
    proxy = createGraphqlProxy(operations, options.request);
  } else {
    const requestPool = createRequestPool(url, options?.request);
    proxy = createGraphqlProxy(operations, requestPool.request);
  }

  const toResultHeaders = options?.resultHeaders ?? defaultHeaderCopy;

  options?.onCreate?.(proxy);

  if (options?.withCache) {
    withCache(proxy.getOperations(), typeof options.withCache === 'object' ? options.withCache : {});
  }

  async function validateOps() {
    const errors = await validateProxy(proxy, typeof options?.validate === 'object' ? options?.validate : {});
    if (errors.length) {
      throw new Error(errors.map((e) => e.message).join(', '));
    }
  }

  // what is a better location?
  if (options?.validate) {
    validateOps();
  }

  function sendNotFound(res: NextApiResponse, message: string) {
    return res.status(404).send({
      message: message,
    });
  }
  async function _request(operation: string, variables: any, headers: IncomingHttpHeaders, res: NextApiResponse) {
    if (!operation || typeof operation !== 'string') {
      return sendNotFound(res, 'no operation defined');
    }

    try {
      const proxyResponse = await proxy.request(operation, variables, headers);

      setHeaders(toResultHeaders(proxyResponse.headers), res);

      return res.send(proxyResponse.response);
    } catch (e: unknown) {
      if (e instanceof NotFoundError) {
        return sendNotFound(res, e.message);
      }

      if (e instanceof ValidationError) {
        return res.status(400).send({
          message: e.message,
        });
      }

      return res.status(500).send((e as Error).message ?? 'internal error');
    }
  }

  return async function handle(req: NextApiRequest, res: NextApiResponse) {
    const headers = req.headers;
    if (req.method === 'POST') {
      const payload = fromPostRequest(req.body);
      return _request(payload.operation as string, payload.variables, headers, res);
    }

    if (req.method === 'GET') {
      const payload = fromGetRequest(req.query as Record<string, string>);

      return _request(payload.operation as string, payload.variables, headers, res);
    }

    return sendNotFound(res, 'not-found');
  };
}
