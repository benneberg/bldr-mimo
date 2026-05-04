/**
 * ArchitecturePanel.tsx — stable, crash-free project overview
 *
 * Replaced D3 force simulation (crashes on "node not found: express")
 * with a clean text-based dependency and file structure view.
 * Mobile-friendly, no external graph lib needed.
 */

import React, { useState, useEffect } from 'react';
import {
  Layers, Loader2, FileCode, Package, AlertTriangle,
  ChevronDown, ChevronRight, RefreshCw, ArrowRight,
  GitBranch, Box,
} from 'lucide-react';

interface DepNode { id: string; group: string; }
interface DepLink { source: string; target: string; type: 'internal' | 'external'; }
interface DepData { nodes: DepNode[]; links: DepLink[]; }
interface FileEntry { path: string; size: number; repo_name?: string; }

export function ArchitecturePanel({ projectId }: { projectId: string }) {
  const [deps, setDeps] = useState<DepData | null>(null);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<'modules' | 'deps' | 'packages'>('modules');

  const load = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [depsRes, filesRes] = await Promise.all([
        fetch('/api/tools/analyze_dependencies', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId }),
        }),
        fetch(`/api/files/${projectId}`),
      ]);
      const [depsData, filesData] = await Promise.all([
        depsRes.json(),
        filesRes.json(),
      ]);
      setDeps(depsData);
      setFiles(Array.isArray(filesData) ? filesData : []);
    } catch (err: any) {
      setError(err.message ?? 'Failed to load');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { load(); }, [projectId]);

  return (
    <div className="flex flex-col h-full bg-mimo-bg text-mimo-text">
      {/* Header */}
      <div className="px-5 h-12 border-b border-mimo-border bg-mimo-panel flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <Layers className="w-3.5 h-3.5 text-mimo-accent" />
          <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-mimo-text-muted">
            Architecture
          </span>
        </div>
        <button
          onClick={load}
          disabled={isLoading}
          className="p-1.5 hover:bg-white/5 rounded-lg transition-colors disabled:opacity-40"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-mimo-text-muted ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-mimo-border shrink-0">
        {([
          { key: 'modules', label: 'Modules', icon: <Box className="w-3 h-3" /> },
          { key: 'deps',    label: 'Internal Deps', icon: <GitBranch className="w-3 h-3" /> },
          { key: 'packages', label: 'Packages', icon: <Package className="w-3 h-3" /> },
        ] as const).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveView(tab.key)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[9px] font-mono uppercase tracking-widest transition-colors ${
              activeView === tab.key
                ? 'text-mimo-accent border-b-2 border-mimo-accent'
                : 'text-mimo-text-muted hover:text-mimo-text'
            }`}
          >
            {tab.icon}{tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <div className="flex items-center justify-center h-full gap-3">
            <Loader2 className="w-5 h-5 animate-spin text-mimo-accent" />
            <span className="text-[11px] font-mono text-mimo-text-muted">Analysing…</span>
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center justify-center h-full gap-3 p-8 text-center">
            <AlertTriangle className="w-6 h-6 text-yellow-500" />
            <p className="text-xs font-mono text-red-400">{error}</p>
            <button onClick={load} className="text-[10px] font-mono text-mimo-accent border border-mimo-accent/40 px-4 py-2 rounded-lg hover:bg-mimo-accent/10 transition-colors">
              Retry
            </button>
          </div>
        )}

        {!isLoading && !error && activeView === 'modules' && (
          <ModulesView files={files} />
        )}

        {!isLoading && !error && activeView === 'deps' && deps && (
          <DepsView deps={deps} />
        )}

        {!isLoading && !error && activeView === 'packages' && deps && (
          <PackagesView deps={deps} />
        )}
      </div>
    </div>
  );
}

// ─── Modules view — grouped file tree ─────────────────────────────────────────
function ModulesView({ files }: { files: FileEntry[] }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Group by top-level directory
  const groups: Record<string, FileEntry[]> = {};
  for (const f of files) {
    const parts = f.path.split('/');
    const group = parts.length > 1 ? parts[0] : '(root)';
    if (!groups[group]) groups[group] = [];
    groups[group].push(f);
  }

  const toggle = (g: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      next.has(g) ? next.delete(g) : next.add(g);
      return next;
    });
  };

  const totalSize = files.reduce((s, f) => s + (f.size ?? 0), 0);

  return (
    <div className="p-4 space-y-2">
      <div className="flex items-center justify-between mb-4">
        <span className="text-[9px] font-mono text-mimo-text-muted uppercase tracking-widest">
          {files.length} files · {(totalSize / 1024).toFixed(0)} kb total
        </span>
      </div>

      {Object.entries(groups).sort().map(([group, groupFiles]) => {
        const isOpen = !collapsed.has(group);
        const groupSize = groupFiles.reduce((s, f) => s + (f.size ?? 0), 0);
        return (
          <div key={group} className="rounded-xl border border-mimo-border overflow-hidden">
            <button
              onClick={() => toggle(group)}
              className="w-full flex items-center gap-3 px-4 py-3 bg-mimo-panel hover:bg-white/[0.02] transition-colors"
            >
              {isOpen
                ? <ChevronDown className="w-3.5 h-3.5 text-mimo-accent shrink-0" />
                : <ChevronRight className="w-3.5 h-3.5 text-mimo-text-muted shrink-0" />
              }
              <span className="text-[11px] font-mono font-bold text-mimo-text flex-1 text-left">{group}/</span>
              <span className="text-[9px] font-mono text-mimo-text-muted">
                {groupFiles.length} files · {(groupSize / 1024).toFixed(0)}kb
              </span>
            </button>
            {isOpen && (
              <div className="divide-y divide-mimo-border/40">
                {groupFiles.sort((a, b) => a.path.localeCompare(b.path)).map((f) => {
                  const name = f.path.split('/').pop() ?? f.path;
                  const ext = name.split('.').pop() ?? '';
                  return (
                    <div key={f.path} className="flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.015]">
                      <FileCode className="w-3.5 h-3.5 text-mimo-text-muted/50 shrink-0" />
                      <span className="text-[10px] font-mono text-mimo-text-muted flex-1 truncate">{name}</span>
                      <span className="text-[8px] font-mono text-mimo-text-muted/40 uppercase">{ext}</span>
                      {f.size > 10000 && (
                        <span className="text-[8px] font-mono text-yellow-500/70">large</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Internal Deps view ───────────────────────────────────────────────────────
function DepsView({ deps }: { deps: DepData }) {
  const internalLinks = deps.links.filter(l => l.type === 'internal');

  // Build adjacency: source → [targets]
  const adj: Record<string, string[]> = {};
  for (const l of internalLinks) {
    const src = typeof l.source === 'object' ? (l.source as any).id : l.source;
    const tgt = typeof l.target === 'object' ? (l.target as any).id : l.target;
    if (!adj[src]) adj[src] = [];
    if (!adj[src].includes(tgt)) adj[src].push(tgt);
  }

  const entries = Object.entries(adj).sort(([, a], [, b]) => b.length - a.length);

  if (!entries.length) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 opacity-40 p-8 text-center">
        <GitBranch className="w-8 h-8 text-mimo-text-muted" />
        <p className="text-xs font-mono text-mimo-text-muted">No internal dependencies found</p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-3">
      <p className="text-[9px] font-mono text-mimo-text-muted uppercase tracking-widest mb-4">
        {entries.length} modules with internal imports
      </p>
      {entries.map(([src, targets]) => (
        <div key={src} className="rounded-xl border border-mimo-border overflow-hidden">
          <div className="px-4 py-2.5 bg-mimo-panel flex items-center gap-2">
            <FileCode className="w-3.5 h-3.5 text-mimo-accent shrink-0" />
            <span className="text-[10px] font-mono text-mimo-accent truncate flex-1">
              {src.split('/').pop()}
            </span>
            <span className="text-[9px] font-mono text-mimo-text-muted">
              {targets.length} dep{targets.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="px-4 py-2 space-y-1.5">
            {targets.map((t) => (
              <div key={t} className="flex items-center gap-2 text-[10px] font-mono text-mimo-text-muted">
                <ArrowRight className="w-3 h-3 text-mimo-text-muted/30 shrink-0" />
                <span className="truncate">{t.split('/').pop()}</span>
                <span className="text-[8px] opacity-40 truncate hidden sm:block">({t})</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── External packages view ───────────────────────────────────────────────────
function PackagesView({ deps }: { deps: DepData }) {
  const external = deps.links
    .filter(l => l.type === 'external')
    .map(l => typeof l.target === 'object' ? (l.target as any).id : l.target);

  // Count usage frequency
  const counts: Record<string, number> = {};
  for (const pkg of external) {
    const name = pkg.split('/')[0].replace(/^@[^/]+\//, '@$&');
    counts[name] = (counts[name] ?? 0) + 1;
  }

  const sorted = Object.entries(counts).sort(([, a], [, b]) => b - a);

  if (!sorted.length) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 opacity-40 p-8 text-center">
        <Package className="w-8 h-8 text-mimo-text-muted" />
        <p className="text-xs font-mono text-mimo-text-muted">No external packages detected</p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-2">
      <p className="text-[9px] font-mono text-mimo-text-muted uppercase tracking-widest mb-4">
        {sorted.length} unique packages
      </p>
      {sorted.map(([pkg, count]) => (
        <div
          key={pkg}
          className="flex items-center gap-3 px-4 py-3 rounded-xl border border-mimo-border bg-mimo-panel"
        >
          <Package className="w-3.5 h-3.5 text-blue-400 shrink-0" />
          <span className="text-[11px] font-mono text-mimo-text flex-1">{pkg}</span>
          <span className="text-[9px] font-mono text-mimo-text-muted">
            used in {count} file{count !== 1 ? 's' : ''}
          </span>
        </div>
      ))}
    </div>
  );
}
