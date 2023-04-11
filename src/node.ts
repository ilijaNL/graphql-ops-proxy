import undici, { Pool } from 'undici';
import { IncomingHttpHeaders } from 'undici/types/header';
import { getHasuraHeaders } from './hasura';
import { OpsDef, ProxyResponse, RemoteRequestProps, Resolver } from './proxy';
import { createCache, Cache } from 'async-cache-dedupe';
import stableJson from 'safe-stable-stringify';

export function createRequestPool(url: URL, options?: Pool.Options) {
  const poolOptions: Pool.Options = {
    pipelining: 1,
    keepAliveTimeout: 5_000,
    connections: 128,
    ...options,
  };
  const mPool = new undici.Pool(url.origin, poolOptions);
  return {
    async close() {
      return new Promise<void>((resolve) => {
        mPool.destroy();
        // let the event loop do a full run so that it can
        // actually destroy those sockets
        setImmediate(resolve);
      });
    },
    async request(props: { body: string; headers: IncomingHttpHeaders }): Promise<ProxyResponse> {
      const fetchResult = await mPool.request({
        path: url.pathname,
        method: 'POST',
        headers: props.headers,
        body: props.body,
        throwOnError: true,
      });

      const buffers: Buffer[] = [];

      for await (const data of fetchResult.body) {
        buffers.push(data);
      }
      const data = Buffer.concat(buffers);

      return {
        headers: fetchResult.headers,
        response: data,
      };
    },
  };
}

export type CacheOptions = {
  /**
   * Global TTL cache in seconds, use @pcached directive for per operation caching
   */
  cacheTTL: number;
  /**
   * Calculate the key
   */
  cacheKeySerialize: (props: RemoteRequestProps & { operation: string }) => string;
};

/**
 * Wraps all resolvers with @async-cache-dedupe,
 * requires to have dependencies: yarn add async-cache-dedupe safe-stable-stringify
 * @param definitions
 * @param options
 */
export function withCache(definitions: Array<OpsDef>, options?: Partial<CacheOptions>) {
  const finalOptions: CacheOptions = {
    cacheTTL: 0,
    cacheKeySerialize(arg) {
      const args = {
        __operation: arg.operation,
        v: arg.variables,
        auth: arg.headers['authorization'],
        ...getHasuraHeaders(arg.headers),
      };
      return stableJson(args);
    },
    ...options,
  };

  const cache = createCache({
    ttl: finalOptions.cacheTTL, // seconds
    storage: {
      type: 'memory',
    },
  }) as Cache & {
    [operationName: string]: Resolver;
  };

  definitions.forEach((def) => {
    // only cache queries
    if (def.type === 'query') {
      const name = def.operationName;
      const originalResolve = def.resolve;
      cache.define(
        name,
        {
          // todo add decorators for caching strategy
          ttl: def.mBehaviour.ttl,
          serialize: finalOptions.cacheKeySerialize,
        },
        function (...args: Parameters<Resolver>) {
          return originalResolve.apply(def, args);
        }
      );

      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      def.resolve = cache[name]!;
    }
  });
}
