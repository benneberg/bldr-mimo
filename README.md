# bldr — Build Anywhere, Intelligently

**bldr** is a mobile-first, AI-powered development environment designed for high-density code iteration on the go. It implements deterministic AI tool control and automated context compilation to make solo development efficient and reliable.

## 🚀 Core Features

- **Multi-Repository Workspaces**: Import multiple GitHub repositories or local ZIP files into a single unified workspace.
- **CodeMirror Editor**: Full featured in-browser editor for manual code adjustments with syntax highlighting.
- **Dry Run Protection**: AI-proposed changes are intercepted and presented as a diff for user approval before being committed to disk.
- **AI File Analysis**: Specialized tool for heuristic code analysis, summarizing purpose and quality.
- **CCC (Code Context Compiler)**: Automatically generates `WORKSPACE.md` and `LLM.md` artifacts to provide the AI with structural and architectural awareness.
- **Sandbox Execution**: Integrated Terminal v1.0 in the Preview tab for running shell commands and inspecting runtime logs.
- **Real-time Collaboration**: Multi-user presence tracking and remote editor synchronization powered by Socket.io.
- **Information Hub**: Integrated project info panel with user guides, FAQs, and architectural insights.

## 🛠 Tech Stack

- **Frontend**: React + Vite + Tailwind CSS + Framer Motion
- **Backend**: Node.js + Express + SQLite (better-sqlite3)
- **AI**: Gemini 2.0/3.0 Flash with advanced Function Calling (Tool Use)
- **Context**: Code Context Compiler (CCC) methodology

## 📂 Workspace Structure

bldr workspaces use a flat hierarchy optimized for AI ingestion:
- `/WORKSPACE.md`: Global inventory of all connected repositories and services.
- `/LLM.md`: Registry of tech stack conventions and architectural rules.
- `/PKML.md`: Source of truth for product goals and requirements.
- `/services/{repo-name}`: The actual codebase for each attached repository.

## 📥 Getting Started

1. **Create a Workspace**: Start by naming your project.
2. **Attach Repositories**: Import one or more repositories via GitHub URL.
3. **Chat and Code**: Ask the AI to build features. It will use the generated context to understand the relationships between your services.
4. **Preview**: Verify your changes in the Live Preview tab.
