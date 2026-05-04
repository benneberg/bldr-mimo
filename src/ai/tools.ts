/**
 * tools.ts — AI tool definitions
 *
 * apply_code_changes now supports two strategies:
 *
 *   replace_section  — find + replace a block of text (preferred, token-efficient)
 *   full_file        — complete file overwrite (new files, major rewrites only)
 *
 * The system prompt instructs MiMo to prefer replace_section for any change
 * under ~30 lines. This fixes the "add one word → rewrite entire file" problem.
 */

import type { MiMoTool } from './mimo';

export const APPLY_CODE_CHANGES_TOOL: MiMoTool = {
  type: 'function',
  function: {
    name: 'apply_code_changes',
    description:
      'Apply one or more changes to workspace files. ' +
      'Choose the correct strategy for each change:\n' +
      '- replace_section: for targeted edits (adding, removing, or modifying a section). PREFERRED.\n' +
      '- full_file: ONLY for creating new files or complete rewrites of small files (<50 lines).',
    parameters: {
      type: 'object',
      required: ['changes'],
      properties: {
        changes: {
          type: 'array',
          description: 'List of file changes to apply. Each item modifies exactly one file.',
          items: {
            type: 'object',
            required: ['file', 'description', 'strategy'],
            properties: {
              file: {
                type: 'string',
                description: 'Relative path to the file from workspace root. Must exist in available_files unless strategy is full_file for a new file.',
              },
              description: {
                type: 'string',
                description: 'One plain-English sentence describing what this change does and why.',
              },
              strategy: {
                type: 'string',
                enum: ['replace_section', 'full_file'],
                description:
                  'replace_section: provide search_block + replace_block. ' +
                  'full_file: provide content (complete file text). ' +
                  'ALWAYS prefer replace_section unless creating a new file.',
              },
              // replace_section fields
              search_block: {
                type: 'string',
                description:
                  '[replace_section only] The exact verbatim text to find in the file. ' +
                  'Must match character-for-character including whitespace and indentation. ' +
                  'Include enough surrounding context (3-5 lines) to be unique in the file.',
              },
              replace_block: {
                type: 'string',
                description:
                  '[replace_section only] The text to replace search_block with. ' +
                  'To delete a section, provide an empty string.',
              },
              // full_file fields
              content: {
                type: 'string',
                description:
                  '[full_file only] The complete new content of the file. ' +
                  'Only use this for new files or files under 50 lines.',
              },
            },
          },
        },
      },
    },
  },
};

export const ALL_TOOLS = [APPLY_CODE_CHANGES_TOOL];
