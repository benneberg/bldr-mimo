import React from 'react';
import { HelpCircle, Terminal as TerminalIcon, FileText, Code, Check, Zap, X } from 'lucide-react';

export function InfoPanel({ onClose }: { onClose: () => void }) {
  return (
    <div className="h-full bg-mimo-bg text-mimo-text flex flex-col font-mono overflow-auto selection:bg-mimo-accent/20">
      <header className="px-8 h-16 border-b border-mimo-border bg-mimo-panel flex items-center justify-between sticky top-0 z-20 backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <HelpCircle className="w-4 h-4 text-mimo-accent" />
          <h2 className="text-xs font-bold uppercase tracking-widest">Workspace Manual v1.0</h2>
        </div>
        <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-full transition-colors">
          <X className="w-4 h-4" />
        </button>
      </header>

      <div className="p-8 space-y-12 max-w-2xl">
        <section className="space-y-4">
          <h3 className="text-mimo-accent text-[10px] font-bold border-b border-mimo-accent/20 pb-2">01 / CORE CONCEPTS</h3>
          <div className="space-y-6">
            <div className="flex gap-4">
              <div className="w-8 h-8 rounded bg-mimo-accent/10 border border-mimo-accent/20 flex items-center justify-center shrink-0">
                <Check className="w-4 h-4 text-mimo-accent" />
              </div>
              <div className="space-y-1">
                <h4 className="text-xs font-bold">DETERMINISTIC COLLABORATION</h4>
                <p className="text-[10px] text-mimo-text-muted leading-relaxed">Every keystroke is synchronized across all active users in the same workspace. Real-time presence indicators show who is auditing which file.</p>
              </div>
            </div>
            <div className="flex gap-4">
              <div className="w-8 h-8 rounded bg-blue-500/10 border border-blue-500/20 flex items-center justify-center shrink-0">
                <Zap className="w-4 h-4 text-blue-400" />
              </div>
              <div className="space-y-1">
                <h4 className="text-xs font-bold">KNOWLEDGE LAYERING (CCC)</h4>
                <p className="text-[10px] text-mimo-text-muted leading-relaxed">The AI assistant reads <span className="text-mimo-accent">WORKSPACE.md</span>, <span className="text-mimo-accent">LLM.md</span>, and <span className="text-mimo-accent">PKML.md</span> as its base "truth" layer for all generations.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="space-y-4 italic opacity-50 bg-white/5 p-4 rounded border border-mimo-border">
          <div className="flex items-center gap-2 mb-2 text-mimo-accent">
            <TerminalIcon className="w-3 h-3" />
            <span className="text-[10px] font-bold uppercase">System Note</span>
          </div>
          <p className="text-[9px] leading-relaxed font-mono">bldr is designed for high-density engineering. All UI elements follow the Swiss Minimalist design philosophy where typography and information hierarchy are the primary visual drivers.</p>
        </section>

        <section className="space-y-4">
          <h3 className="text-mimo-accent text-[10px] font-bold border-b border-mimo-accent/20 pb-2">02 / INTERACTION SHORTCUTS</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 bg-mimo-panel border border-mimo-border rounded space-y-2">
               <div className="text-[8px] text-mimo-accent">NAV TAB</div>
               <div className="text-xs font-bold">CHAT (1)</div>
            </div>
            <div className="p-4 bg-mimo-panel border border-mimo-border rounded space-y-2">
               <div className="text-[8px] text-mimo-accent">NAV TAB</div>
               <div className="text-xs font-bold">FILES (2)</div>
            </div>
            <div className="p-4 bg-mimo-panel border border-mimo-border rounded space-y-2">
               <div className="text-[8px] text-mimo-accent">ACTION</div>
               <div className="text-xs font-bold">SAVE (CMD+S)</div>
            </div>
            <div className="p-4 bg-mimo-panel border border-mimo-border rounded space-y-2">
               <div className="text-[8px] text-mimo-accent">VIEW</div>
               <div className="text-xs font-bold">ARCH (3)</div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
