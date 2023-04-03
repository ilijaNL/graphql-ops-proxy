import tap from 'tap';
import { createGraphqlProxy } from '../src/proxy';
import { Type, TSchema, Static } from '@sinclair/typebox';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { addMocksToSchema } from '@graphql-tools/mock';
import { graphql, parse, print } from 'graphql';
import { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';
import addFormats from 'ajv-formats';
import Ajv from 'ajv/dist/2019';

const ajv = addFormats(new Ajv({}), [
  'date-time',
  'time',
  'date',
  'email',
  'hostname',
  'ipv4',
  'ipv6',
  'uri',
  'uri-reference',
  'uuid',
  'uri-template',
  'json-pointer',
  'relative-json-pointer',
  'regex',
])
  .addKeyword('kind')
  .addKeyword('modifier');

export const createValidateFn = <T extends TSchema>(schema: T) => {
  const validate = ajv.compile<Static<T>>(schema);
  return validate;
};

const queryDoc = { __meta__: { operation: 'operation' } } as unknown as DocumentNode<{ me: number }, { var1: string }>;

const schema = makeExecutableSchema({
  typeDefs: `
    type Query {
      test: String!
    }

    type Mutation {
      create: String!
    }
`,
});

const schemaWithMocks = addMocksToSchema({ schema });

tap.test('happy', async (t) => {
  const proxy = createGraphqlProxy({}, async () => ({ headers: {}, response: null }));
  const errors = await proxy.validate();

  t.same(errors, []);
});

tap.test('return errors when not all operations are implemented', async (t) => {
  const proxy = createGraphqlProxy(
    {
      hash1: 'query test { me }',
    },
    async ({ body }) => {
      const source = JSON.parse(body).query;
      const data = await graphql({
        schema: schemaWithMocks,
        source: source,
      });

      return {
        response: data,
      };
    }
  );
  const errors = await proxy.validate();

  t.equal(errors[0]?.message, 'Cannot query field "me" on type "Query".');
});

tap.test('throws when not valid query', async (t) => {
  t.throws(() =>
    createGraphqlProxy(
      {
        hash1: 'query { me }',
      },
      async () => ({ response: null })
    )
  );
});

tap.test('rejects when not found', async (t) => {
  t.plan(1);

  const proxy = createGraphqlProxy({}, async () => ({ headers: {}, response: null }));
  t.rejects(proxy.request('does-not-exists', { var1: 'var2' }, { header: 'head1' }));
});

tap.test('calls remote', async (t) => {
  t.plan(4);

  const opsMap = {
    op1: `query test { test }`,
  };

  const proxy = createGraphqlProxy(opsMap, async ({ body, headers }) => {
    const input = JSON.parse(body);

    t.equal(input.query, print(parse(opsMap.op1)));
    t.same(input.variables, { var1: 'var2' });
    t.equal((headers as Record<string, string>)['header'], 'head1');

    return {
      response: {
        data: {
          me: 123,
        },
      },
    };
  });

  const result = await proxy.request('test', { var1: 'var2' }, { header: 'head1' });
  // it returns as a buffer
  const response = result.response;
  t.same(response.data, { me: 123 });
});

tap.test('correctly handles directives', async (t) => {
  const opsMap = {
    op1: `query test @pcached(ttl: 1) { test }`,
    op2: `query abc @cached(ttl: 1) { test }`,
    op3: `query d { awaw }`,
  };

  const queries: string[] = [];

  const proxy = createGraphqlProxy(opsMap, async ({ body }) => {
    const { query } = JSON.parse(body as string);
    queries.push(query);

    return {
      response: Buffer.from(Math.random().toString()),
    };
  });

  await proxy.request('test');
  await proxy.request('abc');
  await proxy.request('d');

  t.same(queries, [print(parse('query test { test }')), print(parse(opsMap.op2)), print(parse(opsMap.op3))]);
});

tap.test('validates', async (t) => {
  t.plan(4);
  const proxy = createGraphqlProxy(
    {
      hash1: 'query operation { me }',
    },
    async () => ({ headers: {}, response: null })
  );

  proxy.addOverride(queryDoc, async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    return {
      me: 222,
    };
  });

  const validateFn = createValidateFn(Type.Object({ var1: Type.String({ minLength: 3 }) }));

  proxy.addValidation(queryDoc, async (input) => {
    t.pass('called');
    const isValid = validateFn(input);
    if (isValid) {
      return;
    }
    return {
      type: 'validation',
      message: 'notvalid',
    };
  });

  const p2 = await proxy.request('operation', { var1: 'abcd' }, {});
  t.equal(p2.response.data.me, 222);

  t.rejects(proxy.request('operation', { var1: 'a' }, {}));
});
