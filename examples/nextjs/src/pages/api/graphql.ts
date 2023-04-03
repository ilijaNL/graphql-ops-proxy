import { createNextHandler } from 'graphql-ops-proxy/lib/nextjs';
import docs from '@/__generated__/persisted-documents.json';

const handler = createNextHandler(new URL('https://countries.trevorblades.com'), docs, {
  withCache: {
    // global cache
    cacheTTL: 0,
  },
});

export default handler;
