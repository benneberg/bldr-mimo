import React, { useState, useEffect, useRef } from 'react';
import {
  FolderCode, MessageSquare, Play, Database,
  ArrowLeft, Info, ChevronRight, Layers,
  Plus, Trash2, X, FolderPlus, Loader2,
  Github, AlertTriangle,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { io, Socket } from 'socket.io-client';
import { ArchitecturePanel } from './components/arch/ArchitecturePanel';
import { ChatPanel } from './components/chat/ChatPanel';
import { ImportPanel, TabButton } from './components/panels/Common';
import { FilesPanel } from './components/panels/FilesPanel';
import { InfoPanel } from './components/panels/InfoPanel';
import { Project, Message } from './types';

let socket: Socket;

// ─── Error Boundary for crash-prone panels ────────────────────────────────────
class PanelErrorBoundary extends React.Component<
  { children: React.ReactNode; label: string },
  { hasError: boolean; error: string }
> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: '' };
  }
  static getDerivedStateFromError(err: any) {
    return { hasError: true, error: err?.message ?? 'Unknown error' };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center">
          <AlertTriangle className="w-8 h-8 text-yellow-500" />
          <p className="text-sm font-mono text-mimo-text-muted">{this.props.label} failed to load</p>
          <p className="text-[10px] font-mono text-red-400/60">{this.state.error}</p>
          <button
            onClick={() => this.setState({ hasError: false, error: '' })}
            className="text-[10px] font-mono text-mimo-accent border border-mimo-accent/40 px-4 py-2 rounded-lg hover:bg-mimo-accent/10 transition-colors"
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Create Project Modal ─────────────────────────────────────────────────────
function CreateProjectModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (name: string, type: 'empty' | 'github', url?: string) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [type, setType] = useState<'empty' | 'github'>('empty');
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    if (!name.trim()) { setError('Project name is required'); return; }
    if (type === 'github' && !url.trim()) { setError('GitHub URL is required'); return; }
    setLoading(true);
    setError('');
    try {
      await onCreate(name.trim(), type, url.trim() || undefined);
      onClose();
    } catch (err: any) {
      setError(err.message ?? 'Failed to create project');
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 40, opacity: 0 }}
        className="w-full max-w-md bg-mimo-panel border border-mimo-border rounded-2xl overflow-hidden shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-mimo-border">
          <div>
            <h2 className="font-serif italic text-lg">New Project</h2>
            <p className="text-[9px] font-mono text-mimo-text-muted uppercase tracking-widest">Create workspace</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-lg transition-colors">
            <X className="w-4 h-4 text-mimo-text-muted" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5">
          {/* Name */}
          <div className="space-y-1.5">
            <label className="text-[9px] font-mono text-mimo-text-muted uppercase tracking-widest ml-1">
              Project Name
            </label>
            <input
              autoFocus
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
              placeholder="my-project"
              className="w-full px-4 py-3 bg-mimo-bg border border-mimo-border rounded-xl focus:outline-none focus:border-mimo-accent transition-all text-sm font-mono text-mimo-text"
            />
          </div>

          {/* Type selector */}
          <div className="space-y-1.5">
            <label className="text-[9px] font-mono text-mimo-text-muted uppercase tracking-widest ml-1">
              Source
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setType('empty')}
                className={`flex items-center gap-2 px-4 py-3 rounded-xl border text-sm transition-all ${
                  type === 'empty'
                    ? 'border-mimo-accent bg-mimo-accent/10 text-mimo-accent'
                    : 'border-mimo-border text-mimo-text-muted hover:border-mimo-accent/40'
                }`}
              >
                <FolderPlus className="w-4 h-4" />
                Empty
              </button>
              <button
                onClick={() => setType('github')}
                className={`flex items-center gap-2 px-4 py-3 rounded-xl border text-sm transition-all ${
                  type === 'github'
                    ? 'border-mimo-accent bg-mimo-accent/10 text-mimo-accent'
                    : 'border-mimo-border text-mimo-text-muted hover:border-mimo-accent/40'
                }`}
              >
                <Github className="w-4 h-4" />
                GitHub
              </button>
            </div>
          </div>

          {/* GitHub URL */}
          <AnimatePresence>
            {type === 'github' && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden space-y-1.5"
              >
                <label className="text-[9px] font-mono text-mimo-text-muted uppercase tracking-widest ml-1">
                  GitHub URL
                </label>
                <input
                  type="text"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://github.com/user/repo"
                  className="w-full px-4 py-3 bg-mimo-bg border border-mimo-border rounded-xl focus:outline-none focus:border-mimo-accent transition-all text-sm font-mono text-mimo-text"
                />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Error */}
          {error && (
            <p className="text-[11px] font-mono text-red-400 flex items-center gap-2">
              <AlertTriangle className="w-3 h-3 shrink-0" />
              {error}
            </p>
          )}

          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="w-full py-4 bg-mimo-accent text-mimo-bg rounded-xl font-bold uppercase text-xs tracking-widest hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            {loading ? (type === 'github' ? 'Importing…' : 'Creating…') : 'Create Project'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Delete Confirm Modal ─────────────────────────────────────────────────────
function DeleteConfirmModal({
  project,
  onClose,
  onConfirm,
}: {
  project: Project;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    setLoading(true);
    await onConfirm();
    setLoading(false);
    onClose();
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 40, opacity: 0 }}
        className="w-full max-w-sm bg-mimo-panel border border-red-500/30 rounded-2xl overflow-hidden shadow-2xl"
      >
        <div className="p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/30 flex items-center justify-center shrink-0">
              <Trash2 className="w-5 h-5 text-red-400" />
            </div>
            <div>
              <h3 className="font-serif italic text-base">Delete Project</h3>
              <p className="text-[10px] font-mono text-mimo-text-muted">This cannot be undone</p>
            </div>
          </div>
          <p className="text-sm text-mimo-text-muted leading-relaxed">
            Permanently delete <span className="text-mimo-text font-medium">{project.name}</span> and all its files?
          </p>
          <div className="flex gap-3 pt-2">
            <button
              onClick={onClose}
              className="flex-1 py-3 border border-mimo-border rounded-xl text-[11px] font-mono uppercase tracking-widest text-mimo-text-muted hover:border-mimo-accent/40 transition-all"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={loading}
              className="flex-1 py-3 bg-red-500 text-white rounded-xl text-[11px] font-mono uppercase tracking-widest hover:bg-red-600 active:scale-[0.98] transition-all disabled:opacity-40 flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
              Delete
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [activeTab, setActiveTab] = useState<'chat' | 'files' | 'preview' | 'arch'>('chat');
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [isInfoOpen, setIsInfoOpen] = useState(false);
  const [terminalOutput, setTerminalOutput] = useState<string[]>(['bldr Terminal v1.0.0', 'Ready...']);
  const [presenceCount, setPresenceCount] = useState(1);
  const [sandboxErrors, setSandboxErrors] = useState<any[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [healthStatus, setHealthStatus] = useState<{ status: 'healthy' | 'warning' | 'error'; issues: string[] }>({ status: 'healthy', issues: [] });
  const [command, setCommand] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [planningMode, setPlanningMode] = useState(false);
  const [explanationRequest, setExplanationRequest] = useState<{ path: string; content: string } | null>(null);
  const terminalRef = useRef<HTMLDivElement>(null);

  useEffect(() => { fetchProjects(); }, []);

  useEffect(() => {
    if (selectedProjectId) {
      if (!socket) socket = io();
      socket.emit('join_project', selectedProjectId);
      socket.on('presence_update', (count) => setPresenceCount(count));
      return () => { socket.off('presence_update'); };
    }
  }, [selectedProjectId]);

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [terminalOutput]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'SANDBOX_ERROR') {
        setSandboxErrors((prev) => [...prev, { ...event.data, timestamp: Date.now() }]);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const fetchProjects = async () => {
    try {
      const res = await fetch('/api/projects');
      const data = await res.json();
      setProjects(Array.isArray(data) ? data : []);
    } catch {
      setProjects([]);
    }
  };

  const handleCreateProject = async (name: string, type: 'empty' | 'github', url?: string) => {
    if (type === 'empty') {
      const res = await fetch('/api/projects/empty', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? 'Failed to create project');
      }
      const data = await res.json();
      await fetchProjects();
      setSelectedProjectId(data.id);
    } else {
      setIsImporting(true);
      try {
        const res = await fetch('/api/import/github', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, name }),
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error ?? 'Import failed');
        }
        const data = await res.json();
        await fetchProjects();
        setSelectedProjectId(data.id);
      } finally {
        setIsImporting(false);
      }
    }
  };

  const handleDeleteProject = async (project: Project) => {
    const res = await fetch(`/api/projects/${project.id}`, { method: 'DELETE' });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error ?? 'Delete failed');
    }
    await fetchProjects();
    if (selectedProjectId === project.id) setSelectedProjectId(null);
  };

  const handleRunCommand = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!command.trim() || !selectedProjectId) return;
    const cmdToRun = command;
    setCommand('');
    setTerminalOutput((prev) => [...prev, `> ${cmdToRun}`]);
    try {
      const res = await fetch('/api/tools/run_shell', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: selectedProjectId, command: cmdToRun }),
      });
      const data = await res.json();
      if (data.stdout) setTerminalOutput((prev) => [...prev, data.stdout]);
      if (data.stderr) setTerminalOutput((prev) => [...prev, `ERROR: ${data.stderr}`]);
    } catch {
      setTerminalOutput((prev) => [...prev, 'System: Command failed to execute']);
    }
  };

  const selectedProject = projects.find((p) => p.id === selectedProjectId);

  // ── Home screen ─────────────────────────────────────────────────────────────
  if (!selectedProjectId) {
    return (
      <>
        <div className="min-h-screen bg-mimo-bg flex flex-col items-center p-6 text-mimo-text">
          <header className="w-full max-w-md text-center mb-10 mt-12">
            <div className="w-16 h-16 bg-mimo-bg border border-mimo-accent rounded-full flex items-center justify-center mx-auto mb-4 shadow-[0_0_20px_rgba(242,125,38,0.2)]">
              <div className="w-4 h-4 bg-mimo-accent rounded-full animate-pulse" />
            </div>
            <h1 className="text-4xl font-serif italic tracking-tight mb-2">bldr</h1>
            <p className="text-mimo-text-muted text-sm font-mono uppercase tracking-widest">
              Architecture-First AI IDE
            </p>
          </header>

          <div className="w-full max-w-md space-y-4">
            {/* Create new project button */}
            <button
              onClick={() => setShowCreateModal(true)}
              className="w-full flex items-center gap-4 px-5 py-4 bg-mimo-accent text-mimo-bg rounded-xl hover:opacity-90 active:scale-[0.98] transition-all"
            >
              <div className="w-9 h-9 rounded-lg bg-black/20 flex items-center justify-center shrink-0">
                <Plus className="w-5 h-5" />
              </div>
              <div className="text-left">
                <div className="font-bold text-sm uppercase tracking-wider">New Project</div>
                <div className="text-[10px] opacity-70 font-mono">Empty workspace or GitHub import</div>
              </div>
            </button>

            {/* Existing projects */}
            {projects.length > 0 && (
              <div className="bg-mimo-panel rounded-xl shadow-2xl border border-mimo-border overflow-hidden">
                <div className="px-4 py-3 border-b border-mimo-border flex items-center gap-2 text-[10px] font-mono text-mimo-text-muted uppercase tracking-widest">
                  <Database className="w-3 h-3 text-mimo-accent" />
                  Saved Workspaces ({projects.length})
                </div>
                <div className="divide-y divide-mimo-border">
                  {projects.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center hover:bg-white/[0.02] transition-all group"
                    >
                      <button
                        onClick={() => setSelectedProjectId(p.id)}
                        className="flex-1 px-4 py-4 flex items-center justify-between text-left"
                      >
                        <div className="flex flex-col">
                          <span className="font-medium text-mimo-text">{p.name || 'Untitled Project'}</span>
                          <span className="text-[10px] font-mono text-mimo-text-muted">
                            {p.createdAt
                              ? new Date(p.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
                              : 'Unknown date'}
                          </span>
                        </div>
                        <ChevronRight className="w-4 h-4 text-mimo-border group-hover:text-mimo-accent transition-colors" />
                      </button>
                      <button
                        onClick={() => setDeleteTarget(p)}
                        className="p-4 opacity-0 group-hover:opacity-100 transition-opacity hover:text-red-400 text-mimo-text-muted"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {projects.length === 0 && (
              <p className="text-center text-[10px] font-mono text-mimo-text-muted opacity-40 py-4">
                No saved projects yet
              </p>
            )}
          </div>
        </div>

        {/* Modals */}
        <AnimatePresence>
          {showCreateModal && (
            <CreateProjectModal
              onClose={() => setShowCreateModal(false)}
              onCreate={handleCreateProject}
            />
          )}
          {deleteTarget && (
            <DeleteConfirmModal
              project={deleteTarget}
              onClose={() => setDeleteTarget(null)}
              onConfirm={() => handleDeleteProject(deleteTarget)}
            />
          )}
        </AnimatePresence>
      </>
    );
  }

  // ── Project view ─────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-screen bg-mimo-bg text-mimo-text overflow-hidden">
      {/* Header */}
      <header className="h-14 border-b border-mimo-border flex items-center px-4 shrink-0 bg-mimo-panel/80 backdrop-blur-md z-30">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSelectedProjectId(null)}
            className="p-2 hover:bg-white/5 rounded-lg transition-colors group"
          >
            <ArrowLeft className="w-5 h-5 text-mimo-text-muted group-hover:text-mimo-accent" />
          </button>
          <div className="flex flex-col">
            <h2 className="text-sm font-serif italic leading-none">
              {selectedProject?.name || 'Project'}
            </h2>
            <span className="text-[8px] font-mono text-mimo-text-muted uppercase tracking-widest">
              Active Workspace
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3 ml-auto">
          <button
            onClick={() => setIsInfoOpen(true)}
            className="p-2 hover:bg-white/5 rounded-lg transition-colors"
          >
            <Info className="w-5 h-5 text-mimo-text-muted" />
          </button>
          <div className="px-2 py-1 bg-mimo-bg rounded border border-mimo-border text-[9px] font-mono flex items-center gap-1.5">
            <div className={`w-1.5 h-1.5 rounded-full animate-pulse ${
              healthStatus.status === 'healthy' ? 'bg-green-500'
              : healthStatus.status === 'warning' ? 'bg-yellow-500'
              : 'bg-red-500'
            }`} />
            {healthStatus.status.toUpperCase()}
          </div>
          <div className="px-2 py-1 bg-mimo-bg rounded border border-mimo-border text-[9px] font-mono text-mimo-text-muted flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            {presenceCount > 1 ? `${presenceCount} USERS` : 'SYNCED'}
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 relative overflow-hidden">
        <AnimatePresence mode="wait">
          {isInfoOpen && (
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 20 }}
              className="absolute inset-0 z-50"
            >
              <InfoPanel onClose={() => setIsInfoOpen(false)} />
            </motion.div>
          )}

          {activeTab === 'chat' && (
            <motion.div key="chat" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0">
              <ChatPanel
                projectId={selectedProjectId}
                messages={messages}
                setMessages={setMessages}
                planningMode={planningMode}
                setPlanningMode={setPlanningMode}
                explanationRequest={explanationRequest}
                onExplanated={() => setExplanationRequest(null)}
                terminalOutput={terminalOutput}
                setTerminalOutput={setTerminalOutput}
              />
            </motion.div>
          )}

          {activeTab === 'files' && (
            <motion.div key="files" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0">
              <PanelErrorBoundary label="Files Panel">
                <FilesPanel
                  projectId={selectedProjectId}
                  onExplain={setExplanationRequest}
                  onReview={(paths) => {
                    // Wire review: pre-fill chat with selected file paths and switch tab
                    setExplanationRequest({ path: paths[0] ?? '', content: `Review these files:\n${paths.join('\n')}` });
                    setActiveTab('chat');
                  }}
                  sandboxErrors={sandboxErrors}
                  socket={socket}
                />
              </PanelErrorBoundary>
            </motion.div>
          )}

          {activeTab === 'preview' && (
            <motion.div key="preview" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 flex flex-col bg-mimo-bg">
              <div className="flex-1 p-3 flex flex-col min-w-0">
                <div className="flex-1 bg-white rounded border border-mimo-border overflow-hidden relative shadow-inner">
                  <iframe
                    src={`/preview/${selectedProjectId}/index.html`}
                    className="w-full h-full border-none"
                    title="Project Preview"
                    sandbox="allow-scripts allow-forms allow-same-origin"
                  />
                  <div className="absolute top-2 right-2 px-2 py-0.5 bg-black/50 text-[8px] font-mono text-green-400 rounded backdrop-blur">
                    LIVE
                  </div>
                </div>
              </div>
              <div className="flex-[2] bg-black mx-3 mb-3 rounded border border-mimo-border flex flex-col overflow-hidden min-h-[150px]">
                <div className="px-4 py-2 border-b border-mimo-border bg-black/50 flex items-center gap-2">
                  <span className="text-[9px] font-mono uppercase tracking-widest text-mimo-text-muted font-bold">Terminal</span>
                  <div className="ml-auto flex items-center gap-1.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                    <span className="text-[8px] font-mono text-mimo-text-muted">ACTIVE</span>
                  </div>
                </div>
                <div ref={terminalRef} className="flex-1 overflow-y-auto p-4 font-mono text-[10px] text-green-500/90 space-y-1">
                  {terminalOutput.map((line, i) => (
                    <div key={i} className="whitespace-pre-wrap break-all border-l border-green-500/10 pl-2">{line}</div>
                  ))}
                </div>
                <form onSubmit={handleRunCommand} className="p-3 bg-black/50 border-t border-mimo-border flex items-center gap-3">
                  <span className="text-mimo-accent font-bold">$</span>
                  <input
                    type="text"
                    value={command}
                    onChange={(e) => setCommand(e.target.value)}
                    placeholder="npm run dev..."
                    className="flex-1 bg-transparent border-none focus:outline-none text-[10px] font-mono text-white placeholder:text-white/20"
                  />
                </form>
              </div>
            </motion.div>
          )}

          {activeTab === 'arch' && (
            <motion.div key="arch" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0">
              <PanelErrorBoundary label="Architecture Panel">
                <ArchitecturePanel projectId={selectedProjectId!} />
              </PanelErrorBoundary>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Nav */}
      <nav className="h-16 border-t border-mimo-border bg-mimo-panel flex shrink-0 items-center px-6 gap-2">
        <TabButton active={activeTab === 'chat'}    onClick={() => setActiveTab('chat')}    icon={<MessageSquare />} label="Chat" />
        <TabButton active={activeTab === 'files'}   onClick={() => setActiveTab('files')}   icon={<FolderCode />}    label="Files" />
        <TabButton active={activeTab === 'preview'} onClick={() => setActiveTab('preview')} icon={<Play />}          label="Preview" />
        <TabButton active={activeTab === 'arch'}    onClick={() => setActiveTab('arch')}    icon={<Layers />}        label="Arch" />
      </nav>

      {/* Delete modal from within project view (edge case) */}
      <AnimatePresence>
        {deleteTarget && (
          <DeleteConfirmModal
            project={deleteTarget}
            onClose={() => setDeleteTarget(null)}
            onConfirm={() => handleDeleteProject(deleteTarget)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
