import { createEdgeHandler } from 'graphql-ops-proxy/lib/edge';
import { GeneratedOperation } from 'graphql-ops-proxy/lib/proxy';
import { OPERATIONS } from '@/__generated__/gql';

const handler = createEdgeHandler(
  new URL('https://countries.trevorblades.com'),
  OPERATIONS as Array<GeneratedOperation>,
  {
    onResponse(resp, { op }) {
      // add cache headers
      if (op.mBehaviour.ttl) {
        resp.headers.append('Cache-Control', 'public');
        resp.headers.append('Cache-Control', `s-maxage=${op.mBehaviour.ttl}`);
        resp.headers.append('Cache-Control', `stale-while-revalidate=${Math.floor(op.mBehaviour.ttl * 0.5)}`);
      }

      return resp;
    },
  }
);

export const config = {
  runtime: 'edge',
};

export default handler;
