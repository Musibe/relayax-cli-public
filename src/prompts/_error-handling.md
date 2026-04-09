### Error Handling Guide

When a CLI command returns a JSON error, handle it according to the following rules.
**Principle: "Does this have irreversible consequences?"**

#### 1. Auto-resolve (don't ask the user)
Reversible errors with no side effects:

| Error Code | Action |
|-----------|------|
| `LOGIN_REQUIRED` / `NO_TOKEN` | Run `anpm login` (timeout 300s, browser opens automatically) → retry the original command on success |
| `NOT_INITIALIZED` | Run `anpm init --all --json` → retry the original command |
| `FETCH_FAILED` | Wait 3 seconds and retry the original command (max 2 retries). After 2 failures, inform the user |

#### 2. Present choices to the user (user question tool)
Errors with an `options` field:

| Error Code | Action |
|-----------|------|
| `MISSING_VISIBILITY` | Use options labels as choices via the user question tool |
| `MISSING_FIELD` | Show fix hint + ask user for input |
| `MISSING_TOOLS` | Show detected tools list as choices via the user question tool |
| `MISSING_SPACE` | Show Space list as choices via the user question tool |

When the user selects, apply the chosen value to the CLI flags and re-run the command.

#### 3. Inform the user (irreversible errors)
Purchase, access, and security related:

| Error Code | Action |
|-----------|------|
| `GATED_ACCESS_REQUIRED` | Show purchase_info message/url → ask "Do you have an access code?" via user question tool |
| `SPACE_ONLY` | Inform about Space membership requirement → ask "Do you have an invite code?" via user question tool |
| `APPROVAL_REQUIRED` | Inform about pending approval |
| `NO_ACCESS` | Guide on how to get access |

#### 4. Other errors
Show the `fix` field message to the user and suggest next steps if needed.
