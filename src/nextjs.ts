import { createRequestPool, withCache } from './node';
import {
  createGraphqlProxy,
  NotFoundError,
  THeaders,
  ValidationError,
  GeneratedOperation,
  defaultHeaderCopy,
} from './proxy';

// types imports
import type { NextApiRequest, NextApiResponse } from 'next';
import type { ServerResponse } from 'http';
import type { Pool } from 'undici';
import type { GraphqlProxy, RequestFn } from './proxy';
import type { CacheOptions } from './node';
import { validateProxy } from './utils';

function setHeaders(headers: THeaders, res: ServerResponse) {
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
    validate: boolean | THeaders;
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
  async function _request(data: { operation: string; variables: any; headers: THeaders }, res: NextApiResponse) {
    if (!data.operation || typeof data.operation !== 'string') {
      return sendNotFound(res, 'no operation defined');
    }

    try {
      const { response, headers } = await proxy.request(data.operation, data.variables, data.headers);

      setHeaders(toResultHeaders(headers), res);

      return res.send(response);
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
    const headers = req.headers as THeaders;
    if (req.method === 'POST') {
      const { op, v } = req.body;

      return _request({ operation: op, variables: v, headers: headers }, res);
    }

    if (req.method === 'GET') {
      const op = req.query['op'];

      const variables = req.query['v']
        ? typeof req.query['v'] === 'object'
          ? req.query['v']
          : JSON.parse(req.query['v'] as string)
        : undefined;

      return _request({ headers: headers, operation: op as string, variables }, res);
    }

    return sendNotFound(res, 'not-found');
  };
}
