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

# 2. SECRET GATE — refuses to proceed on a live credential value (read at
#    runtime from gitignored sources; the script itself contains NO secrets)
#    OR on anything shaped like a credential / assigned to a credential NAME,
#    which is how the rotated-token and pasted-into-source leaks get caught
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

Two tiers, both mandatory. A hit in either exits 1.

### Tier 1 — value-based (live values read at runtime)

1. Reads live secret VALUES from `Home-ai/.env.local`, the outer `.env.local`, and the `sshpass -p '…'` strings in `DEPLOY_NAS_LOCAL.md` (skips placeholders: empty, `<8` chars, `your_*`, `changeme`, `REPLACE_*`, `<*…>`).
2. Scans every commit in `origin/<branch>..HEAD` (`git log -S<pickaxe>`) **and** the staged diff — catches values introduced anywhere in what's about to leave the machine.
3. On a hit: prints ONLY the key name + offending commits/paths — never the value — and exits 1.
4. Optional NAS cross-check (`bash scripts/security/push-safe.sh --nas`): pulls `/tmp/new.env` values over SSH (creds from the local runbook) so values that exist only on the NAS (e.g. `CRON_SECRET`) are covered too.

### Tier 2 — shape + name-based (added 2026-10-03)

**Why it exists.** Tier 1 can only compare against credential values this Mac happens to have. It is structurally blind to a credential that was committed and later **rotated** (the committed value no longer matches the local one), to a credential from a machine or env file we don't have, and to anything **pasted straight into source**. That blind spot is how a live Telegram bot token reached `scripts/restart-consuela.sh` on a public-ish remote: the 2026-09-08 redaction commit `6ce58c0` touched that very file and only replaced `HERMES_API_KEY`, and the gate still reported `CLEAN`.

Tier 2 needs no copy of the credential, so it sees what Tier 1 cannot.

1. **Tier A — shape rules.** The value's *shape* alone fires, anywhere, in any file, with no placeholder exemption (a rotated credential is still a credential): Telegram bot tokens, GitHub `ghp_/gho_/ghu_/ghs_/ghx_` + `github_pat_`, `sk-`, `sk-ant-`, `AIza`, `AKIA`/`ASIA`/`ABIA`/`ACCA`/`AIDA`/`AROA`, Slack `xox[baprs]-` + webhook URLs, Stripe `*_live_*`, PEM `BEGIN … PRIVATE KEY`, and 3-segment JWTs. The table lives at the top of `scripts/security/push-safe.sh` — one commented line per rule.
2. **Tier B — name rule.** A variable whose NAME matches `*_?(KEYS?|TOKENS?|SECRETS?|PASSWORDS?|PASSWD|PWD|PASS|CREDENTIALS?)*` (plus the idiomatic JS/TS names `apiKey`, `botToken`, `sessionSecret`, `accessToken`, `token`, `password`, …) holds a value that is **not** a documented placeholder. Env files, JS/TS, shell, YAML and markdown prose all match — the 2026-09-08 wave leaked through `AGENTS.md` prose and `.env.docker`, not only through code.
3. Scopes: tracked worktree, untracked-but-not-ignored files (what a later `git add` would sweep in), the staged diff, and the **added** lines of `origin/<branch>..HEAD`. `--all` extends the history scope to the whole branch.
4. **Redaction commits do not block themselves:** only `+` lines are scanned. A commit that *removes* a credential is the fix, and must not block its own push.
5. On a hit: prints `shape/<rule-id>` or `name/<KEY-NAME>` plus the scope and `file:line` — **never the value**, in any mode.

**"Obvious placeholder" is defined precisely** (and implemented in `value_is_credential()`): a value is *not* a credential if it is empty or under 12 chars; contains whitespace, `< > $ ( ) { } | #` (this covers every `<REDACTED-NAME>`); is a URL, a path, a pure number, or a dotted identifier chain (`process.env.X`); is one character repeated ≥12 times; has a `_ - . : /`-separated segment that is a documented template marker (`test dev demo mock fake dummy sample placeholder redacted change your example replace xxx unsafe env spec todo notreal nosecret`); or is *readable* — ≤48 chars, only `[A-Za-z0-9._+*/~!-]`, and ≥18% vowels. That last test is measured, not guessed: this repo's whole storage-key corpus (`consuela-events`, `consuela-rewards-updatedAt`, `tasks-snapshot`, `last_telegram_update_id`, `member-admin`) lands at 21%+ vowels while sampled hex/base64 secrets land at 12% or below.

### `--self-test`

```bash
bash scripts/security/push-safe.sh --self-test    # 17 checks, exit 0
```

Proves Tier 2 **catches** planted fakes (Telegram token, `sk-` key, `ghp_` PAT, JWT, PEM header, and bare base64/hex assigned to a credential name), **does not fire** on the repo's real placeholder corpus (a verbatim copy of `.env.example` plus every `<REDACTED-*>` / marker / slug / reference form), **never prints** a planted value, and that the planted values do not exist anywhere in the tree — i.e. that only shape/name detection can see them. Every planted value is an obvious fake assembled from fragments at runtime inside `$TMPDIR`; the gate would otherwise trip over its own committed test data.

## Gotchas (all hit for real)

1. **`git add .` at the outer repo sweeps the submodule's whole tree** + unrelated junk — stage the `Home-ai` gitlink and named files only.
2. **A secret already in history stays leaked after a scrub** — the 2026-09-08 wave found the SSH pw in `AGENTS.md` + `.env.docker` since August; redaction fixed the tip, rotation is the actual fix.
3. **Untracked-but-scanned:** push-safe checks the *staged* diff too, so committing a secret is caught before it lands — and Tier 2 also reads untracked-but-not-ignored files, so a secret in a file you haven't staged yet is still visible.
4. **`--all` is expected to go red.** A deep audit scans the whole branch history, so it will flag the 2026-09-08 credential still sitting in pushed commits. That is the point: the tip was scrubbed, history was not, and the only real fix is **rotation** (force-push stays forbidden by AGENTS.md). The default run stays green because it only looks at what this push is adding.
5. **`version.json`** regenerates on build and may drift — fine to commit or leave out, never a secret.
6. **The LLM must END every completed update with the deploy question** — "Deploy to NAS now?" — see AGENTS.md §3.2.
