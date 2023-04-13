import { createEdgeHandler, fromNodeHeaders } from 'graphql-ops-proxy/lib/edge';
import { GeneratedOperation } from 'graphql-ops-proxy/lib/proxy';
import { OPERATIONS } from './__generated__/gql';

const handler = createEdgeHandler(
  new URL('https://countries.trevorblades.com'),
  OPERATIONS as Array<GeneratedOperation>,
  {
    onResponse(resp, headers, op) {
      const responseHeaders = fromNodeHeaders(headers);
      // add cache headers
      if (op.mBehaviour.ttl) {
        responseHeaders.set('cache-control', `public, s-maxage=${op.mBehaviour.ttl}`);
      }

      return new Response(resp, {
        status: 200,
        headers: responseHeaders,
      });
    },
  }
);

export default {
  fetch: handler,
};
