import tap from 'tap';
import { createMocks } from 'node-mocks-http';
import { createNextHandler } from '../src/nextjs';
import { print, parse } from 'graphql';
import { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';

tap.test('happy post', async (t) => {
  const opsMap = {
    hash1: 'query test1 { test }',
  };
  const handler = createNextHandler(new URL('http://localhost:3001/api/graphql'), opsMap, {
    validate: false,
    request: async ({ body, headers }) => {
      t.same(JSON.parse(body).query, print(parse(opsMap.hash1)));
      t.same(headers, {
        'x-hasura-app': 'app',
        'content-length': 36,
        'content-type': 'application/json',
      });
      return {
        response: {
          data: {
            test: '123',
          },
        },
      };
    },
  });

  const { req, res } = createMocks({
    method: 'POST',
    headers: {
      'x-hasura-app': 'app',
    },
    body: {
      op: 'test1',
    },
  });

  await handler(req, res);

  t.equal(res._getStatusCode(), 200);
  t.same(res._getData(), {
    data: {
      test: '123',
    },
  });
});

tap.test('only accept post/get', async (t) => {
  const opsMap = {
    hash1: 'query test1 { test }',
  };
  const handler = createNextHandler(new URL('http://localhost:3001/api/graphql'), opsMap, {
    validate: false,
    request: async ({ body, headers }) => {
      return {
        response: {
          data: {
            test: '123',
          },
        },
      };
    },
  });

  const { req, res } = createMocks({
    method: 'PUT',
    headers: {
      'x-hasura-app': 'app',
    },
    query: {
      op: 'test1',
      v: {},
    },
  });

  await handler(req, res);

  t.equal(res._getStatusCode(), 404);
  t.same(res._getData(), {
    message: 'not-found',
  });
});

tap.test('happy get', async (t) => {
  const opsMap = {
    hash1: 'query test1 { test }',
  };
  const handler = createNextHandler(new URL('http://localhost:3001/api/graphql'), opsMap, {
    validate: false,
    request: async ({ body, headers }) => {
      t.same(JSON.parse(body).query, print(parse(opsMap.hash1)));
      t.same(headers, {
        'x-hasura-app': 'app',
        'content-length': 51,
        'content-type': 'application/json',
      });
      return {
        response: {
          data: {
            test: '123',
          },
        },
      };
    },
  });

  const { req, res } = createMocks({
    method: 'GET',
    headers: {
      'x-hasura-app': 'app',
    },
    query: {
      op: 'test1',
      v: {},
    },
  });

  await handler(req, res);

  t.equal(res._getStatusCode(), 200);
  t.same(res._getData(), {
    data: {
      test: '123',
    },
  });
});

tap.test('not found', async (t) => {
  const opsMap = {
    hash1: 'query test1 { test }',
  };
  const handler = createNextHandler(new URL('http://localhost:3001/api/graphql'), opsMap, {
    validate: false,
    request: async ({ body, headers }) => {
      t.same(JSON.parse(body).query, print(parse(opsMap.hash1)));
      t.same(headers, {
        'x-hasura-app': 'app',
        'content-length': 51,
        'content-type': 'application/json',
      });
      return {
        response: {
          data: {
            test: '123',
          },
        },
      };
    },
  });

  const { req, res } = createMocks({
    method: 'GET',
    headers: {
      'x-hasura-app': 'app',
    },
    query: {
      op: 'test3',
      v: {},
    },
  });

  await handler(req, res);

  t.equal(res._getStatusCode(), 404);
  t.same(res._getData(), {
    message: 'operation test3 not found',
  });
});

tap.test('on create + input validation', async (t) => {
  const opsMap = {
    hash1: 'query test1 { test }',
  };
  const queryDoc = { __meta__: { operation: 'test1' } } as unknown as DocumentNode<{ me: number }, { var1: number }>;
  const handler = createNextHandler(new URL('http://localhost:3001/api/graphql'), opsMap, {
    validate: false,
    onCreate(proxy) {
      proxy.addValidation(queryDoc, async function (input) {
        if (typeof input.var1 !== 'number') {
          return {
            type: 'validation',
            message: 'var 1 is not a number',
          };
        }
        return;
      });
    },
    request: async ({ body, headers }) => {
      t.same(JSON.parse(body).query, print(parse(opsMap.hash1)));
      t.same(headers, {
        'x-hasura-app': 'app',
        'content-length': 51,
        'content-type': 'application/json',
      });
      return {
        response: {
          data: null,
        },
      };
    },
  });

  const { req, res } = createMocks({
    method: 'GET',
    headers: {
      'x-hasura-app': 'app',
    },
    query: {
      op: 'test1',
      v: {
        var1: '123',
      },
    },
  });

  await handler(req, res);

  t.equal(res._getStatusCode(), 400);
  t.same(res._getData(), {
    message: 'var 1 is not a number',
  });
});

tap.test('cache', async (t) => {
  const opsMap = {
    hash1: 'query test1 { test }',
  };
  const handler = createNextHandler(new URL('http://localhost:3001/api/graphql'), opsMap, {
    validate: false,
    withCache: {
      cacheTTL: 1,
    },
    request: async () => {
      return {
        response: {
          data: {
            test: Math.random().toString(),
          },
        },
      };
    },
  });

  const m1 = createMocks({
    method: 'POST',
    headers: {
      'x-hasura-app': 'app',
    },
    body: {
      op: 'test1',
    },
  });

  const m2 = createMocks({
    method: 'POST',
    headers: {
      'x-hasura-app': 'app',
    },
    body: {
      op: 'test1',
    },
  });

  const p1 = handler(m1.req, m1.res);
  const p2 = handler(m2.req, m2.res);

  await Promise.all([p1, p2]);

  t.same(m1.res._getData(), m2.res._getData());
});
