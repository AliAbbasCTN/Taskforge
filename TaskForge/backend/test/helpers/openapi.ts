import type { OpenAPIObject } from '@nestjs/swagger';

/**
 * Helpers for CONTRACT tests: checking that what the API really sends matches
 * what the OpenAPI document says it sends.
 *
 * Why this exists: response models (`src/docs/models`) are documentation only,
 * so nothing at compile time stops them drifting from the services. A wrong
 * example in the docs is worse than none, so the e2e suite compares real
 * responses with the published schemas.
 */

type Schema = {
  $ref?: string;
  allOf?: Schema[];
  type?: string;
  properties?: Record<string, Schema>;
  items?: Schema;
  additionalProperties?: unknown;
};

function resolve(doc: OpenAPIObject, schema: Schema): Schema {
  if (schema.$ref) {
    const name = schema.$ref.split('/').pop() as string;
    const target = (doc.components?.schemas ?? {})[name] as Schema | undefined;
    if (!target) {
      throw new Error(`Schema ${schema.$ref} is referenced but not defined`);
    }
    return resolve(doc, target);
  }
  // Swagger renders a nullable reference as `{ nullable: true, allOf: [ref] }`.
  if (schema.allOf && schema.allOf.length === 1) {
    return resolve(doc, schema.allOf[0]);
  }
  return schema;
}

/**
 * Compares a real value with a schema. Returns a list of human-readable
 * problems (empty means it matches). It checks BOTH directions:
 *   - a field in the response that the schema does not mention (undocumented)
 *   - a field in the schema that the response does not contain (phantom)
 */
export function schemaMismatches(
  doc: OpenAPIObject,
  schema: Schema,
  value: unknown,
  path = 'body',
): string[] {
  // Documented fields may be nullable; a null needs no further checking.
  if (value === null) {
    return [];
  }
  const resolved = resolve(doc, schema);

  if (resolved.type === 'array' && resolved.items) {
    if (!Array.isArray(value)) {
      return [`${path}: expected an array`];
    }
    return value.flatMap((item, index) =>
      schemaMismatches(doc, resolved.items as Schema, item, `${path}[${index}]`),
    );
  }

  if (resolved.properties) {
    if (typeof value !== 'object' || Array.isArray(value)) {
      return [`${path}: expected an object`];
    }
    const actual = value as Record<string, unknown>;
    const documented = Object.keys(resolved.properties);
    const problems: string[] = [];
    for (const key of Object.keys(actual)) {
      if (!documented.includes(key)) {
        problems.push(`${path}.${key}: returned by the API but not documented`);
      }
    }
    for (const key of documented) {
      if (!(key in actual)) {
        problems.push(`${path}.${key}: documented but not returned by the API`);
      }
    }
    for (const key of documented) {
      if (key in actual) {
        problems.push(
          ...schemaMismatches(
            doc,
            (resolved.properties as Record<string, Schema>)[key],
            actual[key],
            `${path}.${key}`,
          ),
        );
      }
    }
    return problems;
  }
  return [];
}

/** Builds the schema for "an array of the named model". */
export const arrayOf = (name: string): Schema => ({
  type: 'array',
  items: { $ref: `#/components/schemas/${name}` },
});

export const modelRef = (name: string): Schema => ({
  $ref: `#/components/schemas/${name}`,
});
