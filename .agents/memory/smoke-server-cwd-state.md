---
name: Smoke-spawned api-server writes repo-root data/
description: Spawning the built api-server from repo cwd persists data/rooms.json, which auto-commits and trips publish-inventory
---

Any script that spawns the built api-server (smoke tests, local runs) with cwd at the repo root lets the server write its default room-state file to `data/rooms.json` at the TOP LEVEL of the repo.

**Why:** the platform auto-commit picks the stray `data/` dir up, and the publish-inventory guard then fails with `UNCLASSIFIED: tracked top-level entry "data"` (plus `test:publish-inventory` "source mode against the real tree" assertions).

**How to apply:** always set `ROOM_STATE_FILE` to a tmp path in the spawn env (see `artifacts/api-server/scripts/smoke-serve-static.mjs`). If `data/` already got committed, deleting it from disk is enough — the next platform commit records the removal; do not run git commands yourself.
