import { createEdgeHandler } from 'graphql-ops-proxy/lib/edge';
import { GeneratedOperation } from 'graphql-ops-proxy/lib/proxy';
import { OPERATIONS } from './__generated__/gql';

const handler = createEdgeHandler(
  new URL('https://countries.trevorblades.com'),
  OPERATIONS as Array<GeneratedOperation>,
  {
    onResponse(response, { op }) {
      // add cache headers
      if (op.mBehaviour.ttl) {
        response.headers.set('cache-control', `public, s-maxage=${op.mBehaviour.ttl}`);
      }

      return response;
    },
  }
);

export default {
  fetch: handler,
};
