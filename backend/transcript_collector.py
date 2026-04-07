#!/usr/bin/env python3
"""
Sammelt Token-Usage aus OpenClaw Session-Transcripts.
Mapped Session-IDs zu Nutzern via openclaw sessions list.
Aggregiert pro Tag + Nutzer + Model → SQLite.
"""
import json
import glob
import os
import sys
import subprocess
from datetime import datetime
from collections import defaultdict
from sqlalchemy.orm import Session as DBSession

# Allow imports when run standalone or as module
sys.path.insert(0, os.path.dirname(__file__))
from db import get_db, create_tables, TokenUsage
import config


def _sessions_dir():
    return config.get_sessions_dir()

def _all_sessions_dirs():
    """Return session dirs for ALL agents, not just main."""
    base = config.get_agents_base()
    dirs = []
    for agent_dir in glob.glob(os.path.join(base, '*/sessions')):
        if os.path.isdir(agent_dir):
            dirs.append(agent_dir)
    return dirs if dirs else [_sessions_dir()]

def _pricing():
    return config.get_pricing_table()

def _default_pricing():
    return config.get_default_pricing()

def _known_sessions():
    return config.get_known_sessions()

def _sender_id_map():
    return config.get_sender_id_map()

def _user_display_map():
    return config.get_user_display_map()

def _channel_map():
    return config.get_channel_map()


def build_session_id_map() -> dict:
    """Map session UUIDs to user category using known IDs + transcript heuristics."""
    sid_map = {}
    
    # 1. Known session IDs (from config)
    for sid, user in _known_sessions().items():
        sid_map[sid] = user.lower()
    
    # 2. Scan transcripts for cron markers in files not yet mapped
    sender_ids = _sender_id_map()
    all_jsonl = []
    for sdir in _all_sessions_dirs():
        all_jsonl += glob.glob(os.path.join(sdir, "*.jsonl")) + glob.glob(os.path.join(sdir, "*.jsonl.reset.*"))
    for fpath in all_jsonl:
        sid = os.path.basename(fpath).split('.jsonl')[0]
        if sid in sid_map:
            continue
        
        try:
            with open(fpath) as f:
                for i, line in enumerate(f):
                    if i > 30:  # Only check first 30 lines for performance
                        break
                    entry = json.loads(line)
                    if entry.get('type') != 'message':
                        continue
                    msg = entry.get('message', {})
                    if not isinstance(msg, dict):
                        continue
                    
                    # Check content for [cron: marker
                    content = msg.get('content', '')
                    txt = ''
                    if isinstance(content, list):
                        for c in content:
                            if isinstance(c, dict):
                                txt += c.get('text', '')
                    elif isinstance(content, str):
                        txt = content
                    
                    if '[cron:' in txt:
                        sid_map[sid] = 'cron'
                        break
                    
                    # Check for Telegram sender IDs in inbound metadata
                    for sid_id, sid_name in sender_ids.items():
                        if f'"sender_id": "{sid_id}"' in txt or f'"sender_id":"{sid_id}"' in txt:
                            sid_map[sid] = sid_name
                            break
                    if sid in sid_map:
                        break
        except:
            continue
        
        if sid not in sid_map:
            sid_map[sid] = 'subagent'  # Remaining are subagents spawned by users
    
    return sid_map


def extract_usage_from_transcripts(sid_map: dict):
    """Extract token usage from all session transcript .jsonl files."""
    
    channel_map = _channel_map()
    
    # (date, user_category, model, channel) -> aggregated usage
    usage_by_day = defaultdict(lambda: {
        'tokens_input': 0, 'tokens_output': 0,
        'tokens_cache_write': 0, 'tokens_cache_read': 0,
        'cost_total': 0,
    })
    
    jsonl_files = []
    for sdir in _all_sessions_dirs():
        jsonl_files += glob.glob(os.path.join(sdir, "*.jsonl")) + glob.glob(os.path.join(sdir, "*.jsonl.reset.*"))
    print(f"Scanning {len(jsonl_files)} session files across {len(_all_sessions_dirs())} agents...")
    
    total_messages = 0
    
    for fpath in jsonl_files:
        sid = os.path.basename(fpath).split('.jsonl')[0]
        user_cat = sid_map.get(sid, 'unknown')
        
        try:
            with open(fpath) as f:
                for line in f:
                    try:
                        entry = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    
                    if entry.get('type') != 'message':
                        continue
                    
                    msg = entry.get('message', {})
                    if not isinstance(msg, dict):
                        continue
                    
                    usage = msg.get('usage')
                    if not usage or not isinstance(usage, dict):
                        continue
                    if not usage.get('totalTokens', 0):
                        continue
                    
                    provider = msg.get('provider', 'unknown')
                    model = msg.get('model', 'unknown')
                    if provider == 'openclaw':
                        continue
                    
                    ts = msg.get('timestamp', 0)
                    if not ts:
                        continue
                    date_str = datetime.utcfromtimestamp(ts / 1000).strftime('%Y-%m-%d')
                    
                    tokens_input = usage.get('input', 0) or 0
                    tokens_output = usage.get('output', 0) or 0
                    tokens_cache_write = usage.get('cacheWrite', 0) or 0
                    tokens_cache_read = usage.get('cacheRead', 0) or 0
                    
                    cost_data = usage.get('cost', {})
                    if isinstance(cost_data, dict) and cost_data.get('total', 0) > 0:
                        cost_total = cost_data['total']
                    else:
                        p = _pricing().get(model, _default_pricing())
                        cost_total = (
                            (tokens_input / 1e6) * p['input'] +
                            (tokens_output / 1e6) * p['output'] +
                            (tokens_cache_write / 1e6) * p['cache_write'] +
                            (tokens_cache_read / 1e6) * p['cache_read']
                        )
                    
                    channel = channel_map.get(user_cat, 'system')
                    key = (date_str, user_cat, model, channel)
                    agg = usage_by_day[key]
                    agg['tokens_input'] += tokens_input
                    agg['tokens_output'] += tokens_output
                    agg['tokens_cache_write'] += tokens_cache_write
                    agg['tokens_cache_read'] += tokens_cache_read
                    agg['cost_total'] += cost_total
                    total_messages += 1
                    
        except Exception:
            continue
    
    print(f"Extracted {total_messages} usage records")
    return dict(usage_by_day)


def save_to_db(usage_data: dict):
    """Save aggregated usage to SQLite via UPSERT."""
    create_tables()
    db = next(get_db())
    
    try:
        upserted = 0
        for (date_str, user_cat, model, channel), data in usage_data.items():
            display_map = _user_display_map()
            api_key = display_map.get(user_cat, user_cat)
            
            # Calculate individual cost components
            pricing = _pricing().get(model, _default_pricing())
            cost_input = (data['tokens_input'] / 1e6) * pricing['input']
            cost_output = (data['tokens_output'] / 1e6) * pricing['output']
            cost_cache_write = (data['tokens_cache_write'] / 1e6) * pricing['cache_write']
            cost_cache_read = (data['tokens_cache_read'] / 1e6) * pricing['cache_read']
            
            # UPSERT: Find existing record or create new one
            existing = db.query(TokenUsage).filter(
                TokenUsage.date == date_str,
                TokenUsage.source == 'transcript',
                TokenUsage.api_key == api_key,
                TokenUsage.model == model
            ).first()
            
            if existing:
                # Update existing record
                existing.tokens_input = data['tokens_input']
                existing.tokens_output = data['tokens_output']
                existing.tokens_cache_write = data['tokens_cache_write']
                existing.tokens_cache_read = data['tokens_cache_read']
                existing.cost_input = cost_input
                existing.cost_output = cost_output
                existing.cost_cache_write = cost_cache_write
                existing.cost_cache_read = cost_cache_read
                existing.cost_total = data['cost_total']
                existing.channel = channel
            else:
                # Create new record
                record = TokenUsage(
                    date=date_str,
                    source='transcript',
                    api_key=api_key,
                    model=model,
                    channel=channel,
                    tokens_input=data['tokens_input'],
                    tokens_output=data['tokens_output'],
                    tokens_cache_write=data['tokens_cache_write'],
                    tokens_cache_read=data['tokens_cache_read'],
                    cost_input=cost_input,
                    cost_output=cost_output,
                    cost_cache_write=cost_cache_write,
                    cost_cache_read=cost_cache_read,
                    cost_total=data['cost_total'],
                )
                db.add(record)
            upserted += 1
        
        db.commit()
        print(f"Upserted {upserted} transcript records")
        
    except Exception as e:
        print(f"Error saving to DB: {e}")
        db.rollback()
    finally:
        db.close()


if __name__ == "__main__":
    print(f"=== Transcript Collector {datetime.now().strftime('%Y-%m-%d %H:%M')} ===")
    sid_map = build_session_id_map()
    cats = defaultdict(int)
    for v in sid_map.values():
        cats[v] += 1
    print(f"Session mapping: {dict(cats)}")
    
    usage_data = extract_usage_from_transcripts(sid_map)
    save_to_db(usage_data)
    print("Done.")
