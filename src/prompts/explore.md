Find and recommend agents that match your project, then install them.

## Project Analysis

Analyze the current project's tech stack, structure, and patterns:
- Frameworks/libraries in use (package.json, import patterns)
- Project structure (directory layout, key files)
- Already installed agents (`anpm list --json`)

## Agent Search

Search using `anpm search <keyword>`.
Choose keywords based on project context (tech stack, task type, etc.).
Search with multiple keywords for broader discovery.

## Recommendation

Recommend the best-fitting agents from the search results:
- Explain why each is relevant to the project context
- Summarize key commands/features of each agent

## Installation

When the user selects an agent, run `anpm install <slug>`.

Scope guidelines:
- General-purpose tools (code review, docs, testing) → `anpm install <slug>` (global default)
- Project-specific (particular framework, team conventions) → `anpm install <slug> --local`

{{ERROR_HANDLING_GUIDE}}
