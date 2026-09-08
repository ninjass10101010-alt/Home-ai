# Consuela → Obsidian memory agent (Mac)

Zero-dependency Node script that pulls the family's Consuela memories every 15
minutes into the Obsidian vault as markdown notes — a one-way mirror; PocketBase
(the dashboard's DB) is the source of truth.

## Install

1. Create `~/.config/consuela/memory-agent.json` (mkdir -p the dir, chmod 600
   the file — it holds the CRON_SECRET, never commit it):

   ```json
   { "dashboardUrl": "http://<dashboard-host>:3000",
     "cronSecret": "<the dashboard's CRON_SECRET value>",
     "vaultDir": "<absolute path to the Obsidian vault folder>" }
   ```

2. Fix the plist's two paths (absolute node path via `which node`, and the
   script's absolute path replacing `REPLACE_WITH_REPO_ABS_PATH`), then:

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

- Same memory id → same filename → safe overwrite (idempotent re-runs); filenames
  are `{content-slug ≤40}-{id ≤12}.md`, so content edits update in place.
- Deletions are NOT propagated (stale notes stay until a cleanup pass); edits
  inside Obsidian never sync back — manage memories in the dashboard (/memory).
