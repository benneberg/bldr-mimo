/**
 * tools.ts — MiMo tool definitions
 *
 * We expose exactly ONE tool: apply_code_changes.
 * The AI must call it — no free-text output, no diff parsing.
 */

import type { MiMoTool } from './mimo';

export const APPLY_CODE_CHANGES_TOOL: MiMoTool = {
  type: 'function',
  function: {
    name: 'apply_code_changes',
    description:
      'Apply one or more file changes to the workspace. ' +
      'You MUST call this tool for every response that modifies code. ' +
      'Each change provides the complete updated file content — never a partial diff.',
    parameters: {
      type: 'object',
      properties: {
        changes: {
          type: 'array',
          description: 'List of file changes to apply.',
          items: {
            type: 'object',
            required: ['file', 'description', 'content'],
            properties: {
              file: {
                type: 'string',
                description: 'Relative path to the file from workspace root (e.g. "src/auth/jwt.ts")',
              },
              description: {
                type: 'string',
                description: 'One-sentence plain-English summary of what this change does.',
              },
              content: {
                type: 'string',
                description: 'The complete new content of the file after the change.',
              },
            },
          },
        },
      },
      required: ['changes'],
    },
  },
};

export const ALL_TOOLS = [APPLY_CODE_CHANGES_TOOL];
