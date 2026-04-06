#!/usr/bin/env python3
"""
Clawscope Dashboard — Data Collector
Datenquellen:
1. openclaw gateway usage-cost --days 365 --json → Daily costs
2. openclaw status --json → Breakdown nach Model & Agent  
3. openclaw cron list --json → Cron Jobs
4. Session Transcripts → Cron-Job Token/Cost Aggregation
"""
import json
import subprocess
import os
import sys
import shutil
import psutil
import glob

sys.path.insert(0, os.path.dirname(__file__))
import config
import re
from datetime import datetime
from sqlalchemy.orm import Session
from db import get_db, create_tables, CronJob, CronRun, ActiveSession, TokenUsage

# Anthropic pricing per million tokens (as of April 2026)
MODEL_PRICING = {
    'claude-opus-4-6': {
        'input': 15.0, 'output': 75.0, 'cache_read': 1.50, 'cache_write': 18.75,
    },
    'claude-sonnet-4-20250514': {
        'input': 3.0, 'output': 15.0, 'cache_read': 0.30, 'cache_write': 3.75,
    },
    'claude-haiku-4-5-20251001': {
        'input': 0.80, 'output': 4.0, 'cache_read': 0.08, 'cache_write': 1.0,
    },
}

def calc_cost(model: str, input_tok: int, output_tok: int, cache_read: int = 0, cache_write: int = 0) -> float:
    """Calculate cost from tokens + model pricing."""
    # Normalize model name
    pricing = None
    for key, p in MODEL_PRICING.items():
        if key in (model or ''):
            pricing = p
            break
    if not pricing:
        # Default to sonnet pricing
        pricing = MODEL_PRICING['claude-sonnet-4-20250514']
    
    cost = (
        (input_tok / 1_000_000) * pricing['input'] +
        (output_tok / 1_000_000) * pricing['output'] +
        (cache_read / 1_000_000) * pricing['cache_read'] +
        (cache_write / 1_000_000) * pricing['cache_write']
    )
    return round(cost, 6)

def run_cli(args, timeout=30):
    """Run openclaw CLI command and return parsed JSON."""
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
        if result.returncode == 0 and result.stdout.strip():
            return json.loads(result.stdout)
    except Exception as e:
        print(f"CLI error {' '.join(args)}: {e}")
    return None


def collect_daily_costs(db: Session):
    """Source 1: openclaw gateway usage-cost → daily costs via UPSERT."""
    data = run_cli(['openclaw', 'gateway', 'usage-cost', '--days', '365', '--json'])
    if not data or 'daily' not in data:
        print("No daily cost data")
        return
    
    upserted = 0
    for day in data['daily']:
        date = day.get('date', '')
        if not date:
            continue
            
        # UPSERT: Find existing record or create new one
        existing = db.query(TokenUsage).filter(
            TokenUsage.date == date,
            TokenUsage.source == 'gateway',
            TokenUsage.api_key == 'total',
            TokenUsage.model == 'all'
        ).first()
        
        if existing:
            # Update existing record
            existing.tokens_input = day.get('input', 0)
            existing.tokens_output = day.get('output', 0)
            existing.tokens_cache_write = day.get('cacheWrite', 0)
            existing.tokens_cache_read = day.get('cacheRead', 0)
            existing.cost_input = day.get('inputCost', 0)
            existing.cost_output = day.get('outputCost', 0)
            existing.cost_cache_write = day.get('cacheWriteCost', 0)
            existing.cost_cache_read = day.get('cacheReadCost', 0)
            existing.cost_total = day.get('totalCost', 0)
        else:
            # Create new record
            record = TokenUsage(
                date=date,
                source='gateway',
                api_key='total',  # Total per day
                model='all',
                tokens_input=day.get('input', 0),
                tokens_output=day.get('output', 0),
                tokens_cache_write=day.get('cacheWrite', 0),
                tokens_cache_read=day.get('cacheRead', 0),
                cost_input=day.get('inputCost', 0),
                cost_output=day.get('outputCost', 0),
                cost_cache_write=day.get('cacheWriteCost', 0),
                cost_cache_read=day.get('cacheReadCost', 0),
                cost_total=day.get('totalCost', 0),
            )
            db.add(record)
        upserted += 1
    
    print(f"Upserted {upserted} daily cost records")


def collect_agent_breakdown(db: Session):
    """Source 2: openclaw status → per-agent/model breakdown."""
    data = run_cli(['openclaw', 'status', '--json'])
    if not data:
        print("No status data")
        return
    
    agents = data.get('sessions', {}).get('byAgent', [])
    
    # Clear old sessions
    db.query(ActiveSession).delete(synchronize_session=False)
    
    for agent in agents:
        agent_id = agent.get('agentId', 'unknown')
        for session in agent.get('recent', []):
            session_key = session.get('key', session.get('sessionKey', ''))
            kind = session.get('kind', '')
            percent_used = session.get('percentUsed', 0) or 0
            age = session.get('age', '')
            flags = session.get('flags', [])
            
            # Derive status from flags and data
            if 'abortedLastRun' in session and session['abortedLastRun']:
                status = 'aborted'
            elif percent_used > 90:
                status = 'near-limit'
            elif age and 'just now' in str(age):
                status = 'active'
            else:
                status = kind or 'idle'
            
            model = session.get('model', '')
            input_tok = session.get('inputTokens', 0) or 0
            output_tok = session.get('outputTokens', 0) or 0
            cache_read = session.get('cacheRead', 0) or 0
            cache_write = session.get('cacheWrite', 0) or 0
            estimated_cost = calc_cost(model, input_tok, output_tok, cache_read, cache_write)
            
            record = ActiveSession(
                session_key=session_key,
                model=model,
                tokens_total=session.get('totalTokens', input_tok + output_tok) or 0,
                tokens_input=input_tok,
                tokens_output=output_tok,
                estimated_cost=estimated_cost,
                status=status,
                session_type=agent_id,
                start_time=datetime.utcnow(),
                runtime_minutes=0,
            )
            db.add(record)
    
    print(f"Imported sessions from {len(agents)} agents")


def analyze_session_transcripts():
    """Analyze session transcripts to extract cron job token/cost data."""
    sessions_dir = config.get_sessions_dir()
    if not os.path.exists(sessions_dir):
        print("Sessions directory not found")
        return {}
    
    cron_stats = {}  # job_name -> {"total_tokens": int, "total_cost": float, "total_runs": int}
    
    # Find all .jsonl files (not deleted ones)
    session_files = glob.glob(os.path.join(sessions_dir, "*.jsonl"))
    session_files = [f for f in session_files if ".deleted." not in f]
    
    print(f"Analyzing {len(session_files)} session files...")
    
    for session_file in session_files:
        try:
            with open(session_file, 'r') as f:
                lines = f.readlines()
                
            if not lines:
                continue
                
            # Find first user message to check for [cron: pattern
            job_name = None
            for line in lines[:10]:  # Check first 10 lines for cron marker
                try:
                    data = json.loads(line.strip())
                    if (data.get('type') == 'message' and 
                        data.get('message', {}).get('role') == 'user'):
                        content = data.get('message', {}).get('content', [])
                        if content and isinstance(content, list):
                            text = content[0].get('text', '') if content else ''
                            # Extract job name from [cron:job-id job-name] pattern
                            match = re.search(r'\[cron:[^\s]+ ([^\]]+)\]', text)
                            if match:
                                job_name = match.group(1).strip()
                                break
                except (json.JSONDecodeError, KeyError):
                    continue
            
            if not job_name:
                continue  # Not a cron session
                
            # Sum up token usage for this session
            session_tokens = 0
            session_cost = 0.0
            
            for line in lines:
                try:
                    data = json.loads(line.strip())
                    if data.get('type') == 'message':
                        message = data.get('message', {})
                        usage = message.get('usage', {})
                        provider = message.get('provider', '')
                        
                        # Skip OpenClaw internal messages
                        if provider == 'openclaw':
                            continue
                            
                        session_tokens += usage.get('totalTokens', 0)
                        cost_data = usage.get('cost', {})
                        session_cost += cost_data.get('total', 0) if cost_data else 0
                        
                except (json.JSONDecodeError, KeyError):
                    continue
            
            # Add to job stats
            if job_name not in cron_stats:
                cron_stats[job_name] = {"total_tokens": 0, "total_cost": 0.0, "total_runs": 0}
            
            cron_stats[job_name]["total_tokens"] += session_tokens
            cron_stats[job_name]["total_cost"] += session_cost
            cron_stats[job_name]["total_runs"] += 1
            
        except Exception as e:
            print(f"Error analyzing {session_file}: {e}")
            continue
    
    print(f"Found {len(cron_stats)} cron jobs with usage data")
    return cron_stats


def collect_cron_jobs(db: Session):
    """Source 3: openclaw cron list → cron jobs via UPSERT + token/cost analysis."""
    data = run_cli(['openclaw', 'cron', 'list', '--json'])
    if not data:
        print("No cron data")
        return
    
    jobs = data.get('jobs', data) if isinstance(data, dict) else data
    if not isinstance(jobs, list):
        print("Unexpected cron data format")
        return
    
    # Analyze session transcripts for token/cost data
    cron_stats = analyze_session_transcripts()
    
    upserted = 0
    for job in jobs:
        job_name = job.get('name', 'unknown')
        
        sched = job.get('schedule', {})
        schedule_str = sched.get('expr', '') if isinstance(sched, dict) else str(sched)
        tz = sched.get('tz', '') if isinstance(sched, dict) else ''
        schedule_display = f"{schedule_str} ({tz})" if tz else schedule_str
        
        payload = job.get('payload', {})
        model = payload.get('model', '') if isinstance(payload, dict) else ''
        
        # If no model in payload, resolve from agentId
        if not model:
            agent_models = {
                'main': 'claude-opus-4-6',
                'worker': 'claude-sonnet-4',
                'research': 'claude-sonnet-4',
                'strategie': 'claude-sonnet-4',
                'qs': 'claude-sonnet-4',
                'verlag': 'claude-sonnet-4',
                'gclight': 'claude-sonnet-4',
                'phone': 'claude-haiku-4.5',
            }
            agent_id = job.get('agentId', 'worker')
            model = agent_models.get(agent_id, 'claude-sonnet-4')
        
        state = job.get('state', {})
        last_status = state.get('lastStatus', '') if isinstance(state, dict) else ''
        last_error = state.get('lastError', '') if isinstance(state, dict) else ''
        next_run_ms = state.get('nextRunAtMs', 0) if isinstance(state, dict) else 0
        next_run = datetime.utcfromtimestamp(next_run_ms / 1000).isoformat() if next_run_ms else ''
        consecutive_errors = state.get('consecutiveErrors', 0) if isinstance(state, dict) else 0
        
        # Get usage stats for this job
        usage_stats = cron_stats.get(job_name, {})
        total_tokens = usage_stats.get('total_tokens', 0)
        total_cost = usage_stats.get('total_cost', 0.0)
        total_runs = usage_stats.get('total_runs', 0)
        avg_tokens_per_run = int(total_tokens / total_runs) if total_runs > 0 else 0
        avg_cost_per_run = total_cost / total_runs if total_runs > 0 else 0.0
        
        # UPSERT: Find existing cron job or create new one
        existing = db.query(CronJob).filter(CronJob.name == job_name).first()
        
        if existing:
            # Update existing record
            existing.cron_id = job.get('id', '')
            existing.enabled = job.get('enabled', True)
            existing.schedule = schedule_display
            existing.model = model
            existing.last_status = last_status
            existing.last_error = str(last_error)[:500] if last_error else ''
            existing.next_run = next_run
            existing.consecutive_errors = consecutive_errors
            existing.total_tokens = total_tokens
            existing.total_cost = total_cost
            existing.total_runs = total_runs
            existing.avg_tokens_per_run = avg_tokens_per_run
            existing.avg_cost_per_run = avg_cost_per_run
            existing.updated_at = datetime.utcnow()
        else:
            # Create new record
            record = CronJob(
                cron_id=job.get('id', ''),
                name=job_name,
                enabled=job.get('enabled', True),
                schedule=schedule_display,
                model=model,
                last_status=last_status,
                last_error=str(last_error)[:500] if last_error else '',
                next_run=next_run,
                consecutive_errors=consecutive_errors,
                total_tokens=total_tokens,
                total_cost=total_cost,
                total_runs=total_runs,
                avg_tokens_per_run=avg_tokens_per_run,
                avg_cost_per_run=avg_cost_per_run,
            )
            db.add(record)
        upserted += 1
    
    print(f"Upserted {upserted} cron jobs")
    
    # Collect run history into cron_runs table
    runs_added = 0
    for job in jobs:
        state = job.get('state', {})
        last_run_ms = state.get('lastRunAtMs')
        if not last_run_ms:
            continue
        
        run_at = datetime.utcfromtimestamp(last_run_ms / 1000)
        job_id = job.get('id', '')
        
        # Skip if already recorded
        existing = db.query(CronRun).filter(
            CronRun.job_id == job_id,
            CronRun.run_at == run_at
        ).first()
        if existing:
            continue
        
        payload = job.get('payload', {})
        agent_id = job.get('agentId', 'worker')
        agent_models = {
            'main': 'opus', 'worker': 'sonnet',
            'research': 'sonnet', 'strategie': 'sonnet',
        }
        model = payload.get('model', agent_models.get(agent_id, 'sonnet'))
        
        usage_stats = cron_stats.get(job.get('name', ''), {})
        avg_cost = usage_stats.get('total_cost', 0) / max(usage_stats.get('total_runs', 1), 1)
        avg_tokens = usage_stats.get('total_tokens', 0) / max(usage_stats.get('total_runs', 1), 1)
        
        record = CronRun(
            job_name=job.get('name', ''),
            job_id=job_id,
            agent_id=agent_id,
            model=model,
            run_at=run_at,
            status=state.get('lastStatus', ''),
            duration_ms=state.get('lastDurationMs', 0),
            error=state.get('lastError', ''),
            consecutive_errors=state.get('consecutiveErrors', 0),
            delivered=state.get('lastDelivered', False),
            tokens_total=int(avg_tokens),
            cost_est=avg_cost,
        )
        db.add(record)
        runs_added += 1
    
    if runs_added:
        print(f"Added {runs_added} cron runs to history")


def collect_agent_daily_costs(db: Session):
    """Parse JSONL transcripts to get per-agent per-day costs."""
    today = datetime.now().strftime('%Y-%m-%d')
    # Initialize all known agents with $0
    all_agents = ['main', 'worker', 'gclight', 'research', 'strategie', 'qs', 'verlag', 'phone']
    agent_costs = {a: {'cost': 0, 'input': 0, 'output': 0, 'cache_r': 0, 'cache_w': 0, 'model': ''} for a in all_agents}
    
    for agent_dir in glob.glob(os.path.join(config.get_agents_base(), '*/sessions')):
        agent = agent_dir.split('/agents/')[1].split('/')[0]
        
        for jf in glob.glob(os.path.join(agent_dir, '*.jsonl')):
            if '.deleted.' in jf:
                continue
            mtime = datetime.fromtimestamp(os.path.getmtime(jf))
            if mtime.strftime('%Y-%m-%d') != today:
                continue
            
            try:
                with open(jf) as f:
                    for line in f:
                        try:
                            d = json.loads(line.strip())
                            ts = d.get('timestamp', '')
                            if not ts or not ts.startswith(today):
                                continue
                            if d.get('type') == 'message':
                                usage = d.get('message', {}).get('usage', {})
                                cost = usage.get('cost', {})
                                total = cost.get('total', 0) or 0
                                if total > 0:
                                    if agent not in agent_costs:
                                        agent_costs[agent] = {
                                            'cost': 0, 'input': 0, 'output': 0,
                                            'cache_r': 0, 'cache_w': 0, 'model': ''
                                        }
                                    agent_costs[agent]['cost'] += total
                                    agent_costs[agent]['input'] += usage.get('input', 0) or 0
                                    agent_costs[agent]['output'] += usage.get('output', 0) or 0
                                    agent_costs[agent]['cache_r'] += usage.get('cacheRead', 0) or 0
                                    agent_costs[agent]['cache_w'] += usage.get('cacheWrite', 0) or 0
                                    if not agent_costs[agent]['model']:
                                        agent_costs[agent]['model'] = d.get('message', {}).get('model', '')
                        except:
                            continue
            except:
                continue
    
    upserted = 0
    for agent, data in agent_costs.items():
        existing = db.query(TokenUsage).filter(
            TokenUsage.date == today,
            TokenUsage.source == 'agent',
            TokenUsage.api_key == agent,
        ).first()
        if existing:
            existing.model = data['model']
            existing.tokens_input = data['input']
            existing.tokens_output = data['output']
            existing.tokens_cache_read = data['cache_r']
            existing.tokens_cache_write = data['cache_w']
            existing.cost_total = data['cost']
        else:
            db.add(TokenUsage(
                date=today, source='agent', api_key=agent,
                model=data['model'],
                tokens_input=data['input'], tokens_output=data['output'],
                tokens_cache_read=data['cache_r'], tokens_cache_write=data['cache_w'],
                cost_total=data['cost'],
            ))
        upserted += 1
    
    if upserted:
        total = sum(d['cost'] for d in agent_costs.values())
        print(f"Agent daily costs: {upserted} agents, ${total:.2f} total")


def run_collection():
    """Main collection run."""
    print(f"=== Collector {datetime.now().strftime('%Y-%m-%d %H:%M')} ===")
    
    create_tables()
    db = next(get_db())
    
    try:
        collect_daily_costs(db)
        collect_agent_breakdown(db)
        collect_cron_jobs(db)
        db.commit()
        print("Collection complete ✅")
    except Exception as e:
        print(f"Collection error: {e}")
    
    # Run agent cost indexer (separate, uses own DB connection)
    try:
        from agent_cost_indexer import run_indexer
        run_indexer(full_reindex=False)
    except Exception as e:
        print(f'Agent indexer error: {e}')
        db.rollback()
    finally:
        db.close()


if __name__ == "__main__":
    run_collection()
