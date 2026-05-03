/**
 * ChatPanel.tsx — Block-based AI interaction panel
 *
 * The full loop:
 *   Intent (text input)
 *     → aiService.requestChanges()   [MiMo structured tool call]
 *     → ParsedChanges (changes[])
 *     → ChangeBlockList               [Accept / Reject per block]
 *     → writeFile on Accept
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Send,
  Loader2,
  Check,
  X,
  FileCode,
  AlertCircle,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { requestChanges, ValidationError } from '../../ai/aiService';
import type { CodeChange } from '../../ai/validators';

// ─── Types ────────────────────────────────────────────────────────────────────

type BlockStatus = 'pending' | 'accepted' | 'rejected';

interface ChangeBlock {
  id: string;
  change: CodeChange;
  status: BlockStatus;
  isExpanded: boolean;
}

interface ConversationTurn {
  id: string;
  intent: string;
  blocks: ChangeBlock[];
  error: string | null;
  timestamp: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function snippetOf(content: string, lines = 6): string {
  return content.split('\n').slice(0, lines).join('\n');
}

function fileExt(filePath: string): string {
  return filePath.split('.').pop() ?? 'txt';
}

// ─── ChangeCard ───────────────────────────────────────────────────────────────

function ChangeCard({
  block,
  onAccept,
  onReject,
  onToggle,
  isApplying,
}: {
  block: ChangeBlock;
  onAccept: () => void;
  onReject: () => void;
  onToggle: () => void;
  isApplying: boolean;
}) {
  const isPending = block.status === 'pending';
  const isAccepted = block.status === 'accepted';
  const isRejected = block.status === 'rejected';

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-xl border transition-colors overflow-hidden ${
        isAccepted
          ? 'border-green-500/40 bg-green-500/5'
          : isRejected
          ? 'border-red-500/20 bg-red-500/5 opacity-50'
          : 'border-mimo-border bg-mimo-panel'
      }`}
    >
      {/* Header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.02] transition-colors"
      >
        <FileCode className="w-4 h-4 text-mimo-accent shrink-0" />
        <span className="text-[11px] font-mono text-mimo-accent truncate flex-1">
          {block.change.file}
        </span>
        {isAccepted && <Check className="w-4 h-4 text-green-500 shrink-0" />}
        {isRejected && <X className="w-4 h-4 text-red-500/60 shrink-0" />}
        {isPending &&
          (block.isExpanded ? (
            <ChevronDown className="w-4 h-4 text-mimo-text-muted shrink-0" />
          ) : (
            <ChevronRight className="w-4 h-4 text-mimo-text-muted shrink-0" />
          ))}
      </button>

      {/* Description */}
      <div className="px-4 pb-2">
        <p className="text-xs text-mimo-text-muted leading-relaxed">
          {block.change.description}
        </p>
      </div>

      {/* Preview snippet */}
      <AnimatePresence>
        {block.isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="mx-4 mb-3 rounded-lg bg-black/60 border border-mimo-border overflow-hidden">
              <div className="px-3 py-1.5 border-b border-mimo-border flex items-center gap-2">
                <span className="text-[8px] font-mono text-mimo-text-muted uppercase tracking-widest">
                  Preview · {fileExt(block.change.file)}
                </span>
              </div>
              <pre className="p-3 text-[10px] font-mono text-mimo-text leading-relaxed overflow-x-auto max-h-48">
                {snippetOf(block.change.content)}
                {block.change.content.split('\n').length > 6 && (
                  <span className="text-mimo-text-muted">
                    {'\n'}… {block.change.content.split('\n').length - 6} more lines
                  </span>
                )}
              </pre>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Actions — only for pending blocks */}
      {isPending && (
        <div className="flex gap-3 px-4 pb-4">
          <button
            onClick={onAccept}
            disabled={isApplying}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-mimo-accent text-mimo-bg rounded-lg text-[10px] font-bold uppercase tracking-widest hover:opacity-90 active:scale-95 transition-all disabled:opacity-40"
          >
            {isApplying ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Check className="w-3.5 h-3.5" />
            )}
            Accept
          </button>
          <button
            onClick={onReject}
            disabled={isApplying}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 border border-red-500/40 text-red-400 rounded-lg text-[10px] font-bold uppercase tracking-widest hover:bg-red-500/10 active:scale-95 transition-all disabled:opacity-40"
          >
            <X className="w-3.5 h-3.5" />
            Reject
          </button>
        </div>
      )}
    </motion.div>
  );
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

export function ChatPanel({
  projectId,
}: {
  projectId: string;
  // Kept for App.tsx prop compatibility — unused in the new model
  messages?: unknown;
  setMessages?: unknown;
  planningMode?: boolean;
  setPlanningMode?: (v: boolean) => void;
  explanationRequest?: { path: string; content: string } | null;
  onExplanated?: () => void;
  terminalOutput?: string[];
  setTerminalOutput?: React.Dispatch<React.SetStateAction<string[]>>;
}) {
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [turns, setTurns] = useState<ConversationTurn[]>([]);
  const [applyingBlockId, setApplyingBlockId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [turns, isLoading]);

  // ── Send intent to MiMo ─────────────────────────────────────────────────────
  const handleSend = async (overrideIntent?: string) => {
    const intent = overrideIntent ?? input;
    if (!intent.trim() || isLoading) return;
    setInput('');
    setIsLoading(true);

    const turnId = crypto.randomUUID();

    setTurns((prev) => [
      ...prev,
      { id: turnId, intent, blocks: [], error: null, timestamp: Date.now() },
    ]);

    try {
      const { changes } = await requestChanges({ projectId, intent });

      const blocks: ChangeBlock[] = changes.map((change) => ({
        id: crypto.randomUUID(),
        change,
        status: 'pending',
        isExpanded: false,
      }));

      setTurns((prev) =>
        prev.map((t) => (t.id === turnId ? { ...t, blocks } : t))
      );
    } catch (err) {
      const message =
        err instanceof ValidationError
          ? `Validation error: ${err.message}`
          : err instanceof Error
          ? err.message
          : 'Unknown error';

      setTurns((prev) =>
        prev.map((t) => (t.id === turnId ? { ...t, error: message } : t))
      );
    } finally {
      setIsLoading(false);
    }
  };

  // ── Block toggle (expand/collapse preview) ──────────────────────────────────
  const toggleBlock = (turnId: string, blockId: string) => {
    setTurns((prev) =>
      prev.map((t) =>
        t.id !== turnId
          ? t
          : {
              ...t,
              blocks: t.blocks.map((b) =>
                b.id === blockId ? { ...b, isExpanded: !b.isExpanded } : b
              ),
            }
      )
    );
  };

  // ── Accept: write the file, then mark as accepted ───────────────────────────
  const handleAccept = async (turnId: string, block: ChangeBlock) => {
    setApplyingBlockId(block.id);
    try {
      const res = await fetch('/api/tools/write_file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          path: block.change.file,
          content: block.change.content,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? 'Write failed');
      }

      setTurns((prev) =>
        prev.map((t) =>
          t.id !== turnId
            ? t
            : {
                ...t,
                blocks: t.blocks.map((b) =>
                  b.id === block.id
                    ? { ...b, status: 'accepted', isExpanded: false }
                    : b
                ),
              }
        )
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Write failed';
      setTurns((prev) =>
        prev.map((t) =>
          t.id !== turnId
            ? t
            : { ...t, error: `Failed to write ${block.change.file}: ${msg}` }
        )
      );
    } finally {
      setApplyingBlockId(null);
    }
  };

  // ── Reject: mark as rejected, no file write ─────────────────────────────────
  const handleReject = (turnId: string, blockId: string) => {
    setTurns((prev) =>
      prev.map((t) =>
        t.id !== turnId
          ? t
          : {
              ...t,
              blocks: t.blocks.map((b) =>
                b.id === blockId
                  ? { ...b, status: 'rejected', isExpanded: false }
                  : b
              ),
            }
      )
    );
  };

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-mimo-bg">
      {/* Conversation history */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-5 space-y-8">
        {turns.length === 0 && !isLoading && (
          <div className="h-full flex flex-col items-center justify-center text-center px-12 opacity-30 pt-20">
            <div className="w-12 h-12 rounded-full border border-mimo-accent flex items-center justify-center mb-6">
              <div className="w-2 h-2 bg-mimo-accent rounded-full animate-pulse" />
            </div>
            <h3 className="font-serif italic text-2xl mb-2">bldr</h3>
            <p className="text-[10px] font-mono tracking-widest uppercase">
              MiMo-Powered · Block Execution
            </p>
          </div>
        )}

        {turns.map((turn) => (
          <div key={turn.id} className="space-y-4">
            {/* User intent bubble */}
            <div className="flex flex-row-reverse gap-3">
              <div className="w-7 h-7 rounded bg-mimo-panel border border-mimo-border shrink-0" />
              <div className="space-y-1 max-w-[85%]">
                <div className="text-[9px] font-mono font-bold uppercase tracking-widest opacity-40 text-right">
                  You
                </div>
                <div className="text-sm leading-relaxed text-mimo-text-muted text-right">
                  {turn.intent}
                </div>
              </div>
            </div>

            {/* Error state */}
            {turn.error && (
              <div className="flex items-start gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/30">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <p className="text-xs text-red-400 leading-relaxed">{turn.error}</p>
              </div>
            )}

            {/* Change blocks */}
            {turn.blocks.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-3 ml-1">
                  <div className="w-7 h-7 rounded bg-mimo-bg border border-mimo-accent flex items-center justify-center shrink-0">
                    <div className="w-1.5 h-1.5 bg-mimo-accent rounded-full" />
                  </div>
                  <div className="space-y-0.5">
                    <div className="text-[9px] font-mono font-bold uppercase tracking-widest opacity-40">
                      bldr
                    </div>
                    <div className="text-[10px] font-mono text-mimo-text-muted">
                      {turn.blocks.length} change{turn.blocks.length !== 1 ? 's' : ''} ready
                    </div>
                  </div>
                </div>

                <div className="space-y-3 ml-10">
                  {turn.blocks.map((block) => (
                    <ChangeCard
                      key={block.id}
                      block={block}
                      isApplying={applyingBlockId === block.id}
                      onAccept={() => handleAccept(turn.id, block)}
                      onReject={() => handleReject(turn.id, block.id)}
                      onToggle={() => toggleBlock(turn.id, block.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Loading indicator for this turn's blocks */}
            {turn.blocks.length === 0 && !turn.error && isLoading && (
              <div className="flex items-center gap-3 ml-10">
                <Loader2 className="w-4 h-4 text-mimo-accent animate-spin" />
                <span className="text-[10px] font-mono text-mimo-text-muted animate-pulse">
                  MiMo generating changes…
                </span>
              </div>
            )}
          </div>
        ))}

        {isLoading && turns.length === 0 && (
          <div className="flex items-center gap-3 mt-8">
            <Loader2 className="w-4 h-4 text-mimo-accent animate-spin" />
            <span className="text-[10px] font-mono text-mimo-text-muted animate-pulse">
              MiMo generating changes…
            </span>
          </div>
        )}
      </div>

      {/* Intent input bar */}
      <div className="p-5 border-t border-mimo-border bg-mimo-panel">
        <div className="relative">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder='Describe what you want to change… e.g. "add JWT auth"'
            className="w-full bg-mimo-bg border border-mimo-border rounded-xl p-4 pr-14 text-sm focus:outline-none focus:border-mimo-accent transition-all resize-none min-h-[90px] text-mimo-text placeholder:text-white/10"
          />
          <button
            onClick={() => handleSend()}
            disabled={!input.trim() || isLoading}
            className="absolute bottom-4 right-4 w-10 h-10 bg-mimo-accent text-mimo-bg rounded-lg flex items-center justify-center hover:opacity-90 active:scale-95 transition-all disabled:opacity-30"
          >
            {isLoading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Send className="w-5 h-5" />
            )}
          </button>
        </div>
        <p className="text-[9px] font-mono text-mimo-text-muted mt-2 opacity-40 text-center uppercase tracking-widest">
          MiMo · Structured Execution · Accept or Reject each change
        </p>
      </div>
    </div>
  );
}
