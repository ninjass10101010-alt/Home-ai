# Consuela → Obsidian memory agent (Mac)

Zero-dependency Node script that pulls the family's Consuela memories every
15 minutes and renders them as markdown notes into the Obsidian vault.
One-way mirror: PocketBase (the dashboard's DB) is the source of truth.

## Install

1. Create the config file (never commit it — it holds the CRON_SECRET):

   ```
   mkdir -p ~/.config/consuela
   $EDITOR ~/.config/consuela/memory-agent.json
   chmod 600 ~/.config/consuela/memory-agent.json
   ```

   Shape (placeholder values only):

   ```json
   { "dashboardUrl": "http://<dashboard-host>:3000",
     "cronSecret": "<the dashboard's CRON_SECRET value>",
     "vaultDir": "<absolute path to the Obsidian vault folder>" }
   ```

2. Fix the two paths inside the plist: the absolute node path (`which node`)
   and the absolute path to `consuela-memory-agent.mjs` in this repo
   (replacing `REPLACE_WITH_REPO_ABS_PATH`).

   ```
   cp scripts/obsidian-agent/com.garcia.consuela-memory-agent.plist ~/Library/LaunchAgents/
   launchctl load ~/Library/LaunchAgents/com.garcia.consuela-memory-agent.plist
   ```

## Verify

```
launchctl list | grep consuela
ls "<vaultDir>/Memory/Consuela"
tail -5 /tmp/consuela-memory-agent.log
```

## One-way contract

- Same memory id → same filename → safe overwrite (idempotent re-runs).
- Deletions in the dashboard are NOT propagated: a deleted memory leaves a
  stale note until a future cleanup pass.
- Edits made inside Obsidian are never synced back — edit memories in the
  dashboard (Consuela chat, or /memory).
