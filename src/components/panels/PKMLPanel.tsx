/**
 * PKMLPanel.tsx — PKML editor + CCC status panel
 *
 * PKML = Intent layer (what the product IS and why)
 * CCC  = Reality layer (what the code actually IS, extracted deterministically)
 *
 * These two are kept separate — never merged.
 * Together they give MiMo the full picture: intent vs reality.
 */

import React, { useState, useEffect } from 'react';
import {
  BookOpen, Cpu, Save, Loader2, Check, AlertTriangle,
  RefreshCw, ChevronDown, ChevronRight, Plus, Zap,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// ─── Default PKML template (minimal v0.2) ─────────────────────────────────────
const DEFAULT_PKML = {
  "$schema": "https://pkml.dev/schema/v0.2.json",
  "meta": {
    "version": "1.0.0",
    "pkml_version": "0.2",
    "last_updated": new Date().toISOString(),
    "generated": false,
  },
  "product": {
    "name": "",
    "tagline": "",
    "description": "",
    "positioning": {
      "problem": "",
      "solution": "",
      "target_audience": "",
      "differentiators": [],
    },
  },
  "features": [],
  "engineering": {
    "constraints": [],
    "lessons_learned": [],
    "implementation_patterns": [],
    "decision_log": [],
    "glossary": [],
  },
};

// ─── Types ────────────────────────────────────────────────────────────────────
interface CCCResult {
  exists: boolean;
  entry_points?: string[];
  tech_stack?: string[];
  conventions?: string[];
  symbol_count?: number;
  generated_at?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function JsonField({
  label, value, onChange, multiline = false, hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-[9px] font-mono uppercase tracking-widest text-mimo-text-muted ml-1">
        {label}
      </label>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          className="w-full px-3 py-2.5 bg-mimo-bg border border-mimo-border rounded-xl text-sm text-mimo-text focus:outline-none focus:border-mimo-accent transition-all resize-none font-mono text-[11px]"
          placeholder={hint}
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-3 py-2.5 bg-mimo-bg border border-mimo-border rounded-xl text-sm text-mimo-text focus:outline-none focus:border-mimo-accent transition-all font-mono text-[11px]"
          placeholder={hint}
        />
      )}
    </div>
  );
}

function Section({
  title, icon, children, defaultOpen = true,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border border-mimo-border overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-4 py-3 bg-mimo-panel hover:bg-white/[0.02] transition-colors"
      >
        <span className="text-mimo-accent">{icon}</span>
        <span className="text-[10px] font-mono font-bold uppercase tracking-widest flex-1 text-left">{title}</span>
        {open
          ? <ChevronDown className="w-3.5 h-3.5 text-mimo-text-muted" />
          : <ChevronRight className="w-3.5 h-3.5 text-mimo-text-muted" />
        }
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="p-4 space-y-4 border-t border-mimo-border">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Main Panel ───────────────────────────────────────────────────────────────
export function PKMLPanel({ projectId }: { projectId: string }) {
  const [pkml, setPkml] = useState<any>(null);
  const [ccc, setCcc] = useState<CCCResult | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const [activeTab, setActiveTab] = useState<'pkml' | 'ccc'>('pkml');

  useEffect(() => { loadData(); }, [projectId]);

  const loadData = async () => {
    const [pkmlRes, cccRes] = await Promise.all([
      fetch(`/api/projects/${projectId}/pkml`),
      fetch(`/api/projects/${projectId}/ccc/context`),
    ]);
    const [pkmlData, cccData] = await Promise.all([pkmlRes.json(), cccRes.json()]);
    setPkml(pkmlData.exists ? pkmlData.content : { ...DEFAULT_PKML, meta: { ...DEFAULT_PKML.meta, last_updated: new Date().toISOString() } });
    setCcc(cccData);
  };

  const savePKML = async () => {
    setIsSaving(true);
    try {
      const updated = { ...pkml, meta: { ...pkml.meta, last_updated: new Date().toISOString() } };
      const res = await fetch(`/api/projects/${projectId}/pkml`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: updated }),
      });
      if (!res.ok) throw new Error('Save failed');
      setPkml(updated);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch {
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 3000);
    } finally {
      setIsSaving(false);
    }
  };

  const runCCC = async () => {
    setIsExtracting(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/ccc/extract`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        const ctx = await (await fetch(`/api/projects/${projectId}/ccc/context`)).json();
        setCcc(ctx);
      }
    } finally {
      setIsExtracting(false);
    }
  };

  const update = (path: string[], value: any) => {
    setPkml((prev: any) => {
      const next = JSON.parse(JSON.stringify(prev));
      let obj = next;
      for (let i = 0; i < path.length - 1; i++) obj = obj[path[i]] ??= {};
      obj[path[path.length - 1]] = value;
      return next;
    });
  };

  if (!pkml) return (
    <div className="flex items-center justify-center h-full">
      <Loader2 className="w-5 h-5 animate-spin text-mimo-accent" />
    </div>
  );

  return (
    <div className="flex flex-col h-full bg-mimo-bg text-mimo-text">
      {/* Header */}
      <div className="px-5 h-12 border-b border-mimo-border bg-mimo-panel flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <BookOpen className="w-3.5 h-3.5 text-mimo-accent" />
          <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-mimo-text-muted">
            PKML + CCC
          </span>
        </div>
        {activeTab === 'pkml' && (
          <button
            onClick={savePKML}
            disabled={isSaving}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[9px] font-mono uppercase tracking-widest transition-all ${
              saveStatus === 'saved' ? 'bg-green-500/20 text-green-400 border border-green-500/40'
              : saveStatus === 'error' ? 'bg-red-500/20 text-red-400 border border-red-500/40'
              : 'bg-mimo-accent text-mimo-bg hover:opacity-90'
            } disabled:opacity-40`}
          >
            {isSaving ? <Loader2 className="w-3 h-3 animate-spin" />
              : saveStatus === 'saved' ? <Check className="w-3 h-3" />
              : saveStatus === 'error' ? <AlertTriangle className="w-3 h-3" />
              : <Save className="w-3 h-3" />}
            {saveStatus === 'saved' ? 'Saved' : saveStatus === 'error' ? 'Error' : 'Save'}
          </button>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-mimo-border shrink-0">
        <button
          onClick={() => setActiveTab('pkml')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[9px] font-mono uppercase tracking-widest transition-colors ${
            activeTab === 'pkml' ? 'text-mimo-accent border-b-2 border-mimo-accent' : 'text-mimo-text-muted'
          }`}
        >
          <BookOpen className="w-3 h-3" />
          PKML Intent
        </button>
        <button
          onClick={() => setActiveTab('ccc')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[9px] font-mono uppercase tracking-widest transition-colors ${
            activeTab === 'ccc' ? 'text-mimo-accent border-b-2 border-mimo-accent' : 'text-mimo-text-muted'
          }`}
        >
          <Cpu className="w-3 h-3" />
          CCC Reality
          {ccc?.exists && <span className="w-1.5 h-1.5 rounded-full bg-green-500 ml-1" />}
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">

        {/* ── PKML Tab ───────────────────────────────────────────────────── */}
        {activeTab === 'pkml' && (
          <>
            <p className="text-[9px] font-mono text-mimo-text-muted leading-relaxed">
              PKML captures <strong className="text-mimo-text">what the product IS</strong> and <strong className="text-mimo-text">why decisions were made</strong>.
              This is injected into every MiMo prompt as the intent layer.
            </p>

            {/* Product section */}
            <Section title="Product" icon={<BookOpen className="w-3.5 h-3.5" />}>
              <JsonField label="Product Name" value={pkml.product?.name ?? ''} onChange={v => update(['product','name'], v)} hint="bldr" />
              <JsonField label="Tagline" value={pkml.product?.tagline ?? ''} onChange={v => update(['product','tagline'], v)} hint="Mobile-first AI coding IDE" />
              <JsonField label="Description" value={pkml.product?.description ?? ''} onChange={v => update(['product','description'], v)} multiline hint="What does this product do?" />
              <JsonField label="Problem solved" value={pkml.product?.positioning?.problem ?? ''} onChange={v => update(['product','positioning','problem'], v)} multiline />
              <JsonField label="Solution" value={pkml.product?.positioning?.solution ?? ''} onChange={v => update(['product','positioning','solution'], v)} multiline />
              <JsonField label="Target audience" value={pkml.product?.positioning?.target_audience ?? ''} onChange={v => update(['product','positioning','target_audience'], v)} />
            </Section>

            {/* Engineering constraints */}
            <Section title="Engineering Constraints" icon={<AlertTriangle className="w-3.5 h-3.5" />} defaultOpen={false}>
              {(pkml.engineering?.constraints ?? []).map((c: any, i: number) => (
                <div key={i} className="p-3 rounded-lg bg-mimo-bg border border-mimo-border space-y-2">
                  <div className="flex items-center gap-2">
                    <span className={`text-[8px] font-mono uppercase px-2 py-0.5 rounded ${
                      c.severity === 'critical' ? 'bg-red-500/20 text-red-400'
                      : c.severity === 'high' ? 'bg-orange-500/20 text-orange-400'
                      : 'bg-yellow-500/20 text-yellow-400'
                    }`}>{c.severity ?? 'medium'}</span>
                    <span className="text-[9px] font-mono text-mimo-text-muted">{c.type ?? 'rule'}</span>
                  </div>
                  <p className="text-xs text-mimo-text">{c.rule}</p>
                  <p className="text-[10px] text-mimo-text-muted">{c.reason}</p>
                </div>
              ))}
              <button
                onClick={() => update(['engineering','constraints'], [
                  ...(pkml.engineering?.constraints ?? []),
                  { id: `constraint_${Date.now()}`, rule: '', reason: '', severity: 'medium', type: 'architecture_rule' }
                ])}
                className="w-full flex items-center justify-center gap-2 py-2.5 border border-dashed border-mimo-border rounded-xl text-[10px] font-mono text-mimo-text-muted hover:border-mimo-accent/40 hover:text-mimo-accent transition-all"
              >
                <Plus className="w-3.5 h-3.5" /> Add Constraint
              </button>
            </Section>

            {/* Lessons learned */}
            <Section title="Lessons Learned" icon={<Zap className="w-3.5 h-3.5" />} defaultOpen={false}>
              {(pkml.engineering?.lessons_learned ?? []).map((l: any, i: number) => (
                <div key={i} className="p-3 rounded-lg bg-mimo-bg border border-mimo-border space-y-1">
                  <p className="text-[10px] font-mono text-red-400/80">What happened: {l.what_happened}</p>
                  <p className="text-[10px] font-mono text-green-400/80">Correct approach: {l.correct_approach}</p>
                </div>
              ))}
              <button
                onClick={() => update(['engineering','lessons_learned'], [
                  ...(pkml.engineering?.lessons_learned ?? []),
                  { id: `lesson_${Date.now()}`, what_happened: '', correct_approach: '' }
                ])}
                className="w-full flex items-center justify-center gap-2 py-2.5 border border-dashed border-mimo-border rounded-xl text-[10px] font-mono text-mimo-text-muted hover:border-mimo-accent/40 hover:text-mimo-accent transition-all"
              >
                <Plus className="w-3.5 h-3.5" /> Add Lesson
              </button>
            </Section>
          </>
        )}

        {/* ── CCC Tab ────────────────────────────────────────────────────── */}
        {activeTab === 'ccc' && (
          <>
            <p className="text-[9px] font-mono text-mimo-text-muted leading-relaxed">
              CCC extracts <strong className="text-mimo-text">what the code actually is</strong> — deterministically, from source.
              This is injected as the reality layer. Never merged with PKML.
            </p>

            <button
              onClick={runCCC}
              disabled={isExtracting}
              className="w-full flex items-center justify-center gap-2 py-3.5 bg-mimo-accent text-mimo-bg rounded-xl text-[10px] font-bold uppercase tracking-widest hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-40"
            >
              {isExtracting
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Extracting…</>
                : <><RefreshCw className="w-4 h-4" /> Run CCC Extraction</>
              }
            </button>

            {ccc?.exists ? (
              <div className="space-y-4">
                <div className="text-[8px] font-mono text-mimo-text-muted/60 text-center">
                  Last extracted: {ccc.generated_at ? new Date(ccc.generated_at).toLocaleString() : 'unknown'}
                </div>

                {ccc.entry_points?.length ? (
                  <Section title="Entry Points" icon={<Zap className="w-3.5 h-3.5" />}>
                    {ccc.entry_points.map((e) => (
                      <div key={e} className="flex items-center gap-2 text-[10px] font-mono text-mimo-text">
                        <span className="w-1.5 h-1.5 rounded-full bg-mimo-accent shrink-0" />
                        {e}
                      </div>
                    ))}
                  </Section>
                ) : null}

                {ccc.tech_stack?.length ? (
                  <Section title="Tech Stack (detected)" icon={<Cpu className="w-3.5 h-3.5" />}>
                    <div className="flex flex-wrap gap-2">
                      {ccc.tech_stack.map((t) => (
                        <span key={t} className="px-2 py-1 rounded-lg bg-mimo-bg border border-mimo-border text-[9px] font-mono text-mimo-text-muted">
                          {t}
                        </span>
                      ))}
                    </div>
                  </Section>
                ) : null}

                {ccc.conventions?.length ? (
                  <Section title="Conventions" icon={<BookOpen className="w-3.5 h-3.5" />}>
                    {ccc.conventions.map((c) => (
                      <div key={c} className="flex items-center gap-2 text-[10px] font-mono text-mimo-text-muted">
                        <Check className="w-3 h-3 text-green-500 shrink-0" />
                        {c}
                      </div>
                    ))}
                  </Section>
                ) : null}
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 py-8 opacity-40 text-center">
                <Cpu className="w-8 h-8 text-mimo-text-muted" />
                <p className="text-xs font-mono text-mimo-text-muted">
                  No CCC extraction yet.<br />Run extraction to generate the reality layer.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
