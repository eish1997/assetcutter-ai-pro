export type JsonSchema = {
  additionalProperties?: boolean;
  enum?: string[];
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  type: 'array' | 'boolean' | 'integer' | 'null' | 'number' | 'object' | 'string';
};

export function objectSchema(properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema {
  return {
    additionalProperties: false,
    properties,
    required,
    type: 'object',
  };
}

export function stringSchema(values?: string[]): JsonSchema {
  return values ? { enum: values, type: 'string' } : { type: 'string' };
}

export function booleanSchema(): JsonSchema {
  return { type: 'boolean' };
}

export function numberSchema(): JsonSchema {
  return { type: 'number' };
}
