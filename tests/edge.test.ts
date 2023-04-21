import tap from 'tap';
import { createEdgeHandler } from '../src/edge';
import { defaultParseFn, toNodeHeaders } from '../src/proxy';

tap.test('happy post', async (t) => {
  const handler = createEdgeHandler(
    async ({ headers }) => {
      return new Response(
        JSON.stringify({
          data: {
            test: '123',
          },
        }),
        {
          headers,
        }
      );
    },
    [{ behaviour: {}, operationName: 'test1', operationType: 'query', query: 'query test1 { test }' }]
  );

  const request = new Request('https://localhost/get', {
    headers: new Headers({ 'x-hasura-app': 'app' }),
    body: JSON.stringify({
      op: 'test1',
    }),
    method: 'POST',
  });

  const result = await handler(request);

  t.equal(result.status, 200);
  t.same(await result.json(), {
    data: {
      test: '123',
    },
  });
});

tap.test('wrong operation', async (t) => {
  const handler = createEdgeHandler(async () => {
    return new Response(
      JSON.stringify({
        data: {
          test1: '123',
        },
      })
    );
  }, [{ behaviour: {}, operationName: 'test1', operationType: 'query', query: 'query test1 { test }' }]);

  const req1 = new Request('https://localhost/get', {
    headers: new Headers({ 'x-hasura-app': 'app' }),
    body: JSON.stringify({
      op: 'test',
    }),
    method: 'POST',
  });

  const res1 = await handler(req1);

  t.equal(res1.status, 404);
  t.same(await res1.json(), {
    message: 'operation test not found',
  });

  const req2 = new Request('https://localhost/get', {
    headers: new Headers({ 'x-hasura-app': 'app' }),
    body: JSON.stringify({
      op: 123,
    }),
    method: 'POST',
  });

  const res2 = await handler(req2);

  t.equal(res2.status, 404);
  t.same(await res2.json(), {
    message: 'no operation defined',
  });
});

tap.test('happy get', async (t) => {
  const handler = createEdgeHandler(
    async ({ headers }) => {
      return new Response(
        JSON.stringify({
          data: {
            test: '123',
          },
        }),
        {
          headers,
        }
      );
    },
    [{ behaviour: {}, operationName: 'test1', operationType: 'query', query: 'query test1 { test }' }]
  );

  const params = new URLSearchParams({
    op: 'test1',
  });

  const request = new Request('https://localhost/get?' + params.toString(), {
    headers: new Headers({ 'x-hasura-app': 'app' }),
    method: 'GET',
  });

  const result = await handler(request);

  t.equal(result.status, 200);
  t.same(await result.json(), {
    data: {
      test: '123',
    },
  });
});

tap.test('only accept post/get', async (t) => {
  const handler = createEdgeHandler(
    async ({ headers }) => {
      return new Response(
        JSON.stringify({
          data: {
            test: '123',
          },
        }),
        {
          headers,
        }
      );
    },
    [{ behaviour: {}, operationName: 'test1', operationType: 'query', query: 'query test1 { test }' }]
  );

  const request = new Request('https://localhost/get', {
    headers: new Headers({ 'x-hasura-app': 'app' }),
    body: JSON.stringify({
      op: 'test1',
    }),
    method: 'PUT',
  });
  const result = await handler(request);

  t.equal(result.status, 404);
  t.same(await result.json(), {
    message: 'not-found',
  });
});

tap.test('options', async (t) => {
  const handler = createEdgeHandler(
    async ({ headers }) => {
      t.equal(headers.get('x-secret'), 'secret');
      t.equal(headers.get('x-exclude'), null);
      return new Response(
        JSON.stringify({
          data: {
            test: '123',
          },
        }),
        {
          headers,
        }
      );
    },
    [{ behaviour: {}, operationName: 'test1', operationType: 'query', query: 'query test1 { test }' }],
    {
      onCreate(proxy) {
        t.equal(proxy.getOperations().length, 1);
      },
      onParse: (r, p) => defaultParseFn(r, p),
      proxyHeaders: (h) => {
        h.set('x-secret', 'secret');
        h.delete('x-exclude');
        return h;
      },
    }
  );

  const request = new Request('https://localhost/get', {
    headers: new Headers({ 'x-hasura-app': 'app', 'x-exclude': '123' }),
    body: JSON.stringify({
      op: 'test1',
    }),
    method: 'POST',
  });
  const result = await handler(request);

  t.equal(result.status, 200);
  t.same(await result.json(), {
    data: {
      test: '123',
    },
  });
});

tap.test('modify response headers', async (t) => {
  const handler = createEdgeHandler(
    async () => {
      return new Response(
        JSON.stringify({
          data: {
            test: 'success',
          },
        }),
        {
          headers: new Headers({
            header1: 'abc',
          }),
        }
      );
    },
    [{ behaviour: {}, operationName: 'test1', operationType: 'query', query: 'query test1 { test }' }],
    {
      onResponse(response, props) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        response.headers.set('header1', props.originHeaders.get('header1')! + '11');
        return response;
      },
    }
  );

  const m1 = new Request('https://localhost/get', {
    method: 'POST',
    body: JSON.stringify({
      operationName: 'test1',
      variables: { var: 'var' },
    }),
  });

  const res1 = await handler(m1);

  t.same(await res1.json(), { data: { test: 'success' } });
  t.same(toNodeHeaders(res1.headers), {
    'content-type': 'text/plain;charset=UTF-8',
    header1: 'abc11',
  });
});

tap.test('request throws', async (t) => {
  const handler = createEdgeHandler(
    async () => {
      throw new Error('kaboom');
    },
    [{ behaviour: {}, operationName: 'test1', operationType: 'query', query: 'query test1 { test }' }],
    {
      onResponse(response, props) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        response.headers.set('header1', props.originHeaders.get('header1')! + '11');
        return response;
      },
    }
  );

  const m1 = new Request('https://localhost/get', {
    method: 'POST',
    body: JSON.stringify({
      operationName: 'test1',
      variables: { var: 'var' },
    }),
  });

  const res1 = await handler(m1);

  t.equal(res1.status, 500);
  t.same(await res1.json(), { message: 'kaboom' });
});

tap.test('happy post', async (t) => {
  const handler = createEdgeHandler(
    async ({ headers }) => {
      return new Response(
        JSON.stringify({
          data: {
            test: '123',
          },
        }),
        {
          headers,
        }
      );
    },
    [{ behaviour: {}, operationName: 'test1', operationType: 'query', query: 'query test1 { test }' }]
  );

  const request = new Request('https://localhost/get', {
    headers: new Headers({ 'x-hasura-app': 'app' }),
    body: JSON.stringify({
      op: 'test1',
    }),
    method: 'POST',
  });

  const result = await handler(request);

  t.equal(result.status, 200);
  t.same(await result.json(), {
    data: {
      test: '123',
    },
  });
});
