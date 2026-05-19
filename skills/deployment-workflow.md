# 🚀 Skill: Deployment Workflow & NAS Sync

## The Deployment Sequence

Any time you edit a `.tsx` or `.ts` file, you MUST follow this exact sequence. Skipping a step will leave the dashboard running stale code.

1. **Write the code**
   - Action: `write_file`
2. **Validate**
   - Action: `validate_and_build`
   - Wait for confirmation that there are 0 TypeScript errors.
3. **Rebuild the Container**
   - Action: `trigger_rebuild` (alerts the user to run the script) OR
   - Run the SSH command manually if authorized.

## NAS SSH Commands Cheat Sheet

**SSH Connection:** `ssh admin@192.168.0.27`
**Project Directory:** `cd /share/Container/home-dashboard`

| Task | Command |
|---|---|
| **Full Rebuild** | `/share/CACHEDEV1_DATA/.qpkg/container-station/bin/docker compose -f nas-docker-compose.yml up -d --build` |
| **Live Logs** | `/share/CACHEDEV1_DATA/.qpkg/container-station/bin/docker compose -f nas-docker-compose.yml logs -f home-dashboard` |
| **Restart Only** | `/share/CACHEDEV1_DATA/.qpkg/container-station/bin/docker compose -f nas-docker-compose.yml restart home-dashboard` |

## GitHub Sync Protocol

When you finish a major set of changes, always push to GitHub so the user's repository is updated.

```bash
git -C /Users/garciafam/openclaw/new/home-ai-app add -A
git -C /Users/garciafam/openclaw/new/home-ai-app commit -m "feat: description of change"
git -C /Users/garciafam/openclaw/new/home-ai-app push origin main
```
