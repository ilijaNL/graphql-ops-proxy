import tap from 'tap';
import { createMocks } from 'node-mocks-http';
import { createNextHandler } from '../src/nextjs';
import { print, parse } from 'graphql';
import { TypedOperation, copyHeaders } from '../src/proxy';

tap.test('happy post', async (t) => {
  const handler = createNextHandler(
    new URL('http://localhost:3001/api/graphql'),
    [{ behaviour: {}, operationName: 'test1', operationType: 'query', query: 'query test1 { test }' }],
    {
      request: async ({ body, headers }) => {
        t.same(JSON.parse(body).query, 'query test1 { test }');
        t.same(headers, {
          'x-hasura-app': 'app',
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
    }
  );

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
  const handler = createNextHandler(
    new URL('http://localhost:3001/api/graphql'),
    [{ behaviour: {}, operationName: 'test1', operationType: 'query', query: 'query test1 { test }' }],
    {
      request: async ({ body, headers }) => {
        return {
          response: {
            data: {
              test: '123',
            },
          },
        };
      },
    }
  );

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
  const handler = createNextHandler(
    new URL('http://localhost:3001/api/graphql'),
    [{ behaviour: {}, operationName: 'test1', operationType: 'query', query: 'query test1 { test }' }],
    {
      request: async ({ body, headers }) => {
        t.same(JSON.parse(body).query, 'query test1 { test }');
        t.same(headers, {
          'x-hasura-app': 'app',
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
    }
  );

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
  const handler = createNextHandler(
    new URL('http://localhost:3001/api/graphql'),
    [{ behaviour: {}, operationName: 'test1', operationType: 'query', query: 'query test1 { test }' }],
    {
      request: async ({ body, headers }) => {
        t.same(JSON.parse(body).query, 'query test1 { test }');
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
    }
  );

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
  const queryDoc: TypedOperation<{ me: number }, { var1: number }> = { operation: 'test1', operationType: 'query' };

  const handler = createNextHandler(
    new URL('http://localhost:3001/api/graphql'),
    [{ behaviour: {}, operationName: 'test1', operationType: 'query', query: 'query test1 { test }' }],
    {
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
    }
  );

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

tap.test('response headers', async (t) => {
  const handler = createNextHandler(
    new URL('http://localhost:3001/api/graphql'),
    [{ behaviour: {}, operationName: 'test1', operationType: 'query', query: 'query test1 { test }' }],
    {
      resultHeaders(proxyHeaders) {
        return copyHeaders(proxyHeaders ?? {}, ['x-includes']);
      },
      request: async ({ body, headers }) => {
        t.same(JSON.parse(body).query, 'query test1 { test }');
        t.same(headers, {
          'x-hasura-app': 'app',
          'content-type': 'application/json',
        });
        return {
          headers: {
            'x-includes': '123',
            'x-excludes': 'excludes',
          },
          response: {
            data: {
              test: '123',
            },
          },
        };
      },
    }
  );

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
  t.same(res.getHeaders(), { 'x-includes': '123' });
  t.same(res._getData(), {
    data: {
      test: '123',
    },
  });
});

tap.test('cache', async (t) => {
  const handler = createNextHandler(
    new URL('http://localhost:3001/api/graphql'),
    [{ behaviour: {}, operationName: 'test1', operationType: 'query', query: 'query test1 { test }' }],
    {
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
    }
  );

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
