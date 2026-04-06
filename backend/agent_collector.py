#!/usr/bin/env python3
"""
Agent Collector — Parses OpenClaw session JSONLs to extract subagent runs
with task descriptions, tool calls, token usage, costs, and completion status.
"""

import json
import os
import re
import glob
import time
from datetime import datetime
from typing import Optional

import sys
sys.path.insert(0, os.path.dirname(__file__))
import config


def _sessions_dir():
    return config.get_sessions_dir()

def _pricing():
    return config.get_pricing_table()

def _default_pricing():
    return config.get_default_pricing()

def _sender_map():
    return config.get_sender_id_map()


def extract_text(content) -> str:
    """Extract text from message content (string or list of blocks)."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, dict) and block.get('type') == 'text':
                parts.append(block.get('text', ''))
        return '\n'.join(parts)
    return ''


def parse_subagent_task(text: str) -> Optional[str]:
    """Extract task description from subagent context message."""
    m = re.search(r'\[Subagent Task\]:\s*(.*?)(?:\n\n|\n##|\Z)', text, re.DOTALL)
    if m:
        return m.group(1).strip()[:2000]
    return None


def parse_subagent_depth(text: str) -> tuple:
    """Extract depth info from subagent context."""
    m = re.search(r'subagent \(depth (\d+)/(\d+)\)', text)
    if m:
        return int(m.group(1)), int(m.group(2))
    return 1, 1


def parse_subagent_label(text: str) -> Optional[str]:
    """Extract label from subagent context."""
    m = re.search(r'\[Subagent Label\]:\s*(.+?)(?:\n|$)', text)
    if m:
        return m.group(1).strip()
    return None


def parse_session_file(filepath: str) -> Optional[dict]:
    """Parse a single JSONL session file and return agent run info."""
    basename = os.path.basename(filepath)
    session_id = basename.split('.jsonl')[0]
    
    is_deleted = '.deleted.' in basename
    is_reset = '.reset.' in basename
    
    entries = []
    try:
        with open(filepath, 'r') as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    entries.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    except Exception:
        return None
    
    if not entries:
        return None
    
    # First entry should be session metadata
    session_entry = entries[0]
    if session_entry.get('type') != 'session':
        return None
    
    session_ts = session_entry.get('timestamp', '')
    
    # Classify session type from first user message
    session_type = 'unknown'
    is_subagent = False
    is_cron = False
    task = None
    label = None
    depth = (1, 1)
    parent_session = None
    requester = None
    
    # Track metrics
    tool_calls = []
    tool_results = []
    models_used = set()
    total_input = 0
    total_output = 0
    total_cache_read = 0
    total_cache_write = 0
    total_cost = 0.0
    api_calls = 0
    first_ts = None
    last_ts = None
    assistant_texts = []
    final_response = ''
    
    for entry in entries[1:]:
        entry_type = entry.get('type')
        ts = entry.get('timestamp', '')
        
        if entry_type == 'message':
            msg = entry.get('message', {})
            role = msg.get('role', '')
            content = msg.get('content', '')
            
            if role == 'user':
                text = extract_text(content)
                
                if not first_ts:
                    first_ts = ts
                
                # Detect subagent
                if '[Subagent Context]' in text or '[Subagent Task]' in text:
                    is_subagent = True
                    session_type = 'subagent'
                    task = parse_subagent_task(text)
                    depth = parse_subagent_depth(text)
                    label = parse_subagent_label(text)
                    
                    # Try to find requester from context
                    m = re.search(r'sender_id.*?["\'](\d+)["\']', text)
                    if m and m.group(1) in _sender_map():
                        requester = _sender_map()[m.group(1)]
                
                # Detect cron
                elif 'HEARTBEAT' in text or '[Cron' in text:
                    is_cron = True
                    session_type = 'cron'
                    task = text[:200]
                
                # Detect direct chat
                else:
                    sender_match = re.search(r'"sender_id":\s*"(\d+)"', text)
                    if sender_match:
                        sid = sender_match.group(1)
                        if sid in _sender_map():
                            session_type = _sender_map()[sid]
                            requester = _sender_map()[sid]
                    if not task:
                        task = text[:200]
            
            elif role == 'assistant':
                model = msg.get('model', '')
                if model == 'delivery-mirror':
                    continue
                
                last_ts = ts
                
                # Extract tool calls from content
                if isinstance(content, list):
                    for block in content:
                        if isinstance(block, dict):
                            if block.get('type') == 'toolCall':
                                tool_calls.append({
                                    'id': block.get('id', ''),
                                    'name': block.get('name', ''),
                                    'arguments': str(block.get('arguments', {}))[:500],
                                    'timestamp': ts,
                                })
                            elif block.get('type') == 'text':
                                text = block.get('text', '')
                                if text:
                                    assistant_texts.append(text)
                                    final_response = text
                
                # Track usage
                usage = msg.get('usage', {})
                if usage and usage.get('input', 0) > 0:
                    api_calls += 1
                    inp = usage.get('input', 0) or 0
                    out = usage.get('output', 0) or 0
                    cr = usage.get('cacheRead', 0) or 0
                    cw = usage.get('cacheWrite', 0) or 0
                    
                    total_input += inp
                    total_output += out
                    total_cache_read += cr
                    total_cache_write += cw
                    
                    if model:
                        models_used.add(model)
                        pricing = _pricing().get(model, _default_pricing())
                        cost = (
                            (inp / 1e6) * pricing['input'] +
                            (out / 1e6) * pricing['output'] +
                            (cw / 1e6) * pricing['cache_write'] +
                            (cr / 1e6) * pricing['cache_read']
                        )
                        total_cost += cost
            
            elif role == 'toolResult':
                result_text = extract_text(content)
                tool_id = msg.get('toolCallId', '')
                tool_results.append({
                    'tool_call_id': tool_id,
                    'result_preview': result_text[:300],
                    'timestamp': ts,
                })
    
    if not first_ts:
        first_ts = session_ts
    if not last_ts:
        last_ts = first_ts
    
    # Calculate duration
    try:
        start = datetime.fromisoformat(first_ts.replace('Z', '+00:00')) if first_ts else None
        end = datetime.fromisoformat(last_ts.replace('Z', '+00:00')) if last_ts else None
        duration_ms = int((end - start).total_seconds() * 1000) if start and end else 0
    except Exception:
        duration_ms = 0
    
    # Determine status
    file_mtime = os.path.getmtime(filepath)
    age_seconds = time.time() - file_mtime
    
    if is_deleted:
        status = 'deleted'
    elif is_reset:
        status = 'archived'
    elif age_seconds < 120:  # Modified in last 2 min
        status = 'running'
    else:
        status = 'completed'
    
    # Match tool calls with results
    enriched_tools = []
    result_map = {r['tool_call_id']: r for r in tool_results}
    for tc in tool_calls:
        result = result_map.get(tc['id'], {})
        enriched_tools.append({
            **tc,
            'result_preview': result.get('result_preview', ''),
        })
    
    return {
        'session_id': session_id,
        'session_type': session_type,
        'is_subagent': is_subagent,
        'is_cron': is_cron,
        'status': status,
        'task': task,
        'label': label,
        'depth': depth[0],
        'max_depth': depth[1],
        'requester': requester,
        'model': list(models_used)[0] if models_used else 'unknown',
        'models_used': list(models_used),
        'started_at': first_ts,
        'ended_at': last_ts if status != 'running' else None,
        'duration_ms': duration_ms,
        'api_calls': api_calls,
        'tool_calls_count': len(tool_calls),
        'tool_calls': enriched_tools,
        'tokens_input': total_input,
        'tokens_output': total_output,
        'tokens_cache_read': total_cache_read,
        'tokens_cache_write': total_cache_write,
        'tokens_total': total_input + total_output + total_cache_read + total_cache_write,
        'total_cost': total_cost,
        'final_response': final_response[:2000] if final_response else '',
        'file_age_seconds': age_seconds,
    }


def collect_agents(max_age_hours: int = 24, include_types: list = None) -> list:
    """Collect agent run data from session files.
    
    Args:
        max_age_hours: Only include sessions modified within this many hours
        include_types: Filter by session type (subagent, cron, user, admin)
    """
    cutoff = time.time() - (max_age_hours * 3600)
    
    jsonl_files = glob.glob(os.path.join(_sessions_dir(), "*.jsonl"))
    jsonl_files += glob.glob(os.path.join(_sessions_dir(), "*.jsonl.reset.*"))
    jsonl_files += glob.glob(os.path.join(_sessions_dir(), "*.jsonl.deleted.*"))
    
    agents = []
    for f in jsonl_files:
        if os.path.getmtime(f) < cutoff:
            continue
        
        result = parse_session_file(f)
        if result is None:
            continue
        
        if include_types and result['session_type'] not in include_types:
            continue
        
        agents.append(result)
    
    # Sort by started_at descending
    agents.sort(key=lambda x: x.get('started_at', ''), reverse=True)
    return agents


if __name__ == '__main__':
    agents = collect_agents(max_age_hours=24)
    subagents = [a for a in agents if a['is_subagent']]
    crons = [a for a in agents if a['is_cron']]
    running = [a for a in agents if a['status'] == 'running']
    
    print(f"Total sessions (24h): {len(agents)}")
    print(f"  Subagents: {len(subagents)}")
    print(f"  Crons: {len(crons)}")
    print(f"  Running: {len(running)}")
    print(f"  Total cost: ${sum(a['total_cost'] for a in agents):.2f}")
    print()
    for a in subagents[:5]:
        print(f"  [{a['status']}] {a['session_id'][:12]} | {a['model'][:20]} | ${a['total_cost']:.4f} | tools={a['tool_calls_count']} | {(a['task'] or '')[:60]}")
