import React, { useState, useEffect, useRef } from 'react';
import { 
  FolderCode, 
  ArrowLeft, 
  Activity, 
  HelpCircle, 
  Save, 
  Check, 
  Loader2, 
  Plus, 
  Search, 
  ChevronDown, 
  ChevronRight, 
  FileCode 
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import CodeMirror from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { oneDark } from '@codemirror/theme-one-dark';
import { FileEntry, TreeNode } from '../../types';
import { Socket } from 'socket.io-client';

interface FilesPanelProps {
  projectId: string;
  onExplain: (req: { path: string; content: string }) => void;
  onReview: (paths: string[]) => void;
  sandboxErrors: any[];
  socket: Socket | null;
}

export function FilesPanel({ 
  projectId, 
  onExplain, 
  onReview,
  sandboxErrors,
  socket
}: FilesPanelProps) {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [editedContent, setEditedContent] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [remoteEditBy, setRemoteEditBy] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const editorRef = useRef<any>(null);

  const scrollToLine = (line: number) => {
    if (editorRef.current?.view) {
      const view = editorRef.current.view;
      const linePos = view.state.doc.line(Math.min(line, view.state.doc.lines)).from;
      view.dispatch({
        selection: { anchor: linePos, head: linePos },
        scrollIntoView: true
      });
    }
  };

  useEffect(() => {
    if (selectedFile && socket) {
      const handleRemoteChange = ({ path, changes, userId }: any) => {
        if (path === selectedFile) {
          setEditedContent(changes);
          setRemoteEditBy(userId.slice(0, 4));
          setTimeout(() => setRemoteEditBy(null), 2000);
        }
      };

      socket.on('remote_change', handleRemoteChange);
      return () => {
        socket.off('remote_change', handleRemoteChange);
      };
    }
  }, [selectedFile, socket]);

  useEffect(() => {
    const fetchFiles = async () => {
      const res = await fetch(`/api/files/${projectId}`);
      const data = await res.json();
      setFiles(data);
    };
    fetchFiles();
  }, [projectId]);

  useEffect(() => {
    if (content !== null) {
      setEditedContent(content);
      setHasUnsavedChanges(false);
    }
  }, [content]);

  const handleOpenFile = async (path: string) => {
    setSelectedFile(path);
    setIsLoading(true);
    try {
      const res = await fetch(`/api/files/${projectId}/content?path=${encodeURIComponent(path)}`);
      const text = await res.text();
      setContent(text);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    if (!selectedFile || isSaving) return;
    setIsSaving(true);
    try {
      const res = await fetch('/api/tools/write_file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, path: selectedFile, content: editedContent })
      });
      if (res.ok) {
        setContent(editedContent);
        setHasUnsavedChanges(false);
      }
    } finally {
      setIsSaving(false);
    }
  };

  const tree = buildTree(files);

  if (selectedFile) {
    return (
      <div className="flex flex-col h-full bg-mimo-bg">
        <header className="px-6 h-12 border-b border-mimo-border flex items-center justify-between shrink-0 bg-mimo-panel sticky top-0 z-20">
          <div className="flex items-center gap-3">
            <button onClick={() => setSelectedFile(null)} className="p-1 hover:bg-white/5 rounded text-mimo-accent">
              <ArrowLeft className="w-4 h-4" />
            </button>
            <span className="text-[10px] font-mono text-mimo-accent uppercase tracking-widest truncate max-w-[120px]">{selectedFile.split('/').pop()}</span>
            {hasUnsavedChanges && <div className="w-1.5 h-1.5 rounded-full bg-mimo-accent animate-pulse" />}
            <AnimatePresence>
              {remoteEditBy && (
                <motion.div 
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0 }}
                  className="px-1.5 py-0.5 rounded bg-green-500/20 text-green-500 text-[8px] font-mono border border-green-500/30"
                >
                  USER {remoteEditBy} EDITING...
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <div className="flex items-center gap-2">
            <button 
              onClick={() => onReview([selectedFile])}
              className="px-3 py-1 bg-white/5 border border-mimo-border hover:border-mimo-accent hover:text-mimo-accent rounded-full text-[9px] font-mono transition-all flex items-center gap-2"
            >
              <Activity className="w-3 h-3" />
              REVIEW
            </button>
            <button 
              onClick={handleSave}
              disabled={!hasUnsavedChanges || isSaving}
              className={`px-3 py-1 flex items-center gap-2 rounded-full text-[9px] font-mono transition-all border ${
                hasUnsavedChanges 
                  ? 'bg-mimo-accent text-mimo-bg border-mimo-accent hover:opacity-90' 
                  : 'bg-white/5 border-mimo-border text-mimo-text-muted opacity-50 cursor-not-allowed'
              }`}
            >
              {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : hasUnsavedChanges ? <Save className="w-3 h-3" /> : <Check className="w-3 h-3" />}
              {isSaving ? 'SAVING...' : hasUnsavedChanges ? 'SAVE CHANGES' : 'SAVED'}
            </button>
            <button 
              onClick={() => onExplain({ path: selectedFile, content: editedContent || '' })}
              className="px-3 py-1 bg-white/5 border border-mimo-border hover:border-mimo-accent hover:text-mimo-accent rounded-full text-[9px] font-mono transition-all flex items-center gap-2"
            >
              <HelpCircle className="w-3 h-3" />
              AI EXPLAIN
            </button>
          </div>
        </header>

        {sandboxErrors
          .filter(err => err.source?.includes(selectedFile?.split('/').pop()))
          .map((err, i) => (
            <div key={i} className="px-6 py-2 bg-red-500/20 border-b border-red-500/30 flex items-center gap-3 text-red-500 text-[10px] font-mono">
              <Activity className="w-3 h-3 shrink-0" />
              <div className="flex-1 truncate">
                <span className="font-bold">RUNTIME ERROR:</span> {err.message} (Line {err.line}:{err.column})
              </div>
              <button 
                onClick={() => scrollToLine(err.line)}
                className="underline hover:no-underline px-2"
              >
                GO TO LINE
              </button>
            </div>
          ))}

        <div className="flex-1 overflow-auto bg-[#282c34]">
          {isLoading ? (
            <div className="h-full flex items-center justify-center">
              <Loader2 className="animate-spin text-mimo-accent" />
            </div>
          ) : (
            <CodeMirror
              ref={editorRef}
              value={editedContent}
              height="100%"
              theme={oneDark}
              extensions={[
                javascript({ jsx: true, typescript: true }),
              ]}
              onChange={(value) => {
                setEditedContent(value);
                setHasUnsavedChanges(value !== content);
                if (socket && selectedFile) {
                  socket.emit('editor_change', { projectId, path: selectedFile, changes: value });
                }
              }}
              basicSetup={{
                lineNumbers: true,
                highlightActiveLine: true,
                bracketMatching: true,
                closeBrackets: true,
                autocompletion: true,
                foldGutter: true,
              }}
              className="text-[11px] sm:text-xs h-full"
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-mimo-bg overflow-hidden text-mimo-text">
      <div className="px-6 py-4 border-b border-mimo-border bg-mimo-panel shrink-0 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-mimo-text">
            <FolderCode className="w-3 h-3 text-mimo-accent" />
            <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-mimo-text-muted">Repository Context</span>
          </div>
          <div className="flex items-center gap-2">
            <button 
              onClick={() => onReview(files.map(f => f.path))}
              className="px-3 py-1 bg-mimo-accent/10 border border-mimo-accent/20 hover:border-mimo-accent text-mimo-accent rounded-full text-[9px] font-mono transition-all flex items-center gap-2"
            >
              <Activity className="w-3 h-3" />
              AUDIT
            </button>
            <button 
              onClick={() => {
                const url = prompt('GitHub Repository URL:');
                const name = prompt('Service Name:');
                if (url && name) {
                  fetch('/api/import/github', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url, name, projectId })
                  }).then(() => window.location.reload());
                }
              }}
              className="p-1.5 bg-white/5 border border-mimo-border rounded-lg text-mimo-text-muted hover:text-mimo-accent transition-all"
              title="Attach Repo"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="relative group">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-mimo-text-muted group-focus-within:text-mimo-accent transition-colors" />
          <input 
            type="text" 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search symbols or regex..."
            className="w-full bg-white/5 border border-mimo-border rounded-lg pl-9 pr-4 py-1.5 text-[10px] font-mono focus:outline-none focus:border-mimo-accent transition-all placeholder:text-white/10"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {files.length === 0 ? (
          <div className="h-40 flex items-center justify-center text-center px-12">
            <p className="text-mimo-text-muted font-mono text-[10px] opacity-50 uppercase tracking-widest">No repositories synced. Use the button above to import your first service.</p>
          </div>
        ) : (
          <div className="space-y-1">
             <FileTree nodes={tree.children || {}} onSelect={handleOpenFile} level={0} searchQuery={searchQuery} />
          </div>
        )}
      </div>
    </div>
  );
}

function buildTree(files: FileEntry[]): TreeNode {
  const root: TreeNode = { name: 'root', path: '', children: {} };
  files.forEach(file => {
    const parts = file.path.split('/');
    let current = root;
    parts.forEach((part, i) => {
      if (!current.children) current.children = {};
      if (!current.children[part]) {
        current.children[part] = {
          name: part,
          path: parts.slice(0, i + 1).join('/'),
          children: i < parts.length - 1 ? {} : undefined,
          size: i === parts.length - 1 ? file.size : undefined
        };
      }
      current = current.children[part];
    });
  });
  return root;
}

function FileTree({ nodes, onSelect, level, searchQuery }: { nodes: Record<string, TreeNode>, onSelect: (path: string) => void, level: number, searchQuery?: string }) {
  const sortedNodes = Object.values(nodes).sort((a, b) => {
    if (a.children && !b.children) return -1;
    if (!a.children && b.children) return 1;
    return a.name.localeCompare(b.name);
  });

  const filteredNodes = sortedNodes.filter(node => {
    if (!searchQuery) return true;
    const matchesNode = node.name.toLowerCase().includes(searchQuery.toLowerCase());
    if (matchesNode) return true;
    const hasMatchingDescendent = (n: TreeNode): boolean => {
      if (n.name.toLowerCase().includes(searchQuery.toLowerCase())) return true;
      if (n.children) return Object.values(n.children).some(c => hasMatchingDescendent(c));
      return false;
    };
    return hasMatchingDescendent(node);
  });

  return (
    <>
      {filteredNodes.map(node => (
        <FileTreeNode key={node.path} node={node} onSelect={onSelect} level={level} searchQuery={searchQuery} />
      ))}
    </>
  );
}

interface FileTreeNodeProps {
  node: TreeNode;
  onSelect: (path: string) => void;
  level: number;
  searchQuery?: string;
  key?: string;
}

function FileTreeNode(props: FileTreeNodeProps) {
  const { node, onSelect, level, searchQuery } = props;
  const [isOpen, setIsOpen] = useState(level === 0 || !!searchQuery);
  const isFolder = !!node.children;

  useEffect(() => {
    if (searchQuery) setIsOpen(true);
  }, [searchQuery]);

  const nameMatches = searchQuery && node.name.toLowerCase().includes(searchQuery.toLowerCase());

  return (
    <div className="select-none">
      <button
        onClick={() => {
          if (isFolder) setIsOpen(!isOpen);
          else onSelect(node.path);
        }}
        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded transition-all group ${
          isFolder ? 'hover:bg-white/5' : 'hover:bg-mimo-accent/10'
        } ${nameMatches ? 'bg-mimo-accent/10 border border-mimo-accent/20' : 'border border-transparent'}`}
        style={{ paddingLeft: `${(level + 1) * 12}px` }}
      >
        <span className="shrink-0 flex items-center justify-center w-4 text-mimo-text-muted group-hover:text-mimo-accent transition-colors">
          {isFolder ? (
            isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />
          ) : (
            <FileCode className="w-3 h-3" />
          )}
        </span>
        <span className={`text-[11px] font-mono truncate ${isFolder ? 'font-bold text-white/80' : 'text-mimo-text'} ${nameMatches ? 'text-mimo-accent' : ''}`}>
          {node.name}
        </span>
      </button>

      {isFolder && isOpen && (
        <div className="mt-0.5">
          <FileTree nodes={node.children!} onSelect={onSelect} level={level + 1} searchQuery={searchQuery} />
        </div>
      )}
    </div>
  );
}
