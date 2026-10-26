import type { AgentTool } from '@aether/ui/AgentServices';

type Schema = Record<string, unknown>;
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** The schema subset used by CAD's published tool contracts. Unsupported
 * keywords fail visibly instead of making discovery promise unenforced rules.
 * Domain validation and exact rebuild still run in the ordinary operation. */
const keywords = new Set([
  'type', 'properties', 'required', 'additionalProperties', 'items', 'enum',
  'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum',
  'minItems', 'maxItems', 'minLength', 'maxLength',
  'description', 'title', 'default', 'examples',
]);

function matchesType(value: unknown, type: unknown): boolean {
  switch (type) {
    case 'object': return object(value);
    case 'array': return Array.isArray(value);
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'integer': return typeof value === 'number' && Number.isSafeInteger(value);
    case 'string': return typeof value === 'string';
    case 'boolean': return typeof value === 'boolean';
    case 'null': return value === null;
    default: throw Error(`Unsupported CAD contract type: ${String(type)}.`);
  }
}

function validate(value: unknown, schema: Schema, path: string): void {
  for (const keyword of Object.keys(schema)) {
    if (!keywords.has(keyword)) throw Error(`Unsupported CAD contract keyword: ${keyword}.`);
  }
  const fail = (reason: string): never => { throw Error(`${path}: ${reason}.`); };
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some(type => matchesType(value, type))) fail(`must be ${types.join(' or ')}${schema.type === 'boolean' ? ' (true or false)' : ''}`);
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) fail(`choose ${schema.enum.join(', ')}`);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('must be finite');
    if (typeof schema.minimum === 'number' && value < schema.minimum) fail(`must be at least ${schema.minimum}`);
    if (typeof schema.maximum === 'number' && value > schema.maximum) fail(`must be at most ${schema.maximum}`);
    if (typeof schema.exclusiveMinimum === 'number' && value <= schema.exclusiveMinimum) fail(`must be greater than ${schema.exclusiveMinimum}`);
    if (typeof schema.exclusiveMaximum === 'number' && value >= schema.exclusiveMaximum) fail(`must be less than ${schema.exclusiveMaximum}`);
  }
  if (typeof value === 'string') {
    const length = [...value].length;
    if (typeof schema.minLength === 'number' && length < schema.minLength) fail(`needs at least ${schema.minLength} characters`);
    if (typeof schema.maxLength === 'number' && length > schema.maxLength) fail(`exceeds ${schema.maxLength} characters`);
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) fail(`needs at least ${schema.minItems} items`);
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) fail(`allows at most ${schema.maxItems} items`);
    if (object(schema.items)) value.forEach((item, index) => validate(item, schema.items as Schema, `${path}[${index}]`));
  }
  if (object(value)) {
    const properties = object(schema.properties) ? schema.properties : {};
    if (Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (typeof key === 'string' && !Object.hasOwn(value, key)) fail(`missing required ${key}`);
      }
    }
    for (const [key, item] of Object.entries(value)) {
      const definition = Object.hasOwn(properties, key) ? properties[key] : undefined;
      if (object(definition)) validate(item, definition, `${path}.${key}`);
      else if (schema.additionalProperties === false) fail(`Unknown argument ${key}`);
      else if (object(schema.additionalProperties)) validate(item, schema.additionalProperties, `${path}.${key}`);
    }
  }
}

/** Validate before touching a workspace, rebuilding, exporting or mutating. */
export function validateToolArguments(tools: readonly AgentTool[], name: string, args: unknown): AgentTool {
  const descriptor = tools.find(tool => tool.name === name);
  if (!descriptor || !object(args)) throw Error('Unknown CAD tool or argument.');
  validate(args, descriptor.inputSchema as Schema, name);
  return descriptor;
}
