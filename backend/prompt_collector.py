#!/usr/bin/env python3
"""
Sammelt Prompt-History aus OpenClaw Session-JSONL Files.
Analysiert User-Prompts, Assistant-Responses, Tool-Calls, Token-Usage.
Gruppiert in Sessions, Turns und API-Calls.
"""
import json
import glob
import os
import sys
from datetime import datetime
from collections import defaultdict
from sqlalchemy.orm import Session as DBSession

sys.path.insert(0, os.path.dirname(__file__))
from db import get_db, create_tables, PromptSession, PromptTurn, PromptApiCall
from transcript_collector import build_session_id_map
import config


def _sessions_dir():
    return config.get_sessions_dir()

def _all_sessions_dirs():
    """Return (agent_id, sessions_dir) tuples for all agents."""
    base = config.get_agents_base()
    dirs = []
    for agent_sessions_dir in glob.glob(os.path.join(base, '*/sessions')):
        if os.path.isdir(agent_sessions_dir):
            agent_id = os.path.basename(os.path.dirname(agent_sessions_dir))
            dirs.append((agent_id, agent_sessions_dir))
    return dirs if dirs else [('main', _sessions_dir())]

def _pricing():
    return config.get_pricing_table()

def _default_pricing():
    return config.get_default_pricing()

def _user_display_map():
    return config.get_user_display_map()


def extract_text_from_content(content):
    """Extract text from message content (string or array of blocks)."""
    if isinstance(content, str):
        return content
    elif isinstance(content, list):
        text_parts = []
        for block in content:
            if isinstance(block, dict) and block.get('type') == 'text':
                text_parts.append(block.get('text', ''))
        return ' '.join(text_parts)
    return ''


def extract_tool_names_from_content(content):
    """Extract tool names from assistant content blocks."""
    tool_names = []
    if isinstance(content, list):
        for block in content:
            if isinstance(block, dict) and block.get('type') == 'toolUse':
                tool_name = block.get('name', '')
                if tool_name:
                    tool_names.append(tool_name)
    return tool_names


def process_session_file(file_path, session_id, agent_id, user_category, db):
    """Process a single session JSONL file and extract prompt data."""
    
    # Check if we already processed this file completely
    existing_session = db.query(PromptSession).filter(
        PromptSession.session_id == session_id
    ).first()
    
    file_size = os.path.getsize(file_path)
    
    if existing_session and existing_session.last_parsed_bytes == file_size:
        # File hasn't changed — but verify integrity: does turn count match DB?
        actual_turns = db.query(PromptTurn).filter(PromptTurn.session_id == session_id).count()
        if actual_turns > 0 and existing_session.total_turns != actual_turns:
            # Metadata out of sync — fix it
            existing_session.total_turns = actual_turns
            existing_session.updated_at = datetime.utcnow()
        
        # If we have bytes tracked but suspiciously few turns, re-parse
        if actual_turns < 5 and file_size > 100000:
            # Something went wrong last time — force re-parse
            print(f"  Integrity check: {session_id[:12]} has {actual_turns} turns but {file_size} bytes — forcing re-parse")
            db.query(PromptApiCall).filter(PromptApiCall.session_id == session_id).delete()
            db.query(PromptTurn).filter(PromptTurn.session_id == session_id).delete()
            db.flush()
            existing_session.last_parsed_bytes = 0
            # Fall through to re-parse
        else:
            # Backfill agent/category metadata if needed
            if existing_session.agent_id != agent_id or existing_session.user_category != user_category:
                existing_session.agent_id = agent_id
                existing_session.user_category = user_category
                existing_session.updated_at = datetime.utcnow()
            return 0, 0
    
    # Detect session reset: file got smaller → JSONL was rewritten
    session_was_reset = existing_session and file_size < (existing_session.last_parsed_bytes or 0)
    if session_was_reset:
        # Delete old turns and API calls — they belong to the previous session content
        db.query(PromptApiCall).filter(PromptApiCall.session_id == session_id).delete()
        db.query(PromptTurn).filter(PromptTurn.session_id == session_id).delete()
        db.flush()

    # Parse session file
    turns = []  # List of (turn_index, user_message, user_ts, assistant_calls)
    current_turn = None
    turn_index = 0
    session_started_at = None
    last_message_at = None
    
    try:
        with open(file_path, 'r') as f:
            lines = f.readlines()
            
        # Skip already processed lines if incremental (but NOT after a reset)
        start_line = 0
        if existing_session and existing_session.last_parsed_bytes > 0 and not session_was_reset:
            # Estimate line to start from based on average line size
            avg_line_size = file_size / len(lines) if len(lines) > 0 else 100
            start_line = max(0, int(existing_session.last_parsed_bytes / avg_line_size) - 10)  # Buffer
            
        for line_num, line in enumerate(lines[start_line:], start_line):
            try:
                entry = json.loads(line.strip())
            except json.JSONDecodeError:
                continue
                
            # Skip non-message entries
            if entry.get('type') != 'message':
                continue
                
            msg = entry.get('message', {})
            if not isinstance(msg, dict):
                continue
                
            role = msg.get('role', '')
            # Timestamp can be ISO string (entry level) or epoch-ms (message level)
            timestamp = msg.get('timestamp') or entry.get('timestamp')
            
            if not timestamp:
                continue
            
            if isinstance(timestamp, str):
                try:
                    msg_timestamp = datetime.fromisoformat(timestamp.replace('Z', '+00:00')).replace(tzinfo=None)
                except:
                    continue
            elif isinstance(timestamp, (int, float)):
                try:
                    msg_timestamp = datetime.utcfromtimestamp(timestamp / 1000)
                except:
                    continue
            else:
                continue
            
            if not session_started_at:
                session_started_at = msg_timestamp
            last_message_at = msg_timestamp
            
            if role == 'user':
                # New turn starts with user message
                content = msg.get('content', '')
                user_text = extract_text_from_content(content)
                
                # End previous turn if exists
                if current_turn is not None:
                    turns.append(current_turn)
                
                # Start new turn
                current_turn = {
                    'turn_index': turn_index,
                    'user_message': user_text,
                    'user_message_full': user_text,
                    'started_at': msg_timestamp,
                    'ended_at': msg_timestamp,  # Will be updated
                    'assistant_calls': []
                }
                turn_index += 1
                
            elif role == 'assistant' and current_turn is not None:
                # Assistant response in current turn
                usage = msg.get('usage', {})
                if not usage or msg.get('model') == 'delivery-mirror':
                    continue  # Skip empty usage or delivery-mirror
                    
                content = msg.get('content', '')
                content_full = extract_text_from_content(content)
                content_preview = content_full[:200] + '...' if len(content_full) > 200 else content_full
                    
                tool_names = extract_tool_names_from_content(content)
                
                tokens_input = usage.get('input', 0) or 0
                tokens_output = usage.get('output', 0) or 0
                tokens_cache_write = usage.get('cacheWrite', 0) or 0
                tokens_cache_read = usage.get('cacheRead', 0) or 0
                
                # Calculate cost
                model = msg.get('model', 'unknown')
                pricing = _pricing().get(model, _default_pricing())
                cost_input = (tokens_input / 1e6) * pricing['input']
                cost_output = (tokens_output / 1e6) * pricing['output']
                cost_cache_write = (tokens_cache_write / 1e6) * pricing['cache_write']
                cost_cache_read = (tokens_cache_read / 1e6) * pricing['cache_read']
                cost_total = cost_input + cost_output + cost_cache_write + cost_cache_read
                
                assistant_call = {
                    'message_id': entry.get('id', ''),
                    'parent_id': entry.get('parentId', ''),
                    'timestamp': msg_timestamp,
                    'model': model,
                    'provider': msg.get('provider', ''),
                    'stop_reason': msg.get('stopReason', ''),
                    'tokens_input': tokens_input,
                    'tokens_output': tokens_output,
                    'tokens_cache_read': tokens_cache_read,
                    'tokens_cache_write': tokens_cache_write,
                    'cost_input': cost_input,
                    'cost_output': cost_output,
                    'cost_cache_read': cost_cache_read,
                    'cost_cache_write': cost_cache_write,
                    'cost_total': cost_total,
                    'content_preview': content_preview,
                    'content_full': content_full,
                    'tool_names': tool_names
                }
                
                current_turn['assistant_calls'].append(assistant_call)
                current_turn['ended_at'] = msg_timestamp
                
    except Exception as e:
        print(f"Error processing {file_path}: {e}")
        return 0, 0
        
    # Add final turn if exists
    if current_turn is not None:
        turns.append(current_turn)
    
    if not turns:
        return 0, 0
        
    # Calculate session totals
    total_tokens = 0
    total_cost = 0.0
    total_api_calls = 0
    models_used = set()
    
    for turn in turns:
        for call in turn['assistant_calls']:
            total_tokens += call['tokens_input'] + call['tokens_output'] + call['tokens_cache_read'] + call['tokens_cache_write']
            total_cost += call['cost_total']
            total_api_calls += 1
            models_used.add(call['model'])
    
    primary_model = list(models_used)[0] if models_used else 'unknown'
    
    # UPSERT session
    if existing_session:
        existing_session.agent_id = agent_id
        existing_session.user_category = user_category
        existing_session.last_message_at = last_message_at
        existing_session.total_turns = len(turns)
        existing_session.total_api_calls = total_api_calls
        existing_session.total_tokens = total_tokens
        existing_session.total_cost = total_cost
        existing_session.primary_model = primary_model
        existing_session.last_parsed_bytes = file_size
        existing_session.updated_at = datetime.utcnow()
    else:
        session = PromptSession(
            session_id=session_id,
            agent_id=agent_id,
            user_category=user_category,
            started_at=session_started_at,
            last_message_at=last_message_at,
            total_turns=len(turns),
            total_api_calls=total_api_calls,
            total_tokens=total_tokens,
            total_cost=total_cost,
            primary_model=primary_model,
            last_parsed_bytes=file_size
        )
        db.add(session)
    
    # Process turns and API calls
    turns_added = 0
    calls_added = 0
    
    for turn in turns:
        # Calculate turn totals
        turn_tokens_input = sum(call['tokens_input'] for call in turn['assistant_calls'])
        turn_tokens_output = sum(call['tokens_output'] for call in turn['assistant_calls'])
        turn_tokens_cache_read = sum(call['tokens_cache_read'] for call in turn['assistant_calls'])
        turn_tokens_cache_write = sum(call['tokens_cache_write'] for call in turn['assistant_calls'])
        turn_cost = sum(call['cost_total'] for call in turn['assistant_calls'])
        
        duration_ms = int((turn['ended_at'] - turn['started_at']).total_seconds() * 1000)
        
        tool_names = set()
        tool_calls_count = 0
        turn_model = 'unknown'
        assistant_response_full = ''
        
        for call in turn['assistant_calls']:
            tool_names.update(call['tool_names'])
            tool_calls_count += len(call['tool_names'])
            if not turn_model or turn_model == 'unknown':
                turn_model = call['model']
            if call['content_full'] and not assistant_response_full:
                assistant_response_full = call['content_full']
        
        user_message_short = turn['user_message_full'] or ''
        
        # UPSERT turn
        existing_turn = db.query(PromptTurn).filter(
            PromptTurn.session_id == session_id,
            PromptTurn.turn_index == turn['turn_index']
        ).first()
        
        if not existing_turn:
            turn_record = PromptTurn(
                session_id=session_id,
                turn_index=turn['turn_index'],
                user_message=user_message_short,
                user_message_full=turn['user_message_full'],
                started_at=turn['started_at'],
                ended_at=turn['ended_at'],
                duration_ms=duration_ms,
                api_calls=len(turn['assistant_calls']),
                tool_calls=tool_calls_count,
                tool_names=','.join(sorted(tool_names)) if tool_names else '',
                total_tokens_input=turn_tokens_input,
                total_tokens_output=turn_tokens_output,
                total_tokens_cache_read=turn_tokens_cache_read,
                total_tokens_cache_write=turn_tokens_cache_write,
                total_cost=turn_cost,
                model=turn_model,
                assistant_response=assistant_response_full
            )
            db.add(turn_record)
            turns_added += 1
        
        # UPSERT API calls
        for call_idx, call in enumerate(turn['assistant_calls']):
            existing_call = db.query(PromptApiCall).filter(
                PromptApiCall.session_id == session_id,
                PromptApiCall.message_id == call['message_id']
            ).first()
            
            if not existing_call:
                tool_name = call['tool_names'][0] if call['tool_names'] else None
                
                api_call = PromptApiCall(
                    session_id=session_id,
                    turn_index=turn['turn_index'],
                    call_index=call_idx,
                    message_id=call['message_id'],
                    parent_id=call['parent_id'],
                    timestamp=call['timestamp'],
                    model=call['model'],
                    provider=call['provider'],
                    stop_reason=call['stop_reason'],
                    tokens_input=call['tokens_input'],
                    tokens_output=call['tokens_output'],
                    tokens_cache_read=call['tokens_cache_read'],
                    tokens_cache_write=call['tokens_cache_write'],
                    cost_input=call['cost_input'],
                    cost_output=call['cost_output'],
                    cost_cache_read=call['cost_cache_read'],
                    cost_cache_write=call['cost_cache_write'],
                    cost_total=call['cost_total'],
                    content_preview=call['content_preview'],
                    tool_name=tool_name
                )
                db.add(api_call)
                calls_added += 1
    
    return turns_added, calls_added


def main():
    """Main collector function."""
    print(f"=== Prompt History Collector {datetime.now().strftime('%Y-%m-%d %H:%M')} ===")
    
    # Build session ID mapping
    sid_map = build_session_id_map()
    cats = defaultdict(int)
    for v in sid_map.values():
        cats[v] += 1
    print(f"Session mapping: {dict(cats)}")
    
    # Create tables
    create_tables()
    
    # Get database session
    db = next(get_db())
    
    try:
        session_dirs = _all_sessions_dirs()
        jsonl_files = []
        for agent_id, sessions_dir in session_dirs:
            for file_path in glob.glob(os.path.join(sessions_dir, "*.jsonl")):
                jsonl_files.append((agent_id, file_path))
            for file_path in glob.glob(os.path.join(sessions_dir, "*.jsonl.reset.*")):
                jsonl_files.append((agent_id, file_path))
        print(f"Processing {len(jsonl_files)} session files across {len(session_dirs)} agents...")
        
        total_turns = 0
        total_calls = 0
        
        for agent_id, file_path in jsonl_files:
            # Extract session ID: handle both 'uuid.jsonl' and 'uuid.jsonl.reset.timestamp'
            basename = os.path.basename(file_path)
            session_id = basename.split('.jsonl')[0]
            raw_category = sid_map.get(session_id, 'unknown')
            # Normalize: cron→crons, subagent→subagents, keep user categories
            CATEGORY_NORMALIZE = {'cron': 'crons', 'subagent': 'subagents', 'unknown': 'subagents'}
            mapped_category = CATEGORY_NORMALIZE.get(raw_category, raw_category)
            
            turns_added, calls_added = process_session_file(file_path, session_id, agent_id, mapped_category, db)
            total_turns += turns_added
            total_calls += calls_added
            
            if turns_added > 0 or calls_added > 0:
                print(f"  {agent_id}/{session_id} ({mapped_category}): +{turns_added} turns, +{calls_added} calls")
        
        db.commit()
        print(f"Completed: {total_turns} turns, {total_calls} API calls added")
        
    except Exception as e:
        print(f"Error: {e}")
        db.rollback()
    finally:
        db.close()


if __name__ == "__main__":
    main()