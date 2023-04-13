# GraphQL Operation Proxy

Make your graphql server secure and blazingly fast 🚀🚀

## Install

    yarn install graphql-ops-proxy

## Usage

Create a proxy for nextjs webapp (on the edge): `/pages/api/proxy.ts`

```typescript
import { createEdgeHandler, fromNodeHeaders } from 'graphql-ops-proxy/lib/edge';
import { GeneratedOperation } from 'graphql-ops-proxy/lib/proxy';
import { OPERATIONS } from '@/__generated__/gql';

const handler = createEdgeHandler(
  new URL('https://countries.trevorblades.com'),
  OPERATIONS as Array<GeneratedOperation>,
  {
    onResponse(resp, headers, op) {
      const responseHeaders = fromNodeHeaders(headers);

      // add cache headers
      if (op.mBehaviour.ttl) {
        responseHeaders.set(
          'cache-control',
          `public, s-maxage=${op.mBehaviour.ttl}, stale-while-revalidate=${Math.floor(op.mBehaviour.ttl * 0.5)}`
        );
      }

      return new Response(resp, {
        status: 200,
        headers: responseHeaders,
      });
    },
  }
);

export const config = {
  runtime: 'edge',
};

export default handler;
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
