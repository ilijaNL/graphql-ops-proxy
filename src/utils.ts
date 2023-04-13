import type { GraphQLError } from 'graphql';
import { GraphqlProxy } from './proxy';
import type { IncomingHttpHeaders } from 'http';

export function getHasuraHeaders(headers: Record<string, any>): Record<string, any> {
  return Object.keys(headers).reduce((agg, key) => {
    if (key.toLowerCase().startsWith('x-hasura')) {
      agg[key] = headers[key];
    }
    return agg;
  }, {} as Record<string, any>);
}

export const validateProxy = async (proxy: GraphqlProxy, introspectionHeaders: IncomingHttpHeaders = {}) => {
  // fetch introspection
  // filter out custom executions
  const opsToCheck = proxy.getOperations().filter((o) => !o.customHandler);

  // lazy load graphql
  const { getIntrospectionQuery, buildClientSchema, validate, parse } = await import('graphql');

  if (opsToCheck.length === 0) {
    return [];
  }

  // fetch introspection query
  const query = getIntrospectionQuery();
  // validate
  const { response } = await proxy.rawRequest({
    query: query,
    headers: {
      ...introspectionHeaders,
    },
  });

  const schema = buildClientSchema(response.data);

  const errors = opsToCheck.reduce((agg, curr) => {
    const errs = validate(schema, parse(curr.query));
    return [...agg, ...errs];
  }, [] as GraphQLError[]);

  return errors;
};
