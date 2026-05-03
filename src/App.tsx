import React, { useState, useEffect, useRef } from 'react';
import { 
  FolderCode, 
  MessageSquare, 
  Play, 
  Database,
  ArrowLeft,
  Info,
  ChevronRight,
  Code,
  Activity,
  Terminal as TerminalIcon,
  Layers,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { io, Socket } from 'socket.io-client';
import { ArchitecturePanel } from './components/arch/ArchitecturePanel';
import { ChatPanel } from './components/chat/ChatPanel';
import { ImportPanel, TabButton } from './components/panels/Common';
import { FilesPanel } from './components/panels/FilesPanel';
import { InfoPanel } from './components/panels/InfoPanel';
import { Project, Message } from './types';

// Global socket instance
let socket: Socket;

export default function App() {
  const [activeTab, setActiveTab] = useState<'chat' | 'files' | 'preview' | 'arch'>('chat');
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isInfoOpen, setIsInfoOpen] = useState(false);
  const [planningMode, setPlanningMode] = useState(false);
  const [explanationRequest, setExplanationRequest] = useState<{ path: string; content: string } | null>(null);
  const [terminalOutput, setTerminalOutput] = useState<string[]>(['bldr Terminal v1.0.0', 'Ready...']);
  const [presenceCount, setPresenceCount] = useState(1);
  const [sandboxErrors, setSandboxErrors] = useState<any[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [healthStatus, setHealthStatus] = useState<{ status: 'healthy' | 'warning' | 'error', issues: string[] }>({ status: 'healthy', issues: [] });
  const [command, setCommand] = useState('');
  const terminalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (selectedProjectId) {
      const runHealthCheck = async () => {
        try {
          const res = await fetch('/api/tools/run_shell', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectId: selectedProjectId, command: 'npm run lint' })
          });
          const data = await res.json();
          if (data.stderr || data.error) {
            setHealthStatus({ 
              status: 'warning', 
              issues: [data.stderr || data.error] 
            });
          } else {
            setHealthStatus({ status: 'healthy', issues: [] });
          }
        } catch (e) {
          setHealthStatus({ status: 'error', issues: ['Health check failed to execute'] });
        }
      };
      
      const interval = setInterval(runHealthCheck, 60000);
      runHealthCheck();
      return () => clearInterval(interval);
    }
  }, [selectedProjectId]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'SANDBOX_ERROR') {
        setSandboxErrors(prev => [...prev, { ...event.data, timestamp: Date.now() }]);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  useEffect(() => {
    fetchProjects();
  }, []);

  useEffect(() => {
    if (selectedProjectId) {
      if (!socket) {
        socket = io();
      }
      socket.emit('join_project', selectedProjectId);
      socket.on('presence_update', (count) => setPresenceCount(count));
      return () => {
        socket.off('presence_update');
      };
    }
  }, [selectedProjectId]);

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [terminalOutput]);

  const fetchProjects = async () => {
    const res = await fetch('/api/projects');
    const data = await res.json();
    setProjects(data);
  };

  const handleImport = async (url: string, name: string) => {
    setIsImporting(true);
    try {
      const res = await fetch('/api/import/github', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, name })
      });
      const data = await res.json();
      if (data.id) {
        setSelectedProjectId(data.id);
        fetchProjects();
      }
    } finally {
      setIsImporting(false);
    }
  };

  const handleRunCommand = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!command.trim() || !selectedProjectId) return;
    const cmdToRun = command;
    setCommand('');
    setTerminalOutput(prev => [...prev, `> ${cmdToRun}`]);
    try {
      const res = await fetch('/api/tools/run_shell', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: selectedProjectId, command: cmdToRun })
      });
      const data = await res.json();
      if (data.stdout) setTerminalOutput(prev => [...prev, data.stdout]);
      if (data.stderr) setTerminalOutput(prev => [...prev, `ERROR: ${data.stderr}`]);
    } catch (e) {
      setTerminalOutput(prev => [...prev, 'System: Command failed to execute']);
    }
  };

  if (!selectedProjectId) {
    return (
      <div className="min-h-screen bg-mimo-bg flex flex-col items-center p-6 text-mimo-text">
        <header className="w-full max-w-md text-center mb-12 mt-12">
          <div className="w-16 h-16 bg-mimo-bg border border-mimo-accent rounded-full flex items-center justify-center mx-auto mb-4 shadow-[0_0_20px_rgba(242,125,38,0.2)]">
            <div className="w-4 h-4 bg-mimo-accent rounded-full animate-pulse" />
          </div>
          <h1 className="text-4xl font-serif italic tracking-tight mb-2">bldr</h1>
          <p className="text-mimo-text-muted text-sm font-mono uppercase tracking-widest">Architecture-First AI IDE</p>
        </header>

        <div className="w-full max-w-md space-y-6">
          {projects.length > 0 && (
            <div className="bg-mimo-panel rounded-xl shadow-2xl border border-mimo-border overflow-hidden">
              <div className="px-4 py-3 border-b border-mimo-border flex items-center gap-2 text-[10px] font-mono text-mimo-text-muted uppercase tracking-widest">
                <Database className="w-3 h-3 text-mimo-accent" />
                Persistent Workspaces
              </div>
              <div className="divide-y divide-mimo-border">
                {projects.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setSelectedProjectId(p.id)}
                    className="w-full px-4 py-5 flex items-center justify-between hover:bg-white/[0.02] transition-all group"
                  >
                    <div className="flex flex-col items-start transition-transform group-active:scale-95">
                      <span className="font-medium text-mimo-text">{p.name || 'Untitled Project'}</span>
                      <span className="text-[10px] font-mono text-mimo-text-muted">{new Date(p.createdAt || Date.now()).toLocaleDateString()}</span>
                    </div>
                    <ChevronRight className="w-5 h-5 text-mimo-border group-hover:text-mimo-accent transition-colors" />
                  </button>
                ))}
              </div>
            </div>
          )}
          <ImportPanel onImport={handleImport} isImporting={isImporting} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-mimo-bg text-mimo-text overflow-hidden selection:bg-mimo-accent/30 selection:text-white">
      <header className="h-14 border-b border-mimo-border flex items-center px-4 shrink-0 bg-mimo-panel/80 backdrop-blur-md z-30">
        <div className="flex items-center gap-4">
          <button 
            onClick={() => setSelectedProjectId(null)}
            className="p-2 hover:bg-white/5 rounded-lg transition-colors group"
          >
            <ArrowLeft className="w-5 h-5 text-mimo-text-muted group-hover:text-mimo-accent" />
          </button>
          <div className="flex flex-col">
            <h2 className="text-sm font-serif italic leading-none">{projects.find(p => p.id === selectedProjectId)?.name || 'Project'}</h2>
            <span className="text-[8px] font-mono text-mimo-text-muted uppercase tracking-widest">Active Workspace</span>
          </div>
        </div>

        <div className="flex items-center gap-4 ml-auto">
          <button 
            onClick={() => setIsInfoOpen(true)}
            className="p-2 hover:bg-white/5 rounded-lg transition-colors"
          >
            <Info className="w-5 h-5" />
          </button>
          <div className="px-2 py-0.5 bg-mimo-bg rounded border border-mimo-border text-[9px] font-mono flex items-center gap-2">
            <div className={`w-1 h-1 rounded-full animate-pulse ${
              healthStatus.status === 'healthy' ? 'bg-green-500' : 
              healthStatus.status === 'warning' ? 'bg-yellow-500' : 'bg-red-500'
            }`} />
            {healthStatus.status.toUpperCase()}
          </div>
          <div className="px-2 py-0.5 bg-mimo-bg rounded border border-mimo-border text-[9px] font-mono text-mimo-text-muted flex items-center gap-2">
            <div className="w-1 h-1 rounded-full bg-green-500 animate-pulse" />
            {presenceCount > 1 ? `${presenceCount} ACTIVE USERS` : 'SYNCED'}
          </div>
        </div>
      </header>

      <main className="flex-1 relative overflow-hidden">
        <AnimatePresence mode="wait">
          {isInfoOpen && (
            <motion.div 
               initial={{ x: '100%' }}
               animate={{ x: 0 }}
               exit={{ x: '100%' }}
               transition={{ type: 'spring', damping: 20 }}
               className="absolute inset-0 z-50 overflow-hidden"
            >
               <InfoPanel onClose={() => setIsInfoOpen(false)} />
            </motion.div>
          )}

          {activeTab === 'chat' && (
            <motion.div 
              key="chat"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0"
            >
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
            <motion.div 
              key="files"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0"
            >
              <FilesPanel 
                projectId={selectedProjectId} 
                onExplain={setExplanationRequest}
                onReview={(paths) => {
                   setActiveTab('chat');
                   // The AI will see the "activities" and know it's being asked for an audit
                }}
                sandboxErrors={sandboxErrors}
                socket={socket}
              />
            </motion.div>
          )}
          {activeTab === 'preview' && (
            <motion.div 
              key="preview"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 flex flex-col sm:flex-row bg-mimo-bg"
            >
               <div className="flex-1 p-3 sm:p-6 flex flex-col min-w-0">
                  <div className="flex-1 bg-white rounded border border-mimo-border overflow-hidden relative shadow-inner">
                    <iframe 
                      src={`/api/proxy/${selectedProjectId}/`}
                      className="w-full h-full border-none"
                      title="Project Preview"
                      sandbox="allow-scripts allow-forms allow-same-origin"
                    />
                    <div className="absolute top-2 right-2 px-2 py-0.5 bg-black/50 text-[8px] font-mono text-green-400 rounded backdrop-blur">
                      LIVE
                    </div>
                  </div>

                  <div className="flex-[2] bg-black m-3 sm:m-6 mt-0 rounded border border-mimo-border flex flex-col overflow-hidden min-h-[150px]">
                     <div className="px-4 py-2 border-b border-mimo-border bg-black/50 flex items-center gap-2">
                       <TerminalIcon className="w-3 h-3 text-mimo-accent" />
                       <span className="text-[9px] font-mono uppercase tracking-widest text-mimo-text-muted font-bold">bldr-term-v1</span>
                       <div className="ml-auto flex items-center gap-1.5">
                         <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                         <span className="text-[8px] font-mono text-mimo-text-muted">ACTIVE</span>
                       </div>
                     </div>
                     <div 
                       ref={terminalRef}
                       className="flex-1 overflow-y-auto p-4 font-mono text-[10px] text-green-500/90 space-y-1 selection:bg-green-500/20"
                     >
                       {terminalOutput.map((line, i) => (
                         <div key={i} className="whitespace-pre-wrap break-all border-l border-green-500/10 pl-2">
                           {line}
                         </div>
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
               </div>
            </motion.div>
          )}
          {activeTab === 'arch' && (
            <motion.div 
              key="arch"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0"
            >
              <ArchitecturePanel projectId={selectedProjectId!} />
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <nav className="h-16 border-t border-mimo-border bg-mimo-panel flex shrink-0 items-center px-6 gap-2">
        <TabButton 
          active={activeTab === 'chat'} 
          onClick={() => setActiveTab('chat')} 
          icon={<MessageSquare />} 
          label="Chat" 
        />
        <TabButton 
          active={activeTab === 'files'} 
          onClick={() => setActiveTab('files')} 
          icon={<FolderCode />} 
          label="Files" 
        />
        <TabButton 
          active={activeTab === 'preview'} 
          onClick={() => setActiveTab('preview')} 
          icon={<Play />} 
          label="Preview" 
        />
        <TabButton 
          active={activeTab === 'arch'} 
          onClick={() => setActiveTab('arch')} 
          icon={<Layers />} 
          label="Arch" 
        />
      </nav>
    </div>
  );
}
