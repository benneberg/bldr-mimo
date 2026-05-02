# bldr-mimo Tasks (Execution Mode)

## 🎯 Goal
Convert current Gemini-based system into a MiMo-powered mobile AI execution tool.

---

## 🔴 CRITICAL (Must Do First)

### 1. Replace Gemini → MiMo

- [ ] Remove Gemini API integration
- [ ] Implement MiMo API client
- [ ] Support tool/function calling (per MiMo docs)
- [ ] Validate streaming or response format

**Output must be structured** (see below)

---

### 2. Define AI Response Schema

MiMo must return:

```json
{
  "changes": [
    {
      "file": "path/to/file.js",
      "description": "What this change does",
      "content": "full updated file or patch"
    }
  ]
}
* Add validation layer
* Reject malformed responses

⸻

3. Block-Based Rendering (Core UX)

* Transform AI response → UI blocks
* Each block:
    * file name
    * short description
    * preview snippet
* Add:
    * Accept button
    * Reject button

⸻

4. Apply Changes Safely

* Stage changes in memory
* Apply only on Accept
* Reject discards change

⸻

🟠 IMPORTANT (Do Next)

5. Simplify CCC (TEMP)

* Keep WORKSPACE.md
* Keep basic CONTEXT.md
* Disable heavy regeneration logic
* Ensure fast updates (<1–2s)

⸻

6. Basic Watcher

* Detect file changes (chokidar)
* Refresh UI + CCC (simple)

⸻

7. Prompt Layer (MiMo Optimization)

* Create base system prompt
* Inject:
    * user intent
    * relevant files
    * CCC summary

⸻

🟡 OPTIONAL (If Time)

8. Export

* Download workspace as ZIP
    OR
* Export diff as patch

⸻

9. Simple Search

* Filename search
* Basic grep

⸻

❌ DO NOT BUILD (Now)

* GitHub full sync
* CRDT collaboration
* Plugin system
* Marketplace
* Multi-model support
* Advanced sandboxing

⸻

✅ Definition of Done

* Can modify a real repo from mobile
* AI produces usable changes
* User can approve/reject easily
* Files update correctly
