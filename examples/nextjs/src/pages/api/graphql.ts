import { GeneratedOperation } from 'graphql-ops-proxy/lib/proxy';
import { createEdgeHandler } from 'graphql-ops-proxy/lib/edge';
import { OPERATIONS } from '../../__generated__/gql';
import { createServerAdapter } from '@whatwg-node/server';

const origin = new URL('https://countries.trevorblades.com');
const handler = createEdgeHandler(origin, OPERATIONS as Array<GeneratedOperation>, {
  onResponse(response, { op }) {
    if (op.mBehaviour.ttl) {
      response.headers.set('cache-control', `public, s-maxage=${op.mBehaviour.ttl}`);
    }

    return response;
  },
});

const adapter = createServerAdapter(handler);

export default adapter;
