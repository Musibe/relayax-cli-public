Create or update an agent and publish it to anpm.
If anpm.yaml doesn't exist, create a new one. If it exists, apply changes.

> Builders work in a terminal environment. Run CLI commands directly.

## Core Principle: Ask the User at Decision Points

At each step, if there are **2 or more choices**, always ask the user and wait for their answer.
(Use a user input tool like AskUserQuestion.)
If there's only 1 choice or the decision can be made automatically, show the result and proceed.

### When user input is needed (stop and ask, wait for answer)
- 2+ sources detected → "Which content to include?"
- 1+ orgs available → "Personal or org deployment?"
- 2+ visibility options → "Select visibility"
- Positioning confirmation → Show analysis and ask "Proceed with this?"
- Final publish confirmation → Show anpm.yaml summary and ask "Publish?"

**After asking, always wait for the user's response before moving to the next step.**
Do not print a question as text and then answer it yourself.

### When to auto-proceed (no question needed)
- Only 1 source → auto-select, just show the result
- anpm.yaml exists and changes are clear → summarize and proceed
- Login needed → auto-run `anpm login`

## Branch: First-time Create vs Update

Check if `.anpm/anpm.yaml` exists.

- **Missing** → "First-time Create" flow below
- **Exists** → Check state with `anpm package --json`
  - `no_contents` error → legacy state without sources/contents in anpm.yaml. Run `anpm package --init --json` to scan sources, add them to anpm.yaml, then proceed with "Update" flow
  - Normal response → "Update" flow below

---

## First-time Create (no anpm.yaml)

### 1. Discover Content

Scan sources with `anpm package --init --json`.

- **2+ sources** → Show `sources[]` and **ask the user which content to include.** Wait for their answer before proceeding.
- **1 source** → Auto-select and show the result, then proceed.

Read the selected content files to understand capabilities:
- SKILL.md, agent files, command file contents
- Referenced skill/agent dependencies

### 2. Positioning

Position the agent as a "product" based on content analysis.

Analysis perspective:
- What does this agent **do**
- What **tech stack/domain** is it specialized for
- What **value** does it provide to installers

Name can be in any language. Slug must be lowercase ASCII + hyphens.
Description should be from the installer's perspective ("Automates ~").

Show positioning results in a table and **ask the user to confirm.**
("Proceed with this positioning? Let me know if you'd like changes.")

### 3. Requires Analysis + Security Check

Read content files and determine requires:

- **env**: Find environment variable references, determine required/optional from context
  - Used in core logic → `required: true`
  - Used in tests/optional features → `required: false`
  - Non-standard env vars (cookie, token) → recommend `setup_hint` with instructions
    - e.g.: `setup_hint: "1. Log in to klingai.com\n2. DevTools → Cookies\n3. Copy cookie string"`
    - Standard API keys (OPENAI_API_KEY etc.) only need a description
- **cli**: External CLI tool references (playwright, ffmpeg, etc.)
- **npm**: import/require packages
- **mcp**: MCP server references (supabase, github, etc.)
- **runtime**: Minimum Node.js/Python version
- **agents**: Dependencies on other anpm agents

Security check:
- Hardcoded API keys, tokens (sk-*, ghp_*, AKIA*, etc.)
- Hardcoded cookie values (Cookie:, Set-Cookie, session_id=, _ga=, etc.)
- Hardcoded Bearer/JWT tokens (Bearer ey..., Authorization:, etc.)
- 100+ character continuous alphanumeric/base64 strings (suspected secrets)
- Ignore placeholders: YOUR_XXX, <your-xxx>, sk-xxx, PASTE_HERE, etc.
- Read file context to distinguish real secrets vs example code
- If found, **always warn** and recommend using environment variables instead

### 4. Deployment Settings

Fetch org list with `anpm orgs list --json`.

**Always ask the user** (use AskUserQuestion or similar user input tool):
- **1+ orgs** → "Personal deployment / Deploy to {org name}"
- **No orgs** → "Personal deployment / Create new Organization"
  - If "Create new Organization" → run `anpm orgs create "name"` then deploy to that org

Based on selection, **ask the user about visibility:**
- **Without org**: `public`, `private` (2 options)
- **With org**: `public`, `private`, `internal` (3 options)
- `public` — anyone can discover and install (Org: anyone outside the org can use)
- `private` — only authorized users with an access code (Org: only authorized org members)
- `internal` — anyone in the organization (only available with org deployment)

### 5. Write anpm.yaml & Publish

Apply results to anpm.yaml:
- name, slug, description, version, tags
- requires (analysis results)
- org, visibility
- **recommended_scope** — default install scope:
  - `local` — if rules/ directory exists or has framework-specific tags (nextjs, react, vue, angular, svelte, nuxt, remix, astro, django, rails, laravel, spring, express, fastapi, flask)
  - `global` — otherwise (general-purpose tool)

**Ask the user for final confirmation** before publishing.

The publish command depends on the user's choice:
- **Personal**: `anpm publish --no-org --json`
- **Org**: `anpm publish --org {org_slug} --json`

Warning: Running `anpm publish --json` alone without `--no-org` or `--org` will cause an org selection error.

---

## Update (anpm.yaml exists)

### 1. Check Changes

Check current state with `anpm package --json`.
- Modified content (modified)
- Newly added content (new_items)

**Ask the user what they want to change:**
- Sync content changes
- Add new skills/commands
- Improve description/tags
- Re-analyze requires

### 2. Update Only What's Needed

Based on user request:
- **Add content**: Read new content files, understand capabilities → add to anpm.yaml contents
- **Change requires**: Re-read content and re-analyze requires
- **Improve description**: Analyze current positioning and suggest improvements
- **Security re-check**: Check for secrets/sensitive data

### 3. Publish

Show change summary and **ask the user for final confirmation** before publishing.

The publish command depends on the user's choice (or existing anpm.yaml setting):
- **Personal**: `anpm publish --no-org --json`
- **Org**: `anpm publish --org {org_slug} --json`
If version bump is needed, ask the user to confirm patch/minor/major.

---

## Post-publish Share Guide

Parse the `anpm publish --json` output and show:

1. **Publish summary** — slug, version, visibility, URL
2. **Install instructions** — already included as a code block in CLI output; share with the user:
   - CLI: `npx anpm install {slug}`
   - Agent info page URL
3. **Share text** — relay the share block (box) from CLI output as-is. It's a ready-to-paste code block for team sharing.

{{ERROR_HANDLING_GUIDE}}
