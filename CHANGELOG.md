# Changelog

All notable changes to Clawscope are documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

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
