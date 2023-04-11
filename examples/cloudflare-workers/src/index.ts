import { createEdgeHandler } from 'graphql-ops-proxy/lib/edge';
import { GeneratedOperation } from 'graphql-ops-proxy/lib/proxy';
import { OPERATIONS } from './__generated__/gql';

const handler = createEdgeHandler(
  new URL('https://countries.trevorblades.com'),
  OPERATIONS as Array<GeneratedOperation>,
  {
    onResponse(resp, op) {
      const headers: Record<string, string> = { ...resp.headers };

      // add cache headers
      if (op.mBehaviour.ttl) {
        headers['cache-control'] = `public, s-maxage=${op.mBehaviour.ttl}`;
      }

      return new Response(typeof resp.response === 'string' ? resp.response : JSON.stringify(resp.response), {
        status: 200,
        headers: headers,
      });
    },
  }
);

export default {
  fetch: handler,
};
