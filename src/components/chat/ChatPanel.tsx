/**
 * ChatPanel.tsx — Block-based AI interaction panel
 *
 * Features:
 * - Provider/tier selector (collapsible)
 * - Live activity feed (what MiMo is doing)
 * - Token usage display
 * - Accept/Reject per block
 * - Clear error messages
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Send, Loader2, Check, X, FileCode, AlertCircle,
  ChevronDown, ChevronRight, Settings, Zap, Brain,
  Activity, Coins, ChevronUp, RotateCcw,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { requestChanges, ValidationError } from '../../ai/aiService';
import type { CodeChange } from '../../ai/validators';
import type { Provider, ModelTier } from '../../ai/providers';

// ─── Types ────────────────────────────────────────────────────────────────────

type BlockStatus = 'pending' | 'accepted' | 'rejected';

interface ChangeBlock {
  id: string;
  change: CodeChange;
  status: BlockStatus;
  isExpanded: boolean;
}

export interface ActivityEvent {
  id: string;
  type: 'thinking' | 'reading' | 'writing' | 'tool_call' | 'error' | 'info';
  message: string;
  timestamp: number;
}

interface TokenUsage {
  input: number;
  output: number;
  total: number;
}

interface ConversationTurn {
  id: string;
  intent: string;
  blocks: ChangeBlock[];
  error: string | null;
  timestamp: number;
  activity: ActivityEvent[];
  tokenUsage: TokenUsage | null;
  provider: Provider;
  tier: ModelTier;
  model: string;
  duration: number | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PROVIDER_LABELS: Record<Provider, string> = {
  mimo: 'MiMo',
  openai: 'OpenAI',
};

const TIER_LABELS: Record<ModelTier, { label: string; desc: string; icon: React.ReactNode }> = {
  smart: { label: 'Smart',  desc: 'Best reasoning & tool calls', icon: <Brain className="w-3 h-3" /> },
  fast:  { label: 'Fast',   desc: 'Faster, 1M context',          icon: <Zap className="w-3 h-3" /> },
  cheap: { label: 'Cheap',  desc: 'Lowest cost',                  icon: <Coins className="w-3 h-3" /> },
};

const ACTIVITY_ICONS: Record<ActivityEvent['type'], string> = {
  thinking:  '🧠',
  reading:   '📖',
  writing:   '✏️',
  tool_call: '🔧',
  error:     '❌',
  info:      '💬',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function snippetOf(content: string, lines = 8): string {
  return content.split('\n').slice(0, lines).join('\n');
}

function fileExt(filePath: string): string {
  return filePath.split('.').pop() ?? 'txt';
}

function formatTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function formatDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

// ─── Activity Feed ────────────────────────────────────────────────────────────

function ActivityFeed({ events, isLive }: { events: ActivityEvent[]; isLive: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [events]);

  if (events.length === 0 && !isLive) return null;

  return (
    <div className="mx-10 mb-2 rounded-lg border border-mimo-border bg-black/40 overflow-hidden">
      <div className="px-3 py-1.5 border-b border-mimo-border flex items-center gap-2">
        <Activity className="w-3 h-3 text-mimo-accent" />
        <span className="text-[8px] font-mono uppercase tracking-widest text-mimo-text-muted">Activity</span>
        {isLive && (
          <span className="ml-auto flex items-center gap-1 text-[8px] font-mono text-green-400">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            Live
          </span>
        )}
      </div>
      <div ref={ref} className="max-h-40 overflow-y-auto p-2 space-y-1">
        {events.map((e) => (
          <div key={e.id} className="flex items-start gap-2 text-[10px] font-mono">
            <span className="shrink-0 mt-0.5">{ACTIVITY_ICONS[e.type]}</span>
            <span className={`leading-relaxed ${e.type === 'error' ? 'text-red-400' : 'text-mimo-text-muted'}`}>
              {e.message}
            </span>
          </div>
        ))}
        {isLive && events.length === 0 && (
          <div className="flex items-center gap-2 text-[10px] font-mono text-mimo-text-muted">
            <Loader2 className="w-3 h-3 animate-spin text-mimo-accent" />
            Connecting to MiMo…
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Token Badge ──────────────────────────────────────────────────────────────

function TokenBadge({ usage, duration, model }: { usage: TokenUsage; duration: number | null; model: string }) {
  return (
    <div className="mx-10 mb-3 flex flex-wrap items-center gap-2">
      <span className="text-[8px] font-mono text-mimo-text-muted/60 px-2 py-0.5 rounded border border-mimo-border/40">
        {model}
      </span>
      <span className="text-[8px] font-mono text-mimo-text-muted/60 px-2 py-0.5 rounded border border-mimo-border/40">
        ↑ {formatTokens(usage.input)} in
      </span>
      <span className="text-[8px] font-mono text-mimo-text-muted/60 px-2 py-0.5 rounded border border-mimo-border/40">
        ↓ {formatTokens(usage.output)} out
      </span>
      {duration && (
        <span className="text-[8px] font-mono text-mimo-text-muted/60 px-2 py-0.5 rounded border border-mimo-border/40">
          ⏱ {formatDuration(duration)}
        </span>
      )}
    </div>
  );
}

// ─── ChangeCard ───────────────────────────────────────────────────────────────

function ChangeCard({
  block, onAccept, onReject, onToggle, isApplying,
}: {
  block: ChangeBlock;
  onAccept: () => void;
  onReject: () => void;
  onToggle: () => void;
  isApplying: boolean;
}) {
  const isPending  = block.status === 'pending';
  const isAccepted = block.status === 'accepted';
  const isRejected = block.status === 'rejected';

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-xl border overflow-hidden transition-colors ${
        isAccepted ? 'border-green-500/40 bg-green-500/5'
        : isRejected ? 'border-red-500/20 bg-red-500/5 opacity-50'
        : 'border-mimo-border bg-mimo-panel'
      }`}
    >
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.02] transition-colors"
      >
        <FileCode className="w-4 h-4 text-mimo-accent shrink-0" />
        <span className="text-[11px] font-mono text-mimo-accent truncate flex-1">{block.change.file}</span>
        {isAccepted && <Check className="w-4 h-4 text-green-500 shrink-0" />}
        {isRejected && <X className="w-4 h-4 text-red-500/60 shrink-0" />}
        {isPending && (block.isExpanded
          ? <ChevronDown className="w-4 h-4 text-mimo-text-muted shrink-0" />
          : <ChevronRight className="w-4 h-4 text-mimo-text-muted shrink-0" />
        )}
      </button>

      <div className="px-4 pb-2">
        <p className="text-xs text-mimo-text-muted leading-relaxed">{block.change.description}</p>
      </div>

      <AnimatePresence>
        {block.isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="mx-4 mb-3 rounded-lg bg-black/60 border border-mimo-border overflow-hidden">
              <div className="px-3 py-1.5 border-b border-mimo-border">
                <span className="text-[8px] font-mono text-mimo-text-muted uppercase tracking-widest">
                  Preview · {fileExt(block.change.file)} · {block.change.content.split('\n').length} lines
                </span>
              </div>
              <pre className="p-3 text-[10px] font-mono text-mimo-text leading-relaxed overflow-x-auto max-h-56">
                {snippetOf(block.change.content)}
                {block.change.content.split('\n').length > 8 && (
                  <span className="text-mimo-text-muted">
                    {'\n'}… {block.change.content.split('\n').length - 8} more lines
                  </span>
                )}
              </pre>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {isPending && (
        <div className="flex gap-3 px-4 pb-4">
          <button
            onClick={onAccept}
            disabled={isApplying}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-mimo-accent text-mimo-bg rounded-lg text-[10px] font-bold uppercase tracking-widest hover:opacity-90 active:scale-95 transition-all disabled:opacity-40"
          >
            {isApplying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
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

// ─── Provider/Tier Selector ───────────────────────────────────────────────────

function ModelSelector({
  provider, tier, onProviderChange, onTierChange,
}: {
  provider: Provider;
  tier: ModelTier;
  onProviderChange: (p: Provider) => void;
  onTierChange: (t: ModelTier) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-b border-mimo-border">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-5 py-3 hover:bg-white/[0.02] transition-colors"
      >
        <Settings className="w-3.5 h-3.5 text-mimo-text-muted" />
        <span className="text-[9px] font-mono uppercase tracking-widest text-mimo-text-muted flex-1 text-left">
          {PROVIDER_LABELS[provider]} · {TIER_LABELS[tier].label}
        </span>
        {open ? <ChevronUp className="w-3.5 h-3.5 text-mimo-text-muted" /> : <ChevronDown className="w-3.5 h-3.5 text-mimo-text-muted" />}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-4 space-y-4">
              {/* Provider */}
              <div>
                <p className="text-[8px] font-mono uppercase tracking-widest text-mimo-text-muted mb-2">Provider</p>
                <div className="flex gap-2">
                  {(['mimo', 'openai'] as Provider[]).map((p) => (
                    <button
                      key={p}
                      onClick={() => onProviderChange(p)}
                      className={`px-3 py-1.5 rounded-lg text-[10px] font-mono border transition-all ${
                        provider === p
                          ? 'bg-mimo-accent text-mimo-bg border-mimo-accent'
                          : 'border-mimo-border text-mimo-text-muted hover:border-mimo-accent/50'
                      }`}
                    >
                      {PROVIDER_LABELS[p]}
                    </button>
                  ))}
                </div>
              </div>

              {/* Tier */}
              <div>
                <p className="text-[8px] font-mono uppercase tracking-widest text-mimo-text-muted mb-2">Model Tier</p>
                <div className="flex gap-2 flex-wrap">
                  {(['smart', 'fast', 'cheap'] as ModelTier[]).map((t) => (
                    <button
                      key={t}
                      onClick={() => onTierChange(t)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-mono border transition-all ${
                        tier === t
                          ? 'bg-mimo-accent text-mimo-bg border-mimo-accent'
                          : 'border-mimo-border text-mimo-text-muted hover:border-mimo-accent/50'
                      }`}
                    >
                      {TIER_LABELS[t].icon}
                      {TIER_LABELS[t].label}
                    </button>
                  ))}
                </div>
                <p className="text-[8px] font-mono text-mimo-text-muted/60 mt-2">
                  {TIER_LABELS[tier].desc}
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

export function ChatPanel({
  projectId,
}: {
  projectId: string;
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
  const [provider, setProvider] = useState<Provider>('mimo');
  const [tier, setTier] = useState<ModelTier>('smart');
  const [liveActivity, setLiveActivity] = useState<ActivityEvent[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [turns, isLoading, liveActivity]);

  // ── Auto-send when explanationRequest arrives from FilesPanel ──────────────
  useEffect(() => {
    if (!explanationRequest) return;
    const { path, content: fileContent } = explanationRequest;

    // Build a concrete intent based on what triggered this
    let intent: string;
    if (path && fileContent?.startsWith('Review these files:')) {
      // onReview call — audit multiple files
      intent = fileContent; // already formatted as "Review these files: path1 path2"
    } else if (path) {
      // onExplain call — explain a single file
      intent = `Explain what ${path} does, its purpose, and how it fits into the overall architecture.`;
    } else {
      intent = fileContent ?? '';
    }

    if (intent.trim()) {
      handleSend(intent);
      onExplanated?.();
    }
  }, [explanationRequest]);

  const addActivity = (type: ActivityEvent['type'], message: string) => {
    const event: ActivityEvent = { id: crypto.randomUUID(), type, message, timestamp: Date.now() };
    setLiveActivity((prev) => [...prev, event]);
    return event;
  };

  // ── Send intent ─────────────────────────────────────────────────────────────
  const handleSend = async (overrideIntent?: string) => {
    const intent = overrideIntent ?? input;
    if (!intent.trim() || isLoading) return;
    setInput('');
    setIsLoading(true);
    setLiveActivity([]);

    const turnId = crypto.randomUUID();
    const startTime = Date.now();

    setTurns((prev) => [...prev, {
      id: turnId, intent, blocks: [], error: null,
      timestamp: Date.now(), activity: [], tokenUsage: null,
      provider, tier, model: '', duration: null,
    }]);

    addActivity('info', `Starting with ${PROVIDER_LABELS[provider]} (${TIER_LABELS[tier].label})`);
    addActivity('reading', 'Loading workspace context (WORKSPACE.md, CONTEXT.md)…');

    try {
      addActivity('thinking', 'Sending intent to MiMo — waiting for tool call…');

      const result = await requestChanges({
        projectId, intent, provider, tier,
        onActivity: (type, message) => addActivity(type, message),
      });

      const duration = Date.now() - startTime;
      const { changes, tokenUsage, model: usedModel, expandedIntent } = result;
      if (expandedIntent) {
        addActivity('info', `🔄 Interpreted as: "${expandedIntent.slice(0, 120)}${expandedIntent.length > 120 ? '…' : ''}"`);
      }

      addActivity('info', `Got ${changes.length} change${changes.length !== 1 ? 's' : ''} in ${formatDuration(duration)}`);

      const blocks: ChangeBlock[] = changes.map((change) => ({
        id: crypto.randomUUID(), change, status: 'pending', isExpanded: false,
      }));

      const finalActivity = [...liveActivity];

      setTurns((prev) => prev.map((t) =>
        t.id !== turnId ? t : {
          ...t, blocks,
          activity: finalActivity,
          tokenUsage: tokenUsage ?? null,
          model: usedModel ?? '',
          duration,
        }
      ));
    } catch (err) {
      const duration = Date.now() - startTime;
      let message = 'Unknown error';

      if (err instanceof ValidationError) {
        message = err.message;
        addActivity('error', message);
        // Helpful hint for the "did not call tool" case
        if (message.includes('did not call apply_code_changes')) {
          addActivity('info', 'Tip: Try being more specific. Instead of "improve architecture", try "extract the API calls in App.tsx into a separate service file".');
        }
      } else if (err instanceof Error) {
        message = err.message;
        addActivity('error', message);
      }

      const finalActivity = [...liveActivity];
      setTurns((prev) => prev.map((t) =>
        t.id !== turnId ? t : { ...t, error: message, activity: finalActivity, duration }
      ));
    } finally {
      setIsLoading(false);
      setLiveActivity([]);
    }
  };

  const toggleBlock = (turnId: string, blockId: string) => {
    setTurns((prev) => prev.map((t) =>
      t.id !== turnId ? t : {
        ...t,
        blocks: t.blocks.map((b) =>
          b.id === blockId ? { ...b, isExpanded: !b.isExpanded } : b
        ),
      }
    ));
  };

  const handleAccept = async (turnId: string, block: ChangeBlock) => {
    setApplyingBlockId(block.id);
    try {
      const res = await fetch('/api/tools/write_file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, path: block.change.file, content: block.change.content }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? 'Write failed');
      }
      setTurns((prev) => prev.map((t) =>
        t.id !== turnId ? t : {
          ...t,
          blocks: t.blocks.map((b) =>
            b.id === block.id ? { ...b, status: 'accepted', isExpanded: false } : b
          ),
        }
      ));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Write failed';
      setTurns((prev) => prev.map((t) =>
        t.id !== turnId ? t : { ...t, error: `Failed to write ${block.change.file}: ${msg}` }
      ));
    } finally {
      setApplyingBlockId(null);
    }
  };

  const handleAcceptAll = async (turnId: string) => {
    const turn = turns.find((t) => t.id === turnId);
    if (!turn) return;
    for (const block of turn.blocks.filter((b) => b.status === 'pending')) {
      await handleAccept(turnId, block);
    }
  };

  const handleReject = (turnId: string, blockId: string) => {
    setTurns((prev) => prev.map((t) =>
      t.id !== turnId ? t : {
        ...t,
        blocks: t.blocks.map((b) =>
          b.id === blockId ? { ...b, status: 'rejected', isExpanded: false } : b
        ),
      }
    ));
  };

  const handleRetry = (turn: ConversationTurn) => {
    handleSend(turn.intent);
  };

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-mimo-bg">
      {/* Scroll area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-5 space-y-8">
        {turns.length === 0 && !isLoading && (
          <div className="h-full flex flex-col items-center justify-center text-center px-12 opacity-30 pt-20">
            <div className="w-12 h-12 rounded-full border border-mimo-accent flex items-center justify-center mb-6">
              <div className="w-2 h-2 bg-mimo-accent rounded-full animate-pulse" />
            </div>
            <h3 className="font-serif italic text-2xl mb-2">bldr</h3>
            <p className="text-[10px] font-mono tracking-widest uppercase">MiMo-Powered · Block Execution</p>
            <p className="text-[9px] font-mono mt-3 opacity-60">
              Be specific: "extract API calls in App.tsx into a service file"<br />
              works better than "improve architecture"
            </p>
          </div>
        )}

        {turns.map((turn) => (
          <div key={turn.id} className="space-y-3">
            {/* User intent */}
            <div className="flex flex-row-reverse gap-3">
              <div className="w-7 h-7 rounded bg-mimo-panel border border-mimo-border shrink-0" />
              <div className="space-y-1 max-w-[85%]">
                <div className="text-[9px] font-mono font-bold uppercase tracking-widest opacity-40 text-right">You</div>
                <div className="text-sm leading-relaxed text-mimo-text-muted text-right">{turn.intent}</div>
              </div>
            </div>

            {/* Activity feed (collapsed once done) */}
            {turn.activity.length > 0 && (
              <ActivityFeed events={turn.activity} isLive={false} />
            )}

            {/* Token usage */}
            {turn.tokenUsage && (
              <TokenBadge usage={turn.tokenUsage} duration={turn.duration} model={turn.model} />
            )}

            {/* Error */}
            {turn.error && (
              <div className="mx-0 space-y-2">
                <div className="flex items-start gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/30">
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-red-400 leading-relaxed flex-1">{turn.error}</p>
                </div>
                <div className="ml-10">
                  <button
                    onClick={() => handleRetry(turn)}
                    disabled={isLoading}
                    className="flex items-center gap-2 text-[10px] font-mono text-mimo-text-muted hover:text-mimo-accent transition-colors disabled:opacity-40"
                  >
                    <RotateCcw className="w-3 h-3" />
                    Retry
                  </button>
                </div>
              </div>
            )}

            {/* Change blocks */}
            {turn.blocks.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-3 ml-1">
                  <div className="w-7 h-7 rounded bg-mimo-bg border border-mimo-accent flex items-center justify-center shrink-0">
                    <div className="w-1.5 h-1.5 bg-mimo-accent rounded-full" />
                  </div>
                  <div className="flex-1 space-y-0.5">
                    <div className="text-[9px] font-mono font-bold uppercase tracking-widest opacity-40">bldr</div>
                    <div className="text-[10px] font-mono text-mimo-text-muted">
                      {turn.blocks.length} change{turn.blocks.length !== 1 ? 's' : ''} ready
                    </div>
                  </div>
                  {turn.blocks.some((b) => b.status === 'pending') && (
                    <button
                      onClick={() => handleAcceptAll(turn.id)}
                      disabled={!!applyingBlockId}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-green-500/20 border border-green-500/40 text-green-400 rounded-lg text-[9px] font-mono hover:bg-green-500/30 transition-all disabled:opacity-40"
                    >
                      <Check className="w-3 h-3" />
                      All
                    </button>
                  )}
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

            {/* Loading blocks for this turn */}
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

        {/* Live activity during loading */}
        {isLoading && liveActivity.length > 0 && (
          <ActivityFeed events={liveActivity} isLive={true} />
        )}

        {isLoading && turns.length === 0 && (
          <div className="flex items-center gap-3 mt-8">
            <Loader2 className="w-4 h-4 text-mimo-accent animate-spin" />
            <span className="text-[10px] font-mono text-mimo-text-muted animate-pulse">
              MiMo generating changes…
            </span>
          </div>
        )}
      </div>

      {/* Bottom controls */}
      <div className="border-t border-mimo-border bg-mimo-panel">
        <ModelSelector
          provider={provider}
          tier={tier}
          onProviderChange={setProvider}
          onTierChange={setTier}
        />

        <div className="p-5">
          <div className="relative">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
              }}
              placeholder='e.g. "extract the fetch calls in App.tsx into src/api/projects.ts"'
              className="w-full bg-mimo-bg border border-mimo-border rounded-xl p-4 pr-14 text-sm focus:outline-none focus:border-mimo-accent transition-all resize-none min-h-[90px] text-mimo-text placeholder:text-white/10"
            />
            <button
              onClick={() => handleSend()}
              disabled={!input.trim() || isLoading}
              className="absolute bottom-4 right-4 w-10 h-10 bg-mimo-accent text-mimo-bg rounded-lg flex items-center justify-center hover:opacity-90 active:scale-95 transition-all disabled:opacity-30"
            >
              {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
