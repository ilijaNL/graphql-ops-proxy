export function getHasuraHeaders(headers: Record<string, any>): Record<string, any> {
  return Object.keys(headers).reduce((agg, key) => {
    if (key.toLowerCase().startsWith('x-hasura')) {
      agg[key] = headers[key];
    }
    return agg;
  }, {} as Record<string, any>);
}
