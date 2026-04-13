# Changelog
## [1.4.1] — 2026-04-13

### Fixed

- **Search results expand/collapse broken** — runKey used hyphen separator in search results but colon elsewhere; `expandedRuns` and `realRunDetails` never matched, so API-call details wouldn't load for search results.

## [1.4.0] — 2026-04-13

### Fixed

- **Timestamps now UTC-aware** — Backend appends `Z` suffix, browser displays local timezone correctly
- **API-Call records no longer missing** — Incremental parsing continues `turn_index` from last known DB value instead of restarting at 0
- **Session categorization** — Collector searches both JSON-escaped and unescaped `sender_id` patterns across entire file; assigns category by most frequent sender

### Added

- **Backend control panel** — Restart button in Overview with live PID + uptime display
- `/api/backend/status` and `/api/backend/restart` endpoints (LaunchAgent-aware with start.sh fallback)


All notable changes to Clawscope are documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [1.3.0] — 2026-04-11

### Added

- **Backend control panel** — Start, Stop, Restart buttons in Overview page with live PID + uptime display
- Backend API endpoints: `/api/backend/status`, `/api/backend/restart`, `/api/backend/stop`, `/api/backend/start`
- LaunchAgent-aware lifecycle management (launchctl kickstart/stop/bootstrap with start.sh fallback)

## [1.2.0] — 2026-04-11

### Fixed

- **Prompt collector integrity check** — detects stale session metadata (e.g. after `/new` resets) and forces re-parse when turn count is suspiciously low relative to file size
- **Session metadata sync** — `total_turns` in session record now auto-corrects when it drifts from actual DB turn count
- Bernds current session fully re-indexed (850 turns, 2845 API calls recovered)

### Changed

- Collector no longer silently skips large session files with broken metadata
- Integrity threshold: files >100KB with <5 indexed turns trigger automatic re-parse

## [1.1.0] — 2026-04-09

### Added

- **Dynamic agent discovery** — `/api/agents` endpoint scans agent directories instead of hardcoded list
- **Git-based version check** — replaces GitHub API compare with local `git rev-list` (avoids rate limits)
- **Channel filter** — filter Real Prompt Runs by user category (bernd/frank/crons/subagents)
- **Full-text search** — search messages & responses with debounced input and yellow match highlighting
- Frontend dist committed to repo (no more stale UI after `git reset --hard`)

### Fixed

- Search re-triggers correctly when agent/channel changes while query is active
- Plugin detection reads `openclaw.json` directly instead of parsing CLI stderr
- Update button works for both "behind" and "diverged" git states
- Transient fetch errors during backend restart silently suppressed on auto-refresh

## [1.0.3] — 2026-04-08

### Changed

- Bumped release version to 1.0.3 to force a client-visible update after small Prompt Visualizer fixes

## [1.0.2] — 2026-04-07

### Fixed

- Real Prompt Runs expand reliably inside the virtualized list without requiring a scroll-triggered reflow
- System Prompt page now lazy-loads heavy file contents and skills XML instead of blocking initial render

### Changed

- System Prompt metadata cache increased to reduce repeated expensive CLI work during normal navigation

## [1.0.0] — 2026-04-06

### Initial Release

- **Prompt Visualizer** — 7-step pipeline visualization (Bootstrap → Skills → Matching → Runtime → Context → Cache → Cost), simulate prompts or replay real historical runs with token/cost breakdown
- **Cost Analytics** — Spend tracking by model, user, agent, and time range (today, yesterday, 7d, 30d, custom)
- **Cost Insights** — 6 computed metrics: cost-per-message, cache savings, most expensive turn, output efficiency, cron cost/run, cron ROI
- **Prompt History** — Full conversation timeline with per-turn token and cost breakdown
- **Cron Monitoring** — Job status, schedules, run history, error tracking
- **Live Agents** — Real-time sub-agent visibility with tasks, tools, tokens, cost
- **Sessions** — Active session listing across all agent directories
- **System Prompt** — View assembled system prompt, workspace files, active skills
- **Collector Status** — Health monitoring for all data pipelines with live LaunchAgent detection
- **i18n** — English and German UI with browser auto-detection
- **Mobile-responsive** — Card-based layouts, dark theme tables, touch-optimized
- **Interactive installer** — One-line curl install, auto-generates config from sample
- **MIT License**
