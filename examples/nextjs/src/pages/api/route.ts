import { createNextHandler } from 'graphql-ops-proxy/lib/nextjs';
import { GeneratedOperation } from 'graphql-ops-proxy/lib/proxy';
import { OPERATIONS } from '../../__generated__/gql';

const handler = createNextHandler(
  new URL('https://countries.trevorblades.com'),
  OPERATIONS as Array<GeneratedOperation>,
  {
    withCache: {
      // global cache
      cacheTTL: 0,
    },
  }
);

export default handler;
