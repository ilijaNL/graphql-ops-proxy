import tap from 'tap';
import { TypedOperation, createGraphqlProxy } from '../src/proxy';
import { validateProxy } from '../src/utils';
import { Type, TSchema, Static } from '@sinclair/typebox';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { addMocksToSchema } from '@graphql-tools/mock';
import { graphql } from 'graphql';
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
  const proxy = createGraphqlProxy([], async () => ({ headers: {}, response: null }));
  const errors = await validateProxy(proxy);

  t.same(errors, []);
});

tap.test('return errors when not all operations are implemented', async (t) => {
  const proxy = createGraphqlProxy(
    [{ behaviour: {}, operationName: 'test', query: 'query test { me }', operationType: 'query' }],
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
  const errors = await validateProxy(proxy);

  t.equal(errors[0]?.message, 'Cannot query field "me" on type "Query".');
});

tap.test('rejects when not found', async (t) => {
  t.plan(1);

  const proxy = createGraphqlProxy([], async () => ({ headers: {}, response: null }));
  t.rejects(proxy.request('does-not-exists', { var1: 'var2' }, { header: 'head1' }));
});

tap.test('calls remote', async (t) => {
  t.plan(4);

  const ops = [{ behaviour: {}, operationName: 'test', operationType: 'query', query: 'query test { test }' }] as const;

  const proxy = createGraphqlProxy([...ops], async ({ body, headers }) => {
    const input = JSON.parse(body);

    t.match(input.query, ops[0].query);
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

tap.test('validates', async (t) => {
  t.plan(4);
  const proxy = createGraphqlProxy(
    [{ behaviour: {}, operationName: 'operation', operationType: 'query', query: 'query operation { me }' }],
    async () => ({ headers: {}, response: null })
  );

  const op: TypedOperation = { operation: 'operation', operationType: 'query' };

  proxy.addOverride(op, async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    return {
      response: {
        me: 222,
      },
    };
  });

  const validateFn = createValidateFn(Type.Object({ var1: Type.String({ minLength: 3 }) }));

  proxy.addValidation(op, async (input) => {
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
