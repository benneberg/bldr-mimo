/**
 * validators.ts — strict schema validation for MiMo responses
 *
 * Every response from MiMo must contain a valid apply_code_changes
 * tool call. We validate and parse it here before the UI ever sees it.
 */

export interface CodeChange {
  file: string;
  description: string;
  content: string;
}

export interface ParsedChanges {
  changes: CodeChange[];
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Parses and validates the raw JSON arguments string from a MiMo tool call.
 * Throws ValidationError if the schema is wrong.
 */
export function parseChanges(rawArguments: string): ParsedChanges {
  let parsed: unknown;

  try {
    parsed = JSON.parse(rawArguments);
  } catch {
    throw new ValidationError(`apply_code_changes arguments are not valid JSON: ${rawArguments.slice(0, 200)}`);
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new ValidationError('apply_code_changes arguments must be an object');
  }

  const obj = parsed as Record<string, unknown>;

  if (!Array.isArray(obj.changes)) {
    throw new ValidationError('apply_code_changes.changes must be an array');
  }

  const changes: CodeChange[] = [];

  for (let i = 0; i < obj.changes.length; i++) {
    const item = obj.changes[i] as Record<string, unknown>;

    if (typeof item.file !== 'string' || !item.file.trim()) {
      throw new ValidationError(`changes[${i}].file must be a non-empty string`);
    }
    if (typeof item.description !== 'string' || !item.description.trim()) {
      throw new ValidationError(`changes[${i}].description must be a non-empty string`);
    }
    if (typeof item.content !== 'string') {
      throw new ValidationError(`changes[${i}].content must be a string`);
    }

    // Basic path safety: reject absolute paths and traversal attempts
    const filePath = item.file.trim();
    if (filePath.startsWith('/') || filePath.includes('..')) {
      throw new ValidationError(`changes[${i}].file contains unsafe path: ${filePath}`);
    }

    changes.push({
      file: filePath,
      description: item.description.trim(),
      content: item.content,
    });
  }

  if (changes.length === 0) {
    throw new ValidationError('apply_code_changes.changes must contain at least one item');
  }

  return { changes };
}
