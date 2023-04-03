import type { NextApiRequest, NextApiResponse } from 'next';
import { createRequestPool, withCache } from './node';
import { createGraphqlProxy, NotFoundError, THeaders, ValidationError } from './proxy';

// types imports
import type { ServerResponse } from 'http';
import type { Pool } from 'undici';
import type { GraphqlProxy, RequestFn } from './proxy';
import type { CacheOptions } from './node';

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
  operations: Record<string, string>,
  options?: Partial<{
    /**
     * Request function or undici pool option
     */
    request: Partial<Pool.Options> | RequestFn;
    /**
     * Should it use @async dedupe cache?
     */
    withCache: boolean | CacheOptions;
    /**
     * Should it validate all operations against schema. It is recommended to turn it on when extending schema
     */
    validate: boolean;
    /**
     * Can be used to add overrides or do other manu
     * @param proxy
     * @returns
     */
    onCreate: (proxy: GraphqlProxy) => void;
  }>
) {
  let proxy: GraphqlProxy;
  if (typeof options?.request === 'function') {
    proxy = createGraphqlProxy(operations, options.request);
  } else {
    const requestPool = createRequestPool(url, options?.request);
    proxy = createGraphqlProxy(operations, requestPool.request);
  }

  options?.onCreate?.(proxy);

  if (options?.withCache) {
    withCache(proxy.getOperations(), typeof options.withCache === 'object' ? options.withCache : {});
  }

  async function validateOps() {
    const errors = await proxy.validate();
    if (errors.length) {
      throw new Error(errors.map((e) => e.message).join(', '));
    }
  }

  if (options?.validate) {
    validateOps();
  }

  async function _request(data: { operation: string; variables: any; headers: THeaders }, res: NextApiResponse) {
    try {
      const { response, headers } = await proxy.request(data.operation, data.variables, data.headers);

      headers && setHeaders(headers, res);

      return res.send(response);
    } catch (e: unknown) {
      if (e instanceof NotFoundError) {
        return res.status(404).send(e.message);
      }

      if (e instanceof ValidationError) {
        return res.status(400).send(e.message);
      }

      return res.status(500).send((e as Error).message ?? 'internal error');
    }
  }

  return async function handle(req: NextApiRequest, res: NextApiResponse) {
    if (req.method === 'POST') {
      const { op, v } = req.body;
      if (!op || typeof op !== 'string') {
        return res.status(404).send(op + 'not found');
      }

      return _request({ operation: op, variables: v, headers: req.headers }, res);
    }

    if (req.method === 'GET') {
      const op = req.query['op'];
      if (!op || typeof op !== 'string') {
        return res.status(404).send(op + 'not found');
      }
      const variables = req.query['v'] ? JSON.parse(req.query['v'] as string) : undefined;

      return _request({ headers: req.headers, operation: op, variables }, res);
    }

    return res.status(404).send('not found');
  };
}
