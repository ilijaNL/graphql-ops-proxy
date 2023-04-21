import tap from 'tap';
import { createGraphqlProxy } from '../src/proxy';
import type { IncomingHttpHeaders } from 'http';
import { Headers, Response } from '@whatwg-node/fetch';

export function toNodeHeaders(headers: Headers): IncomingHttpHeaders {
  const result: IncomingHttpHeaders = {};
  for (const [key, value] of headers) {
    // see https://github.com/vercel/next.js/blob/1088b3f682cbe411be2d1edc502f8a090e36dee4/packages/next/src/server/web/utils.ts#L29
    // if (key.toLowerCase() === 'set-cookie') {
    //   // We may have gotten a comma joined string of cookies, or multiple
    //   // set-cookie headers. We need to merge them into one header array
    //   // to represent all the cookies.
    //   cookies.push(...splitCookiesString(value))
    //   result[key] = cookies.length === 1 ? cookies[0] : cookies
    // } else {
    //   result[key] = value
    // }

    result[key] = value;
  }
  return result;
}

tap.test('rejects when not found', async (t) => {
  t.plan(1);

  const proxy = createGraphqlProxy([], async () => new Response(null, { headers: {} }));
  t.rejects(proxy.request('does-not-exists', { var1: 'var2' }, new Headers({ header: 'head1' })));
});

tap.test('calls remote', async (t) => {
  t.plan(4);

  const ops = [{ behaviour: {}, operationName: 'test', operationType: 'query', query: 'query test { test }' }] as const;

  const proxy = createGraphqlProxy([...ops], async (props) => {
    const input = JSON.parse(props.body);

    t.match(input.query, ops[0].query);
    t.same(input.variables, { var1: 'var2' });
    t.equal(toNodeHeaders(props.headers)['header'], 'head1');

    return new Response(JSON.stringify({ data: { me: 123 } }));
  });

  const result = await proxy.request('test', { var1: 'var2' }, new Headers({ header: 'head1' }));
  // it returns as a buffer
  const response = await result.json();
  t.same(response, { data: { me: 123 } });
});

tap.test('get operation', async (t) => {
  const ops = [
    {
      behaviour: {
        ttl: 3,
      },
      operationName: 'test',
      operationType: 'query',
      query: 'query test { test }',
    },
  ] as const;

  const proxy = createGraphqlProxy([...ops], async () => new Response(null, { headers: {} }));

  t.throws(() => proxy.getOperation('testtt'));

  const def = proxy.getOperation('test');
  t.equal(def.operationName, ops[0].operationName);
  t.equal(def.query, ops[0].query);
  t.equal(def.mBehaviour.ttl, ops[0].behaviour.ttl);
  t.equal(def.type, 'query');
});

tap.test('calls operation preHandler', async (t) => {
  t.plan(5);

  const ops = [{ behaviour: {}, operationName: 'test', operationType: 'query', query: 'query test { test }' }] as const;

  const proxy = createGraphqlProxy([...ops], async (props) => {
    const input = JSON.parse(props.body);

    t.match(input.query, ops[0].query);
    t.same(input.variables, { var2: 'var1' });
    t.equal(toNodeHeaders(props.headers)['header'], 'head1');

    return new Response(JSON.stringify({ data: { me: 123 } }));
  });

  proxy.setPreHandler('test', (props) => {
    t.equal(props.query, ops[0].query);
    return {
      ...props,
      headers: props.headers,
      variables: {
        var2: 'var1',
      },
    };
  });

  const result = await proxy.request('test', { var1: 'var2' }, new Headers({ header: 'head1' }));
  // it returns as a buffer
  const response = await result.json();
  t.same(response, { data: { me: 123 } });
});

tap.test('removes headers', async (t) => {
  t.plan(1);
  const ops = [{ behaviour: {}, operationName: 'test', operationType: 'query', query: 'query test { test }' }] as const;

  const proxy = createGraphqlProxy([...ops], async (props) => {
    t.same(toNodeHeaders(props.headers), {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: 'auth2123',
    });

    return new Response(JSON.stringify({ data: { me: 123 } }));
  });

  await proxy.request(
    'test',
    { var1: 'var2' },
    new Headers({ 'content-length': '123', host: 'http:', connection: 'keep-alive', authorization: 'auth2123' })
  );
});
