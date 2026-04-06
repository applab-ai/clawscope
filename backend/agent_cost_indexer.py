#!/usr/bin/env python3
"""
Agent Cost Indexer — parses ALL JSONL session files across all agents,
extracts date + agent + model + tokens + cost per message,
aggregates per day+agent and writes to the DB.

Runs every 60 min via cron or collector.
First run: full index. After that: only new/changed files (mtime-based).
"""
import json
import glob
import os
import sqlite3
from datetime import datetime
from collections import defaultdict

DB_PATH = os.path.join(os.path.dirname(__file__), '..', 'data', 'status.db')
import sys
sys.path.insert(0, os.path.dirname(__file__))
import config

AGENTS_BASE = config.get_agents_base()
STATE_FILE = os.path.join(os.path.dirname(__file__), '..', 'data', 'indexer-state.json')

# Agent labels — override in config.yaml under agent_labels
AGENT_LABELS = {
    'main': 'Main',
    'worker': 'Worker (Crons)',
    'gclight': 'Light',
    'research': 'Research',
    'strategie': 'Strategie',
    'qs': 'QS',
    'verlag': 'Verlag',
    'phone': 'Phone',
}


def load_state():
    """Load mtime state from previous run."""
    if os.path.exists(STATE_FILE):
        with open(STATE_FILE) as f:
            return json.load(f)
    return {}


def save_state(state):
    with open(STATE_FILE, 'w') as f:
        json.dump(state, f)


def parse_jsonl_file(filepath, agent_id):
    """Parse a single JSONL file and return per-day cost aggregates."""
    # day -> {cost, input, output, cache_r, cache_w, model}
    daily = defaultdict(lambda: {
        'cost': 0.0, 'input': 0, 'output': 0,
        'cache_r': 0, 'cache_w': 0, 'model': ''
    })

    try:
        with open(filepath) as f:
            for line in f:
                try:
                    d = json.loads(line.strip())
                    if d.get('type') != 'message':
                        continue

                    ts = d.get('timestamp', '')
                    if not ts or len(ts) < 10:
                        continue
                    day = ts[:10]  # YYYY-MM-DD

                    msg = d.get('message', {})
                    usage = msg.get('usage', {})
                    cost_data = usage.get('cost', {})
                    total_cost = cost_data.get('total', 0) or 0

                    if total_cost <= 0:
                        continue

                    entry = daily[day]
                    entry['cost'] += total_cost
                    entry['input'] += usage.get('input', 0) or 0
                    entry['output'] += usage.get('output', 0) or 0
                    entry['cache_r'] += usage.get('cacheRead', 0) or 0
                    entry['cache_w'] += usage.get('cacheWrite', 0) or 0
                    if not entry['model']:
                        entry['model'] = msg.get('model', '')

                except (json.JSONDecodeError, KeyError):
                    continue
    except Exception as e:
        print(f"  Error reading {filepath}: {e}")

    return dict(daily)


def run_indexer(full_reindex=False):
    start = datetime.now()
    print(f"=== Agent Cost Indexer {start.strftime('%Y-%m-%d %H:%M')} ===")

    state = {} if full_reindex else load_state()
    new_state = {}

    # Collect all data: (date, agent) -> aggregated costs
    all_data = defaultdict(lambda: {
        'cost': 0.0, 'input': 0, 'output': 0,
        'cache_r': 0, 'cache_w': 0, 'model': ''
    })

    files_processed = 0
    files_skipped = 0

    for agent_dir in sorted(glob.glob(os.path.join(AGENTS_BASE, '*/sessions'))):
        agent_id = agent_dir.split('/agents/')[1].split('/')[0]

        for jf in glob.glob(os.path.join(agent_dir, '*.jsonl')):
            if '.deleted.' in jf:
                continue

            mtime = os.path.getmtime(jf)
            prev_mtime = state.get(jf, 0)
            new_state[jf] = mtime

            # Skip if not modified since last run
            if not full_reindex and mtime <= prev_mtime:
                files_skipped += 1
                continue

            daily = parse_jsonl_file(jf, agent_id)
            for day, data in daily.items():
                key = (day, agent_id)
                entry = all_data[key]
                entry['cost'] += data['cost']
                entry['input'] += data['input']
                entry['output'] += data['output']
                entry['cache_r'] += data['cache_r']
                entry['cache_w'] += data['cache_w']
                if not entry['model']:
                    entry['model'] = data['model']

            files_processed += 1

    print(f"Processed {files_processed} files, skipped {files_skipped} unchanged")

    if not all_data:
        print("No new data to write")
        save_state(new_state)
        return

    # Write to DB
    db = sqlite3.connect(DB_PATH)

    # For modified files, we need to recalculate the full day
    # So delete existing agent entries for affected dates and rewrite
    affected_dates = set(day for day, _ in all_data.keys())

    if full_reindex:
        db.execute("DELETE FROM token_usage WHERE source='agent'")
        print(f"Full reindex: cleared all agent entries")
    else:
        # Only delete entries for dates+agents we actually recalculated
        recalc_keys = set((day, agent) for day, agent in all_data.keys() if all_data[(day, agent)]['cost'] > 0)
        for date, agent in recalc_keys:
            db.execute(
                "DELETE FROM token_usage WHERE source='agent' AND date=? AND api_key=?",
                (date, agent)
            )

    # No $0 entries — only agents with actual costs are shown

    inserted = 0
    for (day, agent_id), data in sorted(all_data.items()):
        try:
            db.execute(
                """INSERT OR REPLACE INTO token_usage 
                   (date, source, api_key, model, tokens_input, tokens_output,
                    tokens_cache_read, tokens_cache_write, cost_total,
                    cost_input, cost_output, cost_cache_read, cost_cache_write)
                   VALUES (?, 'agent', ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0)""",
                (day, agent_id, data['model'],
                 data['input'], data['output'], data['cache_r'], data['cache_w'],
                 data['cost'])
            )
            inserted += 1
        except Exception as e:
            print(f"  DB error for {day}/{agent_id}: {e}")

    db.commit()
    db.close()
    save_state(new_state)

    total_cost = sum(d['cost'] for d in all_data.values())
    elapsed = (datetime.now() - start).total_seconds()
    print(f"Inserted {inserted} entries across {len(affected_dates)} dates")
    print(f"Total cost indexed: ${total_cost:.2f}")
    print(f"Done in {elapsed:.1f}s")


if __name__ == '__main__':
    import sys
    full = '--full' in sys.argv
    run_indexer(full_reindex=full)
