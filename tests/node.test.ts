import { createRequestPool, withCache } from '../src/node';
import { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';
import { MockAgent } from 'undici';
import tap from 'tap';
import { createGraphqlProxy } from '../src/proxy';
import { parse, print } from 'graphql';

const queryDoc = { __meta__: { operation: 'operation' } } as unknown as DocumentNode<{ me: number }, { var1: string }>;

tap.test('dedupes remote', async (t) => {
  const agent = new MockAgent();
  agent.disableNetConnect();

  const client = agent.get('http://localhost:3001').setMaxListeners(20);

  const opsMap = {
    hash1: 'query test1 { test }',
  };

  client
    .intercept({
      path: '/v1/graphql',
      method: 'POST',
    })
    .reply(200, () => {
      return Buffer.from(Math.random().toString());
    })
    .times(7);

  const requestPool = createRequestPool(new URL('http://localhost:3001/v1/graphql'), {
    factory() {
      return client;
    },
  });

  const proxy = createGraphqlProxy(opsMap, requestPool.request);

  withCache(proxy.getOperations(), { cacheTTL: 0 });

  t.teardown(() => requestPool.close());
  // test that it dedupes remote request
  {
    const r1 = proxy.request('test1', { var1: 'var2' }, { header: 'head1', 'x-hasura-h': 'a' });
    const r2 = proxy.request('test1', { var1: 'var2' }, { header: 'head1', 'x-hasura-h': 'a' });

    const [res1, res2] = await Promise.all([r1, r2]);
    t.equal(res1, res2);
  }

  // test that it does not dedupe remote request when different auth header
  {
    const r1 = proxy.request('test1', { var1: 'var2' }, { authorization: 'auth1' });
    const r2 = proxy.request('test1', { var1: 'var2' }, { authorization: 'auth2' });

    const [res1, res2] = await Promise.all([r1, r2]);
    t.not(res1, res2);
  }

  // when variables are diff
  {
    const r1 = proxy.request('test1', { var1: 'var1' }, { authorization: 'a' });
    const r2 = proxy.request('test1', { var1: 'var2' }, { authorization: 'a' });

    const [res1, res2] = await Promise.all([r1, r2]);
    t.not(res1, res2);
  }

  // when hasura vars are diff
  {
    const r1 = proxy.request('test1', { var1: 'var1' }, { authorization: 'a', 'x-hasura-h': 'a' });
    const r2 = proxy.request('test1', { var1: 'var2' }, { authorization: 'a', 'x-hasura-h': 'b' });

    const [res1, res2] = await Promise.all([r1, r2]);
    t.not(res1, res2);
  }
});

tap.test('caches remote', async (t) => {
  const agent = new MockAgent();
  agent.disableNetConnect();

  const opsMap = {
    op: `query cachedQuery @pcached(ttl: 1) { test }`,
  };

  const client = agent.get('http://localhost:3001');
  client
    .intercept({
      path: '/v1/graphql',
      method: 'POST',
    })
    .reply(200, ({ body }) => {
      const { query } = JSON.parse(body as string);
      t.equal(query, print(parse('query cachedQuery { test }')));
      return Buffer.from(Math.random().toString());
    })
    .times(2);

  const requestPool = createRequestPool(new URL('http://localhost:3001/v1/graphql'), {
    factory() {
      return client;
    },
  });

  const proxy = createGraphqlProxy(opsMap, requestPool.request);

  withCache(proxy.getOperations(), { cacheTTL: 1 });

  t.teardown(() => requestPool.close());

  // test that it caches remote requests with correct ttl
  {
    const r1 = await proxy.request('cachedQuery', { var1: 'var2' }, { header: 'head1', 'x-hasura-h': 'a' });
    await new Promise((resolve) => setTimeout(resolve, 30));
    const r2 = await proxy.request('cachedQuery', { var1: 'var2' }, { header: 'head1', 'x-hasura-h': 'a' });

    t.equal(r1, r2);

    await new Promise((resolve) => setTimeout(resolve, 1100));
    const r3 = await proxy.request('cachedQuery', { var1: 'var2' }, { header: 'head1', 'x-hasura-h': 'a' });
    t.not(r2, r3);
  }
});

tap.test('custom override', async (t) => {
  t.plan(3);
  const proxy = createGraphqlProxy(
    {
      1: 'query operation { me }',
    },
    async () => ({ headers: {}, response: null })
  );

  proxy.addOverride(queryDoc, async (input, headers) => {
    t.equal(input.var1, 'var2');
    t.equal(headers.header, 'head1');
    return {
      me: 123,
    };
  });

  const result = await proxy.request('operation', { var1: 'var2' }, { header: 'head1' });
  t.same(result.response.data, { me: 123 });
});

tap.test('dedupes', async (t) => {
  const proxy = createGraphqlProxy(
    {
      1: 'query operation { me }',
    },
    async () => ({ headers: {}, response: null })
  );

  withCache(proxy.getOperations(), { cacheTTL: 0 });

  proxy.addOverride(queryDoc, async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    return {
      me: Math.random(),
    };
  });

  const p1 = proxy.request('operation', { var1: 'var2' }, {});
  const p2 = proxy.request('operation', { var1: 'var2' }, {});
  const [res1, res2] = await Promise.all([p1, p2]);
  t.equal(res1, res2);
});

tap.test('does not dedupes mutation', async (t) => {
  const proxy = createGraphqlProxy(
    {
      1: 'mutation operation { me }',
    },
    async () => ({ headers: {}, response: null })
  );

  withCache(proxy.getOperations(), { cacheTTL: 1 });

  proxy.addOverride(queryDoc, async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    return {
      me: Math.random(),
    };
  });

  const p1 = proxy.request('operation', { var1: 'var2' }, {});
  const p2 = proxy.request('operation', { var1: 'var2' }, {});
  const [res1, res2] = await Promise.all([p1, p2]);
  t.not(res1, res2);
});

tap.test('cache with override', async (t) => {
  const proxy = createGraphqlProxy(
    {
      1: 'query operation { me }',
    },
    async () => ({ headers: {}, response: null })
  );

  withCache(proxy.getOperations(), { cacheTTL: 1 });

  proxy.addOverride(queryDoc, async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    return {
      me: Math.random(),
    };
  });

  const p1 = await proxy.request('operation', { var1: 'var2' }, {});
  const p2 = await proxy.request('operation', { var1: 'var2' }, {});
  t.equal(p1, p2);
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const p3 = await proxy.request('operation', { var1: 'var2' }, {});
  t.not(p2, p3);
});
