import { CodegenConfig } from '@graphql-codegen/cli';

const sharedConfig = {
  enumsAsConst: true,
  skipTypename: true,
  avoidOptionals: {
    field: true,
    inputValue: false,
    object: true,
    defaultValue: false,
  },
  // avoidOptionals: true,
  scalars: {
    uuid: 'string',
    UUID: 'string',
    EmailAddress: 'string',
    JSONObject: 'Record<string, any>',
    bigint: 'number',
    timestamptz: 'string',
    timestampt: 'string',
    time: 'string',
    Date: 'Date',
    json: 'Record<string, any> | Array<any>',
    jsonb: 'Record<string, any> | Array<any>',
  },
};

const config: CodegenConfig = {
  schema: [
    'https://countries.trevorblades.com/',
    // additional schema
    './graphql.overrides.graphql',
  ],
  documents: ['src/**/*.graphql'],
  generates: {
    './src/__generated__/gql.ts': {
      plugins: ['typescript', 'typescript-operations', 'graphql-codegen-typed-operation'],
      config: {
        ...sharedConfig,
      },
    },
  },
};

export default config;
