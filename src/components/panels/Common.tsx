import React, { useRef, useState } from 'react';
import { Github, UploadCloud, Loader2 } from 'lucide-react';
import { motion } from 'motion/react';

export function TabButton({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
  return (
    <button 
      onClick={onClick}
      className={`flex-1 flex flex-col items-center justify-center gap-1 transition-all ${active ? 'text-mimo-accent' : 'text-mimo-text-muted'}`}
    >
      <div className={`p-2 transition-colors`}>
        {React.cloneElement(icon as React.ReactElement, { className: 'w-6 h-6' })}
      </div>
      <span className={`text-[9px] font-bold uppercase tracking-[0.15em] transition-all ${active ? 'opacity-100' : 'opacity-40'}`}>{label}</span>
      {active && <motion.div layoutId="tab-underline" className="w-1 h-1 bg-mimo-accent rounded-full mt-1" />}
    </button>
  );
}

export function ImportPanel({ onImport, isImporting }: { onImport: (url: string, name: string) => void, isImporting: boolean }) {
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [isZipping, setIsZipping] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleZipUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsZipping(true);
    const formData = new FormData();
    formData.append('file', file);
    formData.append('name', name || file.name.replace('.zip', ''));
    
    try {
      await fetch('/api/import/zip', {
        method: 'POST',
        body: formData
      });
      window.location.reload();
    } finally {
      setIsZipping(false);
    }
  };

  return (
    <div className="bg-mimo-panel rounded-xl shadow-2xl border border-mimo-border p-6 space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-mimo-bg rounded-lg border border-mimo-border flex items-center justify-center">
          <Github className="text-mimo-accent w-6 h-6" />
        </div>
        <div>
          <h3 className="font-serif italic text-lg leading-tight">Project Import</h3>
          <p className="text-[10px] font-mono text-mimo-text-muted uppercase tracking-wider">GitHub or Local ZIP</p>
        </div>
      </div>
      <div className="space-y-4">
        <div className="space-y-1">
          <label className="text-[9px] font-mono text-mimo-text-muted ml-2">WORKSPACE ID</label>
          <input 
            type="text" 
            placeholder="my-cool-project" 
            className="w-full px-4 py-3 bg-mimo-bg border border-mimo-border rounded-lg focus:outline-none focus:border-mimo-accent transition-all text-sm font-mono text-mimo-text"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="space-y-2 pt-2 border-t border-mimo-border/50">
          <div className="space-y-1">
            <label className="text-[9px] font-mono text-mimo-text-muted ml-2">GITHUB REPOSITORY URL</label>
            <input 
              type="text" 
              placeholder="https://github.com/..." 
              className="w-full px-4 py-3 bg-mimo-bg border border-mimo-border rounded-lg focus:outline-none focus:border-mimo-accent transition-all text-sm font-mono text-mimo-text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>
          <button 
            onClick={() => onImport(url, name)}
            disabled={!url || isImporting}
            className="w-full py-4 bg-mimo-accent text-mimo-bg rounded-full font-bold uppercase text-xs tracking-widest hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-30 disabled:grayscale"
          >
            {isImporting ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'Import from GitHub'}
          </button>
        </div>

        <div className="relative border-t border-mimo-border/50 pt-4 text-center">
           <span className="absolute -top-2 left-1/2 -translate-x-1/2 bg-mimo-panel px-2 text-[9px] font-mono text-mimo-text-muted">OR</span>
           <input 
              type="file" 
              ref={fileInputRef}
              onChange={handleZipUpload}
              accept=".zip"
              className="hidden"
           />
           <button 
              onClick={() => fileInputRef.current?.click()}
              disabled={isZipping}
              className="w-full py-4 border border-mimo-border rounded-full font-bold uppercase text-[10px] tracking-widest text-mimo-text-muted hover:border-mimo-accent/50 hover:text-mimo-text active:scale-[0.98] transition-all flex items-center justify-center gap-2"
           >
              {isZipping ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
              {isZipping ? 'Extracting...' : 'Upload PROJECT ZIP'}
           </button>
        </div>
      </div>
    </div>
  );
}
