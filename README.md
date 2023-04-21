# GraphQL Operation Proxy

Make your graphql server secure and blazingly fast 🚀🚀

## Install

    yarn install graphql-ops-proxy

## Usage

Create a proxy for nextjs webapp (on the edge): `/pages/api/proxy.ts`

```typescript
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
        resp.headers.append('Cache-Control', `stale-while-revalidate=${op.mBehaviour.ttl}`);
      }

      return resp;
    },
  }
);

export const config = {
  runtime: 'edge',
};

export default handler;
```

##### With cloudflare workers

```typescript
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
```

##### With NextJS API routes (not edge)

```typescript
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
```

### Calling from the client

```typescript
import { GetDataDocument, TypedOperation } from '@/__generated__/gql';

// using generics to assure type-safety
async function send<TResult, TVars>(op: TypedOperation<TResult, TVars>, vars: TVars) {
  // can be optimzed by using op.operationType === 'query' to create a get request
  return await fetch('/api/proxy', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      v: vars,
      op: op.operation,
    }),
  }).then((d) => d.json());
}

// res will be typed
const res = await send(GetDataDocument, {});
```

See ./examples for more integrations

## Client Server Request Protocol

```
METHOD: "GET"
URL: /api/proxy?op=<operationName>&v=<JSON.stringify(vars)>
```

```
METHOD: "POST"
URL: /api/proxy
BODY: JSON.stringify({
  op: <operationName>
  v: variabels
})
```

## Other usage

For more usage checkout the `/tests/*` directory
