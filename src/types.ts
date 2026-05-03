// ─── Core domain types ────────────────────────────────────────────────────────

export interface Project {
  id: string;
  name: string;
  githubUrl?: string;
  createdAt: number;
}

export interface FileEntry {
  path: string;
  size: number;
}

export interface TreeNode {
  name: string;
  path: string;
  size?: number;
  children?: Record<string, TreeNode>;
}

// ─── AI / Block execution types ───────────────────────────────────────────────

/**
 * A single file change produced by MiMo.
 * Mirrors the schema enforced by validators.ts.
 */
export interface CodeChange {
  file: string;
  description: string;
  content: string;
}

export type BlockStatus = 'pending' | 'accepted' | 'rejected';

export interface ChangeBlock {
  id: string;
  change: CodeChange;
  status: BlockStatus;
  isExpanded: boolean;
}

// ─── Legacy type kept for App.tsx compatibility ───────────────────────────────

/** @deprecated Use ConversationTurn in ChatPanel instead */
export interface Message {
  role: 'user' | 'model';
  parts: { text: string }[];
  activities?: { name: string; args: unknown }[];
}
