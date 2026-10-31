// A list row without its null fields: the client's types read a missing field
// as null, and over half of a session row's columns are.
export function omitNulls<T extends object>(row: T): T {
  const out: Partial<T> = {};
  for (const k of Object.keys(row) as (keyof T)[])
    if (row[k] !== null) out[k] = row[k];
  return out as T;
}
