/**
 * validators.ts — strict schema validation for AI tool call responses
 *
 * Supports both strategies:
 *   replace_section — requires search_block + replace_block
 *   full_file       — requires content
 */

export type ChangeStrategy = 'replace_section' | 'full_file';

export interface CodeChange {
  file: string;
  description: string;
  strategy: ChangeStrategy;
  // replace_section
  search_block?: string;
  replace_block?: string;
  // full_file
  content?: string;
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

export function parseChanges(rawArguments: string): ParsedChanges {
  let parsed: unknown;

  try {
    parsed = JSON.parse(rawArguments);
  } catch {
    throw new ValidationError(
      `apply_code_changes arguments are not valid JSON: ${rawArguments.slice(0, 200)}`
    );
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

    // file
    if (typeof item.file !== 'string' || !item.file.trim()) {
      throw new ValidationError(`changes[${i}].file must be a non-empty string`);
    }
    const filePath = item.file.trim();
    if (filePath.startsWith('/') || filePath.includes('..')) {
      throw new ValidationError(`changes[${i}].file contains unsafe path: ${filePath}`);
    }

    // description
    if (typeof item.description !== 'string' || !item.description.trim()) {
      throw new ValidationError(`changes[${i}].description must be a non-empty string`);
    }

    // strategy — be lenient: if missing, infer from which fields are present
    let strategy: ChangeStrategy;
    if (item.strategy === 'replace_section' || item.strategy === 'full_file') {
      strategy = item.strategy;
    } else if (item.search_block !== undefined) {
      strategy = 'replace_section';
    } else if (item.content !== undefined) {
      strategy = 'full_file';
    } else {
      throw new ValidationError(
        `changes[${i}].strategy must be "replace_section" or "full_file"`
      );
    }

    if (strategy === 'replace_section') {
      if (typeof item.search_block !== 'string') {
        throw new ValidationError(
          `changes[${i}]: strategy=replace_section requires search_block (string)`
        );
      }
      if (typeof item.replace_block !== 'string') {
        throw new ValidationError(
          `changes[${i}]: strategy=replace_section requires replace_block (string)`
        );
      }
      changes.push({
        file: filePath,
        description: item.description.trim(),
        strategy,
        search_block: item.search_block,
        replace_block: item.replace_block,
      });
    } else {
      // full_file
      if (typeof item.content !== 'string') {
        throw new ValidationError(
          `changes[${i}]: strategy=full_file requires content (string)`
        );
      }
      changes.push({
        file: filePath,
        description: item.description.trim(),
        strategy,
        content: item.content,
      });
    }
  }

  if (changes.length === 0) {
    throw new ValidationError('apply_code_changes.changes must contain at least one item');
  }

  return { changes };
}
