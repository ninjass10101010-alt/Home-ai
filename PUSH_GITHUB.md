# 🚀 GITHUB PUSH RUNBOOK — SAFE PUSH TO PUBLIC REMOTES

> Both remotes are **public-ish** (`github.com/ninjass10101010-alt/*`). A leaked credential is a permanent burn — rotation is the only fix, scrubbing the tip only stops new bleeding. This is the push twin of `DEPLOY_NAS_LOCAL.md` (which stays local-only because it holds the SSH password).
> **Mandatory:** After any code change, update `AGENTS.md` in the same session, then follow this flow.

## Remotes & branches

| Repo | Remote | Branch | Push command |
|---|---|---|---|
| `Home-ai/` (submodule) | `git@github.com:ninjass10101010-alt/Home-ai.git` | `warm-glass-v2` | `git push origin warm-glass-v2` |
| `Dashboard` (outer) | `git@github.com:ninjass10101010-alt/Dashboard.git` | `main` | bump gitlink → `git push origin main` |

## Standard push flow (from the Mac)

```bash
cd /Users/garciafam/Documents/Dashboard/Home-ai        # must be on warm-glass-v2

# 1. Gates first — never push what you haven't verified
npx tsc --noEmit && npx vitest run && npm run build

# 2. SECRET GATE — refuses to proceed if any commit about to be pushed
#    contains a live credential value (live values are read at runtime from
#    gitignored sources; the script itself contains NO secrets)
bash scripts/security/push-safe.sh

# 3. Push the submodule
git push origin warm-glass-v2

# 4. Bump + push the outer repo (only the gitlink + your own outer changes)
cd ..
git add Home-ai                       # ⚠️ stage the gitlink ONLY — never `git add .`
git commit -m "chore(submodule): Home-ai -> <what shipped>"
bash scripts/security/push-safe.sh    # scan the outer repo too (its own remotes/history)
git push origin main

# 5. ALWAYS ASK THE USER: "Deploy to NAS now?" (see DEPLOY_NAS_LOCAL.md)
#    Never deploy unilaterally; never skip the question.
```

## Secrets policy (the whole point)

**Never commit — placeholders/env-refs only:**
- Anything matching `*_SECRET`, `*_PASS*`, `*_TOKEN`, `*_KEY`, `*_PASSWORD` with a real value
- SSH passwords / `sshpass -p '…'` strings, PB admin creds, VAPID/Telegram/Gmail/OAuth/Hermes/OpenRouter/Composio/Greenlight/Khan keys
- Contents of `.env.local`, `.env`, `/tmp/new.env`, `DEPLOY_NAS_LOCAL.md`

**Where real values live (all gitignored):**

| File | Holds | Backed up |
|---|---|---|
| `Home-ai/.env.local` + outer `.env.local` | dev runtime secrets (point at live LAN) | local only |
| `Home-ai/DEPLOY_NAS_LOCAL.md` | NAS SSH creds + runbook | local only |
| NAS `/tmp/new.env` + NAS deploy-dir `.env.local` | container runtime env | NAS |
| Settings → Services & Keys / AI Models | integration keys (AES-256-GCM in PB) | encrypted at rest |

**Tracked env files are placeholders ONLY:** `.env.example` and `.env.docker`. ⚠️ Gotcha: `.env.docker` is TRACKED (committed before the `.env*` ignore rule), so gitignore does NOT protect it — anything written there ships. Keep it placeholder-only; `push-safe.sh` scans it every run.

**If push-safe flags a value:** replace it with `<REDACTED-NAME>` placeholders in the tracked file (local gitignored copies keep the real value), verify nothing else references it in code paths that need truth, re-run the scan, then push. If a secret was EVER pushed, treat it as burned: rotate it (NAS admin password, the provider key, PB pass as applicable) — history rewrite needs explicit human approval (force-push is otherwise forbidden by AGENTS.md).

## What push-safe.sh does

1. Reads live secret VALUES at runtime from `Home-ai/.env.local`, the outer `.env.local`, and the `sshpass -p '…'` strings in `DEPLOY_NAS_LOCAL.md` (skips placeholders: empty, `<6` chars, `your_*`, `changeme`, `REPLACE_*`, `<*…>`).
2. Scans every commit in `origin/<branch>..HEAD` (`git log -S<pickaxe>`) **and** the staged diff — catches values introduced anywhere in what's about to leave the machine.
3. On a hit: prints ONLY the key name + offending commits/paths — never the value — and exits 1.
4. Optional NAS cross-check (`bash scripts/security/push-safe.sh --nas`): pulls `/tmp/new.env` values over SSH (creds from the local runbook) so values that exist only on the NAS (e.g. `CRON_SECRET`) are covered too.

## Gotchas (all hit for real)

1. **`git add .` at the outer repo sweeps the submodule's whole tree** + unrelated junk — stage the `Home-ai` gitlink and named files only.
2. **A secret already in history stays leaked after a scrub** — the 2026-09-08 wave found the SSH pw in `AGENTS.md` + `.env.docker` since August; redaction fixed the tip, rotation is the actual fix.
3. **Untracked-but-scanned:** push-safe checks the *staged* diff too, so committing a secret is caught before it lands.
4. **`version.json`** regenerates on build and may drift — fine to commit or leave out, never a secret.
5. **The LLM must END every completed update with the deploy question** — "Deploy to NAS now?" — see AGENTS.md §3.2.
