# bldr-mimo Execution Plan

## Goal
Build a mobile-first interface to evaluate MiMo in real dev workflows.

## Current Focus
Get the full loop working end-to-end:
Intent → AI → Blocks → Approve → File write

---

## Week 1 Targets

- [ ] Load workspace (local/zip)
- [ ] File read/write API
- [ ] Basic CCC (workspace + simple summaries)
- [ ] MiMo API call working
- [ ] Return raw AI response

---

## Week 2 Targets

- [ ] Transform AI output → block format
- [ ] UI for block approvals (mobile-first)
- [ ] Apply accepted changes to files
- [ ] Basic watcher (refresh on change)

---

## Week 3 Targets

- [ ] Improve prompting using CCC
- [ ] Add simple search (filename + grep)
- [ ] Add export (zip or patch)

---

## Constraints

- No Git system (yet)
- No plugins
- No CRDT
- No advanced sandbox

---

## Definition of Done

- Can modify a real project from phone
- Minimal typing required
- AI output understandable and actionable
