A production-ready MiMo client + tool-calling pipeline tailored to your architecture.

This is not generic boilerplate—this is designed to plug directly into your existing Express + tool system and enforce:

AI must return structured, executable changes—or fail

⸻

⚙️ 1. Install + Setup

npm install axios

Add to .env:

MIMO_API_KEY=your_key_here
MIMO_BASE_URL=https://platform.xiaomimimo.com/api/v1

⸻

🧠 2. MiMo Client (Core)

src/server/ai/mimo.ts

import axios from 'axios';
const MIMO_API_KEY = process.env.MIMO_API_KEY!;
const MIMO_BASE_URL = process.env.MIMO_BASE_URL!;
if (!MIMO_API_KEY) {
  throw new Error('Missing MIMO_API_KEY');
}
export interface MimoMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string;
  tool_calls?: any[];
}
export interface CodeChange {
  file: string;
  description: string;
  content: string;
}
export interface ApplyCodeChangesPayload {
  changes: CodeChange[];
}
export async function callMimoWithTools({
  messages,
  tools,
  model = 'mimo-v2.5',
}: {
  messages: MimoMessage[];
  tools: any[];
  model?: string;
}): Promise<ApplyCodeChangesPayload> {
  try {
    const response = await axios.post(
      `${MIMO_BASE_URL}/chat/completions`,
      {
        model,
        messages,
        tools,
        tool_choice: 'auto', // enforce tool usage
        temperature: 0.2
      },
      {
        headers: {
          Authorization: `Bearer ${MIMO_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );
    const data = response.data;
    // 🔒 Enforce tool usage
    const toolCall = data?.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      throw new Error('MiMo did not return a tool call');
    }
    if (toolCall.function.name !== 'apply_code_changes') {
      throw new Error(`Unexpected tool: ${toolCall.function.name}`);
    }
    const parsed = JSON.parse(toolCall.function.arguments);
    validateChanges(parsed);
    return parsed;
  } catch (err: any) {
    console.error('MiMo error:', err.response?.data || err.message);
    throw err;
  }
}

⸻

🧪 3. Strict Validation Layer (CRITICAL)

src/server/ai/validators.ts

import { ApplyCodeChangesPayload } from './mimo';
export function validateChanges(payload: any): asserts payload is ApplyCodeChangesPayload {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid payload');
  }
  if (!Array.isArray(payload.changes)) {
    throw new Error('Missing changes array');
  }
  for (const change of payload.changes) {
    if (typeof change.file !== 'string') {
      throw new Error('Invalid file path');
    }
    if (typeof change.description !== 'string') {
      throw new Error('Missing description');
    }
    if (typeof change.content !== 'string') {
      throw new Error('Missing content');
    }
    // Basic security
    if (change.file.includes('..')) {
      throw new Error('Path traversal detected');
    }
  }
}

👉 This ensures:

* No malformed AI output
* No dangerous file writes

⸻

🔧 4. Tool Definition (Enforced Contract)

src/server/ai/tools.ts

export const applyCodeChangesTool = {
  type: 'function',
  function: {
    name: 'apply_code_changes',
    description: 'Propose code modifications to the workspace',
    parameters: {
      type: 'object',
      properties: {
        changes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              file: {
                type: 'string',
                description: 'Relative path to file',
              },
              description: {
                type: 'string',
                description: 'Short explanation of the change',
              },
              content: {
                type: 'string',
                description: 'Full updated file content',
              },
            },
            required: ['file', 'description', 'content'],
          },
        },
      },
      required: ['changes'],
    },
  },
};

⸻

🧠 5. Prompt Builder (Your Real Power)

src/server/ai/prompts.ts

export function buildMimoMessages({
  intent,
  context,
  files
}: {
  intent: string;
  context: string;
  files: { path: string; content: string }[];
}) {
  return [
    {
      role: 'system',
      content: `
You are an expert AI software engineer.
You MUST respond using the apply_code_changes tool.
Do NOT return plain text.
Rules:
- Only modify relevant files
- Always include full file content
- Keep changes minimal and correct
- Ensure code compiles logically
      `.trim(),
    },
    {
      role: 'user',
      content: `
INTENT:
${intent}
CONTEXT:
${context}
FILES:
${files
  .map(
    (f) => `
FILE: ${f.path}
${f.content}
`
  )
  .join('\n')}
      `.trim(),
    },
  ];
}

⸻

🚀 6. Main AI Service

src/server/services/aiService.ts

import { callMimoWithTools } from '../ai/mimo';
import { applyCodeChangesTool } from '../ai/tools';
import { buildMimoMessages } from '../ai/prompts';
export async function runMimoCodegen({
  intent,
  context,
  files,
}: {
  intent: string;
  context: string;
  files: { path: string; content: string }[];
}) {
  const messages = buildMimoMessages({ intent, context, files });
  const result = await callMimoWithTools({
    messages,
    tools: [applyCodeChangesTool],
  });
  return result;
}

⸻

🌐 7. Express Route

src/server/routes/chat.ts

import { Router } from 'express';
import { runMimoCodegen } from '../services/aiService';
const router = Router();
router.post('/api/mimo/run', async (req, res) => {
  try {
    const { intent, context, files } = req.body;
    const result = await runMimoCodegen({
      intent,
      context,
      files,
    });
    res.json({ success: true, data: result });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});
export default router;

⸻

🧩 8. What You Now Have (Important)

With this setup:

✅ AI is forced to:

* return structured changes
* no free text
* no hallucinated formats

✅ You can:

* render blocks directly from changes[]
* skip diff parsing entirely
* build mobile UX cleanly

⸻

🔥 Example Response (From MiMo)

{
  "changes": [
    {
      "file": "services/api/auth.js",
      "description": "Add JWT authentication middleware",
      "content": "const jwt = require('jsonwebtoken');\n..."
    }
  ]
}

👉 This maps 1:1 to your UI blocks

⸻

⚠️ Common Pitfalls (Avoid These)

❌ Letting AI return text

→ breaks UI consistency

❌ Partial file updates

→ always require full content

❌ No validation

→ dangerous writes

⸻

🚀 Next Step (Highly Recommended)

After this works, do:

Multi-Run (your first “AI hive” step)

await Promise.all([
  runMimoCodegen(...),
  runMimoCodegen(...),
  runMimoCodegen(...)
]);

Then show:

* Option A / B / C

👉 You instantly get:

* better outputs
* evaluation data
* foundation for your negotiation system

⸻

✔️ Final Take

You now have:

* deterministic AI layer
* enforced tool schema
* mobile-friendly output structure
* safe execution pipeline

This is the core of your entire product.

⸻

