# bldr Architecture

## 1. System Overview

bldr follows a **Workspace-Centric** architecture designed to bridge the gap between fragmented mobile interfaces and complex multi-repo codebases.

```
[ iPhone / Browser ] <--- SSE/JSON ---> [ Express Server ] <--- API ---> [ Gemini AI ]
                                              |
                                     [ SQLite + Filesystem ]
```

## 2. Data Schema (SQLite)

### `projects`
Stores the top-level workspace information and global configuration.
- `id`: UUID (Primary Key)
- `name`: Workspace display name
- `workspace_config`: JSON blob for CCC metadata

### `repositories`
Links multiple Git repositories to a single workspace.
- `id`: UUID
- `project_id`: Link to project
- `path_prefix`: The folder where the repo is stored (e.g., `services/api`)
- `tags`: Metadata for AI focus targeting (e.g., `backend, infra`)

### `files`
Flat registry of all files across all repositories.
- `path`: Normalized path within the workspace
- `repository_id`: The originating service

## 3. Context Layer (The CCC Strategy)

To keep token usage low while maintaining high AI comprehension, bldr generates "Context Artifacts" after every import or major change:

1. **WORKSPACE.md**: A flattened map of the entire directory structure.
2. **LLM.md**: A summarized extraction of package.json dependencies, file extensions, and common patterns to define the "Architectural Convention".
3. **Package-level CONTEXT.md**: Localized code summaries for individual services.

## 5. Search & Audit
- **Regex Search Engine**: Uses specialized backend tools to perform recursive GREP operations with support for symbol extraction.
- **AI Reviewer**: A separate Gemini Persona optimized for static analysis, using the `LLM.md` as the source of truth for project style and architecture.

## 6. Security & Interception
- **Sandbox Guard**: Injects a specialized error-tracking script into served HTML previews, piping runtime exceptions back to the editor via `postMessage` for immediate debugging.
- **Dry Run**: AI changes are staged in memory and presented as diffs, requiring explicit JSON approval before disk commit.

## 7. Architecture Visualization
- **Dependency Mapper**: Scans JS/TS imports periodically to construct a D3 directed force-graph of the workspace.
- **Health Watchdog**: Background process that executes workspace lints and build checks, surfacing "Healthy/Warning" states in the UI header.

## 8. Development Lifecycle
- **PR Simulation**: Session changes are passed to a summarization prompt that outputs a standard Pull Request format (Executive Summary, Detailed Changes, Risk Assessment).
- **Heuristic Semantic Search**: A hybrid approach using greedy keyword expansion and regex patterns to simulate semantic code discovery without a full vector database dependency.
