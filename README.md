# GraphQL Operation Proxy

Make your graphql server secure and blazingly fast 🚀🚀

## Install

    yarn install graphql-ops-proxy

## Usage

Create a proxy for nextjs webapp (on the edge): `/pages/api/proxy.ts`

```typescript
import { createEdgeHandler } from 'graphql-ops-proxy/lib/edge';
import { GeneratedOperation } from 'graphql-ops-proxy/lib/proxy';
// using graphql-codegen-typed-operation with codegen to generate operations for this frontend
import { OPERATIONS } from '@/generated/graphql-docs.generated';

const handler = createEdgeHandler(
  new URL('https://mygraphqlserver.com/graphql'),
  OPERATIONS as Array<GeneratedOperation>,
  {
    onResponse(resp, op) {
      const response = new Response(typeof resp.response === 'string' ? resp.response : JSON.stringify(resp.response), {
        status: 200,
      });

      Object.entries(resp.headers ?? {}).forEach(([key, value]) => {
        response.headers.set(key, value);
      });

      // set cdn cache
      if (op.mBehaviour.ttl) {
        response.headers.set(
          'cache-control',
          `public, s-maxage=${op.mBehaviour.ttl}, stale-while-revalidate=${Math.floor(op.mBehaviour.ttl * 0.5)}`
        );
      }

      return response;
    },
  }
);

// run this on edge
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
