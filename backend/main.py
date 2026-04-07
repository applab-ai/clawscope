from fastapi import FastAPI, Depends, HTTPException, Request, Response, status
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.responses import JSONResponse, RedirectResponse, HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import func, desc
from datetime import datetime, timedelta
import os
import json
import psutil
import shutil
from typing import List, Dict, Optional

from db import get_db, create_tables, CronJob, CronRun, ActiveSession, TokenUsage, PromptSession, PromptTurn, PromptApiCall
from auth import verify_password, create_access_token, check_session
import config

# Initialize FastAPI
CLAWSCOPE_VERSION = "1.0.1"
app = FastAPI(title="Clawscope", version=CLAWSCOPE_VERSION)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Create tables on startup
@app.on_event("startup")
async def startup_event():
    create_tables()

# Static files and templates
frontend_path = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")
if os.path.exists(frontend_path):
    app.mount("/assets", StaticFiles(directory=os.path.join(frontend_path, "assets")), name="assets")

templates = Jinja2Templates(directory=os.path.join(os.path.dirname(__file__), "templates"))

# Pydantic models
class LoginRequest(BaseModel):
    password: str

class LoginResponse(BaseModel):
    access_token: str
    token_type: str

class CronJobResponse(BaseModel):
    id: int
    cron_id: Optional[str] = None
    name: str
    enabled: bool = True
    schedule: str
    model: str
    last_status: str
    last_error: Optional[str]
    next_run: Optional[datetime]
    consecutive_errors: int
    total_tokens: int
    total_cost: float
    total_runs: int
    avg_tokens_per_run: int
    avg_cost_per_run: float
    updated_at: datetime

class SessionResponse(BaseModel):
    id: int
    session_key: str
    model: str
    tokens_total: int
    tokens_input: int
    tokens_output: int
    estimated_cost: float
    status: str
    session_type: str
    runtime_minutes: int
    start_time: Optional[datetime]

class TokenUsageResponse(BaseModel):
    date: str
    source: str  # 'gateway' oder 'transcript'
    api_key: str
    api_key_name: str
    model: str
    tokens_input: int
    tokens_output: int
    tokens_cache_write: int = 0
    tokens_cache_read: int = 0
    cost_total: float
    channel: str = ''

class DashboardStats(BaseModel):
    total_cron_jobs: int
    active_sessions: int
    daily_cost: float
    monthly_cost: float
    system_health: str

class PromptSessionResponse(BaseModel):
    id: int
    session_id: str
    user_category: str
    started_at: datetime
    last_message_at: Optional[datetime]
    total_turns: int
    total_api_calls: int
    total_tokens: int
    total_cost: float
    primary_model: str
    updated_at: datetime

class PromptTurnResponse(BaseModel):
    id: int
    session_id: str
    turn_index: int
    user_message: str
    user_message_full: str
    started_at: datetime
    ended_at: Optional[datetime]
    duration_ms: int
    api_calls: int
    tool_calls: int
    tool_names: str
    total_tokens_input: int
    total_tokens_output: int
    total_tokens_cache_read: int
    total_tokens_cache_write: int
    total_cost: float
    model: str
    assistant_response: str
    # Session data joined
    session: Optional[PromptSessionResponse] = None

class PromptApiCallResponse(BaseModel):
    id: int
    session_id: str
    turn_index: int
    call_index: int
    message_id: str
    parent_id: str
    timestamp: datetime
    model: str
    provider: str
    stop_reason: str
    tokens_input: int
    tokens_output: int
    tokens_cache_read: int
    tokens_cache_write: int
    cost_input: float
    cost_output: float
    cost_cache_read: float
    cost_cache_write: float
    cost_total: float
    content_preview: str
    tool_name: Optional[str]

# Routes
@app.get("/", response_class=HTMLResponse)
async def read_root(request: Request):
    """Serve the frontend"""
    frontend_index = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist", "index.html")
    if os.path.exists(frontend_index):
        with open(frontend_index, "r") as f:
            content = f.read()
        return HTMLResponse(content=content)
    else:
        return HTMLResponse("<h1>Clawscope Dashboard</h1><p>Frontend not built yet. Run: npm run build</p>")

@app.post("/api/login", response_model=LoginResponse)
async def login(request: LoginRequest, response: Response):
    """Login endpoint"""
    if not verify_password(request.password):
        raise HTTPException(status_code=401, detail="Invalid password")
    
    access_token = create_access_token(data={"sub": "dashboard_user"})
    
    # Set cookie for browser
    response.set_cookie(
        key="access_token",
        value=access_token,
        httponly=True,
        max_age=86400,  # 24 hours
        samesite="lax"
    )
    
    return LoginResponse(access_token=access_token, token_type="bearer")

@app.post("/api/logout")
async def logout(response: Response):
    """Logout endpoint"""
    response.delete_cookie("access_token")
    return {"message": "Logged out successfully"}

@app.get("/api/dashboard/stats", response_model=DashboardStats)
async def get_dashboard_stats(db: Session = Depends(get_db), user=Depends(check_session)):
    """Get dashboard overview statistics"""
    
    # Count cron jobs
    total_cron_jobs = db.query(CronJob).count()
    
    # Count active sessions
    active_sessions = db.query(ActiveSession).count()
    
    # Daily cost (today) - use gateway data for totals
    today = datetime.now().strftime("%Y-%m-%d")
    daily_cost = db.query(func.sum(TokenUsage.cost_total)).filter(
        TokenUsage.date == today,
        TokenUsage.source == 'gateway'
    ).scalar() or 0.0
    
    # Monthly cost (this month) - use gateway data for totals
    month_start = datetime.now().strftime("%Y-%m") + "-01"
    monthly_cost = db.query(func.sum(TokenUsage.cost_total)).filter(
        TokenUsage.date >= month_start,
        TokenUsage.source == 'gateway'
    ).scalar() or 0.0
    
    # System health (live)
    try:
        disk = shutil.disk_usage('/')
        disk_pct = (disk.used / disk.total) * 100
        mem_pct = psutil.virtual_memory().percent
        if disk_pct > 90 or mem_pct > 90:
            system_health = "critical"
        elif disk_pct > 80 or mem_pct > 80:
            system_health = "warning"
        else:
            system_health = "good"
    except Exception:
        system_health = "unknown"
    
    return DashboardStats(
        total_cron_jobs=total_cron_jobs,
        active_sessions=active_sessions,
        daily_cost=daily_cost,
        monthly_cost=monthly_cost,
        system_health=system_health
    )

@app.get("/api/cron-jobs", response_model=List[CronJobResponse])
async def get_cron_jobs(db: Session = Depends(get_db), user=Depends(check_session)):
    """Get all cron jobs"""
    jobs = db.query(CronJob).order_by(desc(CronJob.total_cost)).all()
    return jobs

@app.post("/api/cron-jobs/{job_name}/toggle")
async def toggle_cron_job(job_name: str, db: Session = Depends(get_db), user=Depends(check_session)):
    """Enable/disable a cron job."""
    import subprocess, json as _json
    
    # Get cron_id from DB
    job = db.query(CronJob).filter(CronJob.name == job_name).first()
    if not job or not job.cron_id:
        raise HTTPException(status_code=404, detail=f"Job '{job_name}' not found or missing cron_id")
    
    new_enabled = not job.enabled
    
    try:
        action = 'enable' if new_enabled else 'disable'
        cmd = ['openclaw', 'cron', action, job.cron_id]
        
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        if result.returncode != 0:
            raise HTTPException(status_code=500, detail=f"CLI error: {result.stderr or result.stdout}")
        
        # Update DB
        job.enabled = new_enabled
        db.commit()
        
        return {"name": job_name, "enabled": new_enabled, "cron_id": job.cron_id}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/cron-jobs/{job_name}/runs")
async def get_cron_job_runs(job_name: str, user=Depends(check_session)):
    """Get run history for a cron job via openclaw CLI"""
    import subprocess, json as _json
    # First get job ID by name from cron list
    try:
        result = subprocess.run(
            ['openclaw', 'cron', 'list', '--json'],
            capture_output=True, text=True, timeout=15
        )
        if result.returncode != 0:
            return {"runs": [], "error": "Failed to list cron jobs"}
        data = _json.loads(result.stdout)
        jobs = data.get('jobs', data) if isinstance(data, dict) else data
        
        job_id = None
        job_detail = None
        for j in jobs:
            if j.get('name') == job_name:
                job_id = j.get('id')
                job_detail = j
                break
        
        if not job_id:
            return {"runs": [], "error": f"Job '{job_name}' not found"}
        
        # Get runs for this job
        result2 = subprocess.run(
            ['openclaw', 'cron', 'runs', '--job', job_id, '--json', '--limit', '20'],
            capture_output=True, text=True, timeout=15
        )
        runs = []
        if result2.returncode == 0 and result2.stdout.strip():
            runs_data = _json.loads(result2.stdout)
            runs = runs_data.get('entries', runs_data) if isinstance(runs_data, dict) else runs_data
        
        return {
            "job": job_detail,
            "runs": runs if isinstance(runs, list) else []
        }
    except Exception as e:
        return {"runs": [], "error": str(e)}

@app.get("/api/sessions", response_model=List[SessionResponse])
async def get_active_sessions(db: Session = Depends(get_db), user=Depends(check_session)):
    """Get all active sessions"""
    sessions = db.query(ActiveSession).order_by(desc(ActiveSession.start_time)).all()
    return sessions

@app.get("/api/token-usage", response_model=List[TokenUsageResponse])
async def get_token_usage(
    days: int = 7,
    db: Session = Depends(get_db),
    user=Depends(check_session)
):
    """Get token usage for the last N days from BOTH sources"""
    start_date = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")
    
    usage = db.query(TokenUsage).filter(TokenUsage.date >= start_date).order_by(desc(TokenUsage.date)).all()
    
    result = []
    for u in usage:
        api_key_name = u.api_key  # User category names from config
        result.append(TokenUsageResponse(
            date=u.date,
            source=u.source,
            api_key=u.api_key,
            api_key_name=api_key_name,
            model=u.model,
            tokens_input=u.tokens_input,
            tokens_output=u.tokens_output,
            tokens_cache_write=u.tokens_cache_write or 0,
            tokens_cache_read=u.tokens_cache_read or 0,
            cost_total=u.cost_total,
            channel=u.channel or ''
        ))
    
    return result

@app.get("/api/cost-summary")
async def get_cost_summary(db: Session = Depends(get_db), user=Depends(check_session)):
    """Get cost summary by API key and model from ALL sources"""
    
    # Last 30 days
    start_date = (datetime.now() - timedelta(days=30)).strftime("%Y-%m-%d")
    
    # Group by API key (ALL sources, but exclude 'total' from gateway to avoid double counting)
    api_key_costs = db.query(
        TokenUsage.api_key,
        func.sum(TokenUsage.cost_total).label("total_cost"),
        func.sum(TokenUsage.tokens_input).label("total_input"),
        func.sum(TokenUsage.tokens_output).label("total_output"),
        func.sum(TokenUsage.tokens_cache_write).label("total_cache_write"),
        func.sum(TokenUsage.tokens_cache_read).label("total_cache_read"),
    ).filter(
        TokenUsage.date >= start_date,
        TokenUsage.api_key != 'total'  # Exclude gateway totals to show breakdown by agent
    ).group_by(TokenUsage.api_key).all()
    
    api_key_summary = []
    for row in api_key_costs:
        api_key_name = row.api_key
        total_tokens = (row.total_input or 0) + (row.total_output or 0) + (row.total_cache_write or 0) + (row.total_cache_read or 0)
        api_key_summary.append({
            "api_key": row.api_key,
            "api_key_name": api_key_name,
            "total_cost": float(row.total_cost or 0),
            "total_tokens": total_tokens,
            "tokens_input": int(row.total_input or 0),
            "tokens_output": int(row.total_output or 0),
            "tokens_cache_write": int(row.total_cache_write or 0),
            "tokens_cache_read": int(row.total_cache_read or 0),
        })
    
    # Group by model (ALL sources, but exclude 'all' from gateway to show model breakdown)
    model_costs = db.query(
        TokenUsage.model,
        func.sum(TokenUsage.cost_total).label("total_cost"),
        func.sum(TokenUsage.tokens_input).label("total_input"),
        func.sum(TokenUsage.tokens_output).label("total_output"),
        func.sum(TokenUsage.tokens_cache_write).label("total_cache_write"),
        func.sum(TokenUsage.tokens_cache_read).label("total_cache_read"),
    ).filter(
        TokenUsage.date >= start_date,
        TokenUsage.model != 'all'  # Exclude gateway totals to show breakdown by model
    ).group_by(TokenUsage.model).all()
    
    model_summary = []
    for row in model_costs:
        total_tokens = (row.total_input or 0) + (row.total_output or 0) + (row.total_cache_write or 0) + (row.total_cache_read or 0)
        model_summary.append({
            "model": row.model,
            "total_cost": float(row.total_cost or 0),
            "total_tokens": total_tokens,
            "tokens_input": int(row.total_input or 0),
            "tokens_output": int(row.total_output or 0),
            "tokens_cache_write": int(row.total_cache_write or 0),
            "tokens_cache_read": int(row.total_cache_read or 0),
        })
    
    return {
        "api_keys": api_key_summary,
        "models": model_summary
    }

@app.get("/api/cost-insights")
async def get_cost_insights(days: int = 1, user=Depends(check_session)):
    """Advanced cost insights: cost per message, cache savings, most expensive turn, cron ROI."""
    import glob as _glob
    from datetime import datetime as _dt, timedelta as _td
    from collections import defaultdict as _dd

    # Build set of valid dates
    valid_dates = set()
    for i in range(days):
        d = (_dt.now() - _td(days=i)).strftime('%Y-%m-%d')
        valid_dates.add(d)
    agents_base = config.get_agents_base()
    sender_map = config.get_sender_id_map()
    user_display = config.get_user_display_map()

    # Collect per-category stats from transcripts
    categories = _dd(lambda: {
        'turns': 0, 'cost': 0.0, 'tokens_input': 0, 'tokens_output': 0,
        'cache_read': 0, 'cache_write': 0, 'most_expensive_turn': 0.0,
        'most_expensive_model': '', 'most_expensive_tokens': 0,
    })

    # Build session->category map (simplified inline version)
    sid_cats = {}
    all_jsonl = []
    for agent_dir in _glob.glob(os.path.join(agents_base, '*/sessions')):
        all_jsonl += _glob.glob(os.path.join(agent_dir, '*.jsonl'))

    for jf in all_jsonl:
        sid = os.path.basename(jf).split('.jsonl')[0]
        cat = None
        turn_cost = 0.0
        turn_tokens = 0
        turn_model = ''
        in_turn = False

        try:
            with open(jf) as f:
                for line in f:
                    try:
                        d = json.loads(line)
                    except:
                        continue
                    if d.get('type') != 'message':
                        continue
                    msg = d.get('message', {})
                    ts = d.get('timestamp', '')
                    if not ts[:10] in valid_dates:
                        continue
                    role = msg.get('role', '')
                    content = msg.get('content', '')
                    txt = ''
                    if isinstance(content, list):
                        txt = ' '.join(c.get('text', '') for c in content if isinstance(c, dict))
                    elif isinstance(content, str):
                        txt = content

                    # Detect category from first user message
                    if cat is None and role == 'user':
                        if '[cron:' in txt:
                            cat = 'cron'
                        else:
                            for sid_id, sid_name in sender_map.items():
                                if f'"sender_id": "{sid_id}"' in txt or f'"sender_id":"{sid_id}"' in txt:
                                    cat = sid_name
                                    break
                            if cat is None:
                                cat = 'subagent'
                        sid_cats[sid] = cat

                    if cat is None:
                        cat = sid_cats.get(sid, 'subagent')

                    if role == 'user':
                        # Flush previous turn
                        if in_turn and turn_cost > 0:
                            c = categories[cat]
                            if turn_cost > c['most_expensive_turn']:
                                c['most_expensive_turn'] = turn_cost
                                c['most_expensive_model'] = turn_model
                                c['most_expensive_tokens'] = turn_tokens
                        # Start new turn
                        in_turn = True
                        turn_cost = 0.0
                        turn_tokens = 0
                        turn_model = ''
                        categories[cat]['turns'] += 1

                    elif role == 'assistant':
                        usage = msg.get('usage', {})
                        cost_data = usage.get('cost', {})
                        c = cost_data.get('total', 0) or 0
                        inp = usage.get('input', 0) or 0
                        out = usage.get('output', 0) or 0
                        cr = usage.get('cacheRead', 0) or 0
                        cw = usage.get('cacheWrite', 0) or 0
                        total_tok = usage.get('totalTokens', 0) or 0

                        categories[cat]['cost'] += c
                        categories[cat]['tokens_input'] += inp
                        categories[cat]['tokens_output'] += out
                        categories[cat]['cache_read'] += cr
                        categories[cat]['cache_write'] += cw

                        turn_cost += c
                        turn_tokens += total_tok
                        turn_model = msg.get('model', turn_model)

                # Flush last turn
                if in_turn and turn_cost > 0 and cat:
                    c = categories[cat]
                    if turn_cost > c['most_expensive_turn']:
                        c['most_expensive_turn'] = turn_cost
                        c['most_expensive_model'] = turn_model
                        c['most_expensive_tokens'] = turn_tokens
        except:
            continue

    # Build response
    # 1. Cost per message
    cost_per_msg = []
    for cat_key, data in sorted(categories.items(), key=lambda x: x[1]['cost'], reverse=True):
        display = user_display.get(cat_key, cat_key.title())
        avg = data['cost'] / max(data['turns'], 1)
        cost_per_msg.append({
            'category': display, 'turns': data['turns'],
            'total_cost': round(data['cost'], 4), 'avg_cost': round(avg, 4),
        })

    # 2. Cache savings
    total_cache_read = sum(d['cache_read'] for d in categories.values())
    total_input = sum(d['tokens_input'] for d in categories.values())
    total_output = sum(d['tokens_output'] for d in categories.values())
    total_cost = sum(d['cost'] for d in categories.values())
    # Estimate: cached tokens would cost full input price without cache
    # Rough: cache_read costs ~$0.30/MTok vs input $3-15/MTok → savings ≈ cache_read * (input_rate - cache_rate)
    # Use approximate rates
    cache_rate = 0.30  # $/MTok (cache read)
    input_rate = 5.00  # $/MTok (average input, weighted toward opus)
    cost_without_cache = total_cost + (total_cache_read / 1e6) * (input_rate - cache_rate)
    cache_savings = cost_without_cache - total_cost
    cache_savings_pct = (cache_savings / max(cost_without_cache, 0.01)) * 100

    # 3. Most expensive turn (global)
    most_expensive = {'cost': 0, 'model': '', 'tokens': 0, 'category': ''}
    for cat_key, data in categories.items():
        if data['most_expensive_turn'] > most_expensive['cost']:
            display = user_display.get(cat_key, cat_key.title())
            most_expensive = {
                'cost': round(data['most_expensive_turn'], 4),
                'model': data['most_expensive_model'],
                'tokens': data['most_expensive_tokens'],
                'category': display,
            }

    # 4. Cost per agent output efficiency
    output_efficiency = []
    for cat_key, data in categories.items():
        if data['tokens_output'] > 0 and data['cost'] > 0:
            display = user_display.get(cat_key, cat_key.title())
            output_per_dollar = data['tokens_output'] / max(data['cost'], 0.001)
            output_efficiency.append({
                'category': display,
                'output_tokens': data['tokens_output'],
                'cost': round(data['cost'], 4),
                'output_per_dollar': round(output_per_dollar, 0),
            })
    output_efficiency.sort(key=lambda x: x['output_per_dollar'], reverse=True)

    # 5. Cron ROI
    cron_data = categories.get('cron', None)
    cron_roi = None
    if cron_data and cron_data['turns'] > 0:
        cron_roi = {
            'total_runs': cron_data['turns'],
            'total_cost': round(cron_data['cost'], 4),
            'cost_per_run': round(cron_data['cost'] / max(cron_data['turns'], 1), 4),
        }

    return {
        'period': f'{days}d',
        'cost_per_message': cost_per_msg,
        'cache_savings': {
            'total_cache_read_tokens': total_cache_read,
            'estimated_cost_without_cache': round(cost_without_cache, 2),
            'actual_cost': round(total_cost, 2),
            'savings': round(cache_savings, 2),
            'savings_pct': round(cache_savings_pct, 1),
        },
        'most_expensive_turn': most_expensive,
        'output_efficiency': output_efficiency,
        'cron_roi': cron_roi,
    }


@app.get("/api/cron-history")
async def get_cron_history(
    offset: int = 0,
    limit: int = 50,
    db: Session = Depends(get_db),
    user=Depends(check_session)
):
    """Get paginated cron run history from DB."""
    total = db.query(CronRun).count()
    runs = db.query(CronRun).order_by(desc(CronRun.run_at)).offset(offset).limit(limit).all()
    
    return {
        "runs": [{
            "name": r.job_name,
            "jobId": r.job_id,
            "agentId": r.agent_id,
            "model": r.model,
            "runAtMs": int(r.run_at.timestamp() * 1000) if r.run_at else 0,
            "status": r.status,
            "durationMs": r.duration_ms,
            "error": r.error,
            "consecutiveErrors": r.consecutive_errors,
            "delivered": r.delivered,
            "avgTokensPerRun": r.tokens_total,
            "avgCostPerRun": r.cost_est,
        } for r in runs],
        "total": total,
        "offset": offset,
        "limit": limit,
        "hasMore": offset + limit < total,
    }

@app.get("/api/system-prompt")
async def get_system_prompt(agent: str = "main", user=Depends(check_session)):
    """Get the workspace files that form the system prompt for an agent."""
    import json as _json
    
    # Resolve workspace path for agent
    # Dynamically resolve agent workspace from agents_base
    agents_base = config.get_agents_base()
    agent_dir = os.path.join(agents_base, agent)
    # Try reading workspace from agent config, fallback to default
    workspace = os.path.expanduser('~/.openclaw/workspace')
    agent_config_path = os.path.join(agent_dir, 'agent', 'agent.json')
    if os.path.exists(agent_config_path):
        try:
            with open(agent_config_path) as _f:
                ac = _json.load(_f)
                if ac.get('workspace'):
                    workspace = os.path.expanduser(ac['workspace'])
        except Exception:
            pass
    
    # Files that OpenClaw injects into the system prompt (exact order from source)
    boot_files = [
        'AGENTS.md', 'SOUL.md', 'TOOLS.md', 'IDENTITY.md', 'USER.md',
        'HEARTBEAT.md', 'BOOTSTRAP.md', 'MEMORY.md',
    ]
    # Additional files loaded by agent on startup (not auto-injected)
    extra_files = ['CONTEXT.md', 'BOOT.md']
    
    files = []
    total_chars = 0
    for fname in boot_files:
        fpath = os.path.join(workspace, fname)
        if os.path.exists(fpath):
            try:
                with open(fpath, 'r') as f:
                    content = f.read()
                files.append({
                    'name': fname,
                    'path': fpath,
                    'size': len(content),
                    'tokens_est': len(content) // 4,
                    'content': content,
                    'type': 'injected',
                })
                total_chars += len(content)
            except Exception:
                files.append({'name': fname, 'path': fpath, 'size': 0, 'tokens_est': 0, 'content': '[read error]', 'type': 'injected'})
        else:
            files.append({'name': fname, 'path': fpath, 'size': 0, 'tokens_est': 0, 'content': '', 'type': 'missing'})
    
    # Extra files (loaded by agent, not auto-injected)
    for fname in extra_files:
        fpath = os.path.join(workspace, fname)
        if os.path.exists(fpath):
            try:
                with open(fpath, 'r') as f:
                    content = f.read()
                files.append({
                    'name': fname,
                    'path': fpath,
                    'size': len(content),
                    'tokens_est': len(content) // 4,
                    'content': content,
                    'type': 'agent-loaded',
                })
                total_chars += len(content)
            except Exception:
                pass
    
    # --- Skills (as injected into prompt) ---
    # Use `openclaw skills` CLI to get the actual runtime skill list.
    # This is the single source of truth — OpenClaw applies gating (binary probing,
    # env checks, OS filters, config enabled/disabled) internally.
    import subprocess as _sp
    import re as _re

    skills = []
    skills_total = 0
    try:
        result = _sp.run(['openclaw', 'skills'], capture_output=True, text=True, timeout=15)
        output = result.stdout or ''
        # Parse header line like "Skills (12/54 ready)"
        header_match = _re.search(r'Skills \((\d+)/(\d+) ready\)', output)
        if header_match:
            skills_total = int(header_match.group(2))
        # Parse table rows: Status | Emoji+Name | Description | Source
        # Ready skills have "✓ ready" in status column
        current_skill = None
        for line in output.split('\n'):
            if '│' not in line:
                continue
            cols = [c.strip() for c in line.split('│')]
            if len(cols) < 5:
                continue
            status_col = cols[1]
            name_col = cols[2]
            desc_col = cols[3]
            source_col = cols[4]
            # Detect if this is a new skill row (has status) or continuation
            if '✓ ready' in status_col or '△ needs setup' in status_col:
                # Strip emoji from name
                clean_name = _re.sub(r'[^\w\-]', '', name_col.encode('ascii', 'ignore').decode()).strip().strip('-')
                is_ready = '✓ ready' in status_col
                source = 'builtin'
                if 'managed' in source_col:
                    source = 'user'
                elif 'workspace' in source_col:
                    source = 'workspace'
                current_skill = {
                    'name': clean_name,
                    'source': source,
                    'status': 'ready' if is_ready else 'needs-setup',
                    'description': desc_col,
                }
                if is_ready:
                    skills.append(current_skill)
            elif current_skill and desc_col:
                # Continuation line — append to description
                current_skill['description'] += ' ' + desc_col
    except Exception as e:
        # Fallback: return empty with error note
        skills = [{'name': 'error', 'source': 'unknown', 'status': 'error', 'description': f'Failed to run openclaw skills: {e}'}]

    # Also resolve SKILL.md locations for the ready skills
    skill_search_dirs = [
        os.path.join(workspace, 'skills'),
        os.path.expanduser('~/.openclaw/skills'),
        '/opt/homebrew/lib/node_modules/openclaw/skills',
    ]
    for sk in skills:
        sk['location'] = ''
        for sd in skill_search_dirs:
            candidate = os.path.join(sd, sk['name'], 'SKILL.md')
            if os.path.isfile(candidate):
                sk['location'] = candidate
                break

    # Build the actual XML block that gets injected into every prompt
    skills_xml_lines = ['<available_skills>']
    for sk in skills:
        skills_xml_lines.append('  <skill>')
        skills_xml_lines.append(f'    <name>{sk["name"]}</name>')
        skills_xml_lines.append(f'    <description>{sk["description"]}</description>')
        skills_xml_lines.append(f'    <location>{sk.get("location", "")}</location>')
        skills_xml_lines.append('  </skill>')
    skills_xml_lines.append('</available_skills>')
    skills_xml = '\n'.join(skills_xml_lines)
    skills_chars = len(skills_xml)

    # --- Runtime prompt sections (these are injected by OpenClaw at API call time) ---
    runtime_sections = [
        'Tool availability & policies',
        'Safety rules',
        'OpenClaw CLI quick reference',
        'Model aliases',
        'Memory recall instructions',
        'LCM (Lossless Context Management) recall protocol',
        'Reply tags',
        'Messaging routing',
        'Group chat context',
        'Reactions config',
        'Silent replies (NO_REPLY)',
        'Runtime metadata (model, OS, channel, capabilities)',
        'Authorized senders',
        'Current date & time',
    ]

    total_chars += skills_chars

    return {
        'agent': agent,
        'workspace': workspace,
        'files': files,
        'skills': skills,
        'skills_count': len(skills),
        'skills_total': skills_total,
        'skills_chars': skills_chars,
        'skills_xml': skills_xml,
        'runtime_sections': runtime_sections,
        'total_chars': total_chars,
        'total_tokens_est': total_chars // 4,
        'file_count': len([f for f in files if f.get('type') != 'missing']),
    }

@app.get("/api/models")
async def get_models(user=Depends(check_session)):
    """Return available models with pricing from config."""
    model_pricing = config.get_model_pricing()
    models = []
    for model_id, pricing in model_pricing.items():
        models.append({
            'id': model_id,
            'input': pricing.get('input', 0),
            'output': pricing.get('output', 0),
            'cache_read': pricing.get('cache_read', 0),
            'cache_write': pricing.get('cache_write', 0),
        })
    return {'models': models}

@app.post("/api/prompt-simulate")
async def simulate_prompt(body: dict, user=Depends(check_session)):
    """Simulate prompt assembly for a sample user message.
    Returns token breakdown per section."""
    sample_text = body.get('text', '') or body.get('message', 'Wie wird das Wetter morgen?')
    agent = body.get('agent', 'main')

    # Get system prompt data
    import json as _json
    # Reuse the system-prompt endpoint logic
    sp_data = await get_system_prompt(agent=agent, user=user)

    # Estimate tokens (chars / 4 is a reasonable approximation)
    def est_tokens(text):
        return max(1, len(text) // 4) if text else 0

    # Build sections breakdown
    sections = []

    # 1. Runtime directives (tooling, safety, CLI, etc.)
    # Estimate from total minus workspace files minus skills
    workspace_chars = sum(f['size'] for f in sp_data['files'] if f.get('type') != 'missing')
    runtime_chars = max(0, sp_data['total_chars'] - workspace_chars - sp_data['skills_chars'])
    # Add a realistic estimate for runtime sections not counted in total_chars
    # (tool schemas, inbound meta, etc. — roughly 3-5K chars)
    runtime_overhead = 4000
    runtime_total = runtime_chars + runtime_overhead
    sections.append({
        'id': 'runtime',
        'label': 'Runtime-Direktiven',
        'sublabel': 'Tool-Policies, Sicherheitsregeln, CLI-Referenz, Model-Aliase, Reply-Tags, Messaging',
        'chars': runtime_total,
        'tokens': est_tokens('x' * runtime_total),
        'cached': True,
        'detail': 'Statisch pro Session. Wird von Anthropic prompt-cached nach dem ersten Call.',
    })

    # 2. Skills XML
    sections.append({
        'id': 'skills',
        'label': f'Skills-Index ({sp_data["skills_count"]}/{sp_data["skills_total"]})',
        'sublabel': 'XML-Block mit Name + Beschreibung + Pfad pro Skill',
        'chars': sp_data['skills_chars'],
        'tokens': est_tokens('x' * sp_data['skills_chars']),
        'cached': True,
        'detail': 'Index only — SKILL.md loaded on-demand when matched.',
    })

    # 3. Workspace files
    for f in sp_data['files']:
        if f.get('type') == 'missing':
            continue
        sections.append({
            'id': f'file_{f["name"]}',
            'label': f["name"],
            'sublabel': f'Workspace-Datei ({f["type"]})',
            'chars': f['size'],
            'tokens': f['tokens_est'],
            'cached': True,
            'detail': f'Injected via loadWorkspaceBootstrapFiles(). Max 2MB per file.',
        })

    # 4. Inbound Meta (dynamic per message)
    inbound_meta = _json.dumps({
        'schema': 'openclaw.inbound_meta.v1',
        'chat_id': 'telegram:XXXXXXXXXX',
        'account_id': 'default',
        'channel': 'telegram',
        'provider': 'telegram',
        'surface': 'telegram',
        'chat_type': 'direct',
    }, indent=2)
    sections.append({
        'id': 'inbound_meta',
        'label': 'Inbound Meta',
        'sublabel': 'Chat-Kontext: Sender, Kanal, Chat-Typ (JSON)',
        'chars': len(inbound_meta),
        'tokens': est_tokens(inbound_meta),
        'cached': False,
        'detail': 'Dynamic per message. Changes with different chat/sender.',
    })

    # 5. LCM summary headers (if context engine active)
    lcm_estimate = 800  # typical LCM condensed summary headers
    sections.append({
        'id': 'lcm_context',
        'label': 'LCM Kontext-Summaries',
        'sublabel': 'Komprimierte Gesprächshistorie (variabel)',
        'chars': lcm_estimate,
        'tokens': est_tokens('x' * lcm_estimate),
        'cached': False,
        'detail': 'Hängt von der Gesprächslänge ab. Ältere Turns werden zu Summaries komprimiert.',
    })

    # 6. Conversation history (recent turns)
    history_estimate = 2000  # typical recent turns
    sections.append({
        'id': 'history',
        'label': 'Recent Messages',
        'sublabel': 'Unkomprimierte aktuelle Turns (~5-10 Messages)',
        'chars': history_estimate,
        'tokens': est_tokens('x' * history_estimate),
        'cached': False,
        'detail': 'Aktuelle Turns bleiben ungekürzt. Je länger das Gespräch, desto mehr Tokens.',
    })

    # 7. User message
    sections.append({
        'id': 'user_message',
        'label': 'Your Message',
        'sublabel': f'"{sample_text}"',
        'chars': len(sample_text),
        'tokens': est_tokens(sample_text),
        'cached': False,
        'detail': 'The actual user message as the last element in the messages array.',
    })

    # 8. Tool schemas (sent as separate tools param)
    tool_schema_estimate = 12000  # ~30 tools × ~400 chars schema each
    sections.append({
        'id': 'tool_schemas',
        'label': 'Tool-Schemas',
        'sublabel': f'~30 Tool-Definitionen (JSON Schema, separater API-Parameter)',
        'chars': tool_schema_estimate,
        'tokens': est_tokens('x' * tool_schema_estimate),
        'cached': True,
        'detail': 'Nicht im System-Prompt, sondern als eigener tools-Parameter im API-Call. Anthropic cached diese ebenfalls.',
    })

    # Totals
    total_chars = sum(s['chars'] for s in sections)
    total_tokens = sum(s['tokens'] for s in sections)
    cached_tokens = sum(s['tokens'] for s in sections if s.get('cached'))
    uncached_tokens = total_tokens - cached_tokens

    # Cost estimate from config pricing
    model_pricing = config.get_model_pricing()
    default_pricing = config.get_default_pricing()
    
    # Resolve model from request (can be model ID or agent name)
    model_id = body.get('model', '')
    if not model_id:
        # Fallback to agent-based defaults
        agent_model_map = {'main': 'claude-opus-4-6', 'worker': 'claude-sonnet-4-6', 'gclight': 'claude-haiku-4-5'}
        model_id = agent_model_map.get(agent, 'claude-sonnet-4-6')
    
    mp = model_pricing.get(model_id, default_pricing)
    prices = {'input': mp.get('input', 3), 'cache_read': mp.get('cache_read', 0.3), 'output': mp.get('output', 15)}

    input_cost = (uncached_tokens / 1_000_000) * prices['input']
    cache_cost = (cached_tokens / 1_000_000) * prices['cache_read']
    # Assume ~500 token response
    output_est = 500
    output_cost = (output_est / 1_000_000) * prices['output']
    total_cost = input_cost + cache_cost + output_cost

    # Without cache: all tokens at full input price
    nocache_input_cost = (total_tokens / 1_000_000) * prices['input']
    nocache_total = nocache_input_cost + output_cost
    savings = nocache_total - total_cost
    savings_pct = (savings / nocache_total * 100) if nocache_total > 0 else 0

    # Skill match detection
    matched_skill = None
    sample_lower = sample_text.lower()
    for sk in sp_data.get('skills', []):
        desc_lower = sk.get('description', '').lower()
        name_lower = sk.get('name', '').lower()
        # Simple keyword matching
        if any(kw in sample_lower for kw in ['wetter', 'weather', 'temperatur', 'forecast']):
            if 'weather' in name_lower or 'wetter' in desc_lower or 'weather' in desc_lower:
                matched_skill = sk
                break
        if any(kw in sample_lower for kw in ['kurs', 'aktie', 'stock', 'price', 'isin']):
            if 'finance' in name_lower or 'kurs' in desc_lower or 'aktie' in desc_lower:
                matched_skill = sk
                break
        if any(kw in sample_lower for kw in ['notiz', 'note', 'notiere']):
            if 'note' in name_lower:
                matched_skill = sk
                break
        if any(kw in sample_lower for kw in ['erinnerung', 'reminder', 'erinnere']):
            if 'reminder' in name_lower:
                matched_skill = sk
                break
        if any(kw in sample_lower for kw in ['mail', 'email', 'e-mail']):
            if 'mail' in name_lower:
                matched_skill = sk
                break

    skill_load_tokens = 0
    if matched_skill and matched_skill.get('location'):
        try:
            with open(matched_skill['location'], 'r') as f:
                skill_content = f.read()
            skill_load_tokens = len(skill_content) // 4
        except Exception:
            skill_load_tokens = 1000  # estimate

    return {
        'message': sample_text,
        'agent': agent,
        'model': model_id,
        'sections': sections,
        'total_chars': total_chars,
        'total_tokens': total_tokens,
        'cached_tokens': cached_tokens,
        'uncached_tokens': uncached_tokens,
        'cost_estimate': {
            'input_cost': round(input_cost, 6),
            'cache_cost': round(cache_cost, 6),
            'output_cost': round(output_cost, 6),
            'total_cost': round(total_cost, 6),
            'output_tokens_est': output_est,
            'model_prices': prices,
            'without_cache': {
                'input_cost': round(nocache_input_cost, 6),
                'total_cost': round(nocache_total, 6),
            },
            'savings': round(savings, 6),
            'savings_pct': round(savings_pct, 1),
        },
        'matched_skill': matched_skill,
        'skill_load_tokens': skill_load_tokens,
    }


@app.post("/api/visualize-prompt")
async def visualize_prompt(body: dict, user=Depends(check_session)):
    """Step-by-step visualization of the real OpenClaw prompt pipeline.
    Returns 7 pipeline steps matching the actual buildAgentSystemPrompt() flow."""
    import time as _time
    import re as _re
    import subprocess as _sp

    sample_text = body.get('text', '') or body.get('message', 'Wie wird das Wetter morgen?')
    agent = body.get('agent', 'main')
    model_id = body.get('model', '')

    # ---- helpers ----
    def est_tokens(chars: int) -> int:
        return max(1, chars // 4) if chars else 0

    # Stopwords to ignore in matching
    _stopwords = {'der','die','das','ein','eine','und','oder','ist','von','zu','für','mit','auf','in','an','den','dem','des','im','am','um','ob','mal','du','ich','er','sie','es','wir','ihr','hast','hat','haben','wird','kann','soll','was','wie','wo','wer','nicht','auch','noch','schon','nur','aber','wenn','dass','denn','nach','bei'}

    def tokenize(text):
        tokens = set(_re.findall(r'\b\w+\b', text.lower()))
        return tokens - _stopwords

    def jaccard(a: set, b: set) -> float:
        if not a or not b:
            return 0.0
        return len(a & b) / len(a | b)

    # Synonym expansion for better matching
    _synonyms = {
        'marketcap': ['marktkapitalisierung','fundamentaldaten','kennzahlen','aktie'],
        'marktkapitalisierung': ['marketcap','fundamentaldaten','kennzahlen'],
        'kurs': ['aktienkurs','kurs','preis','quote','wertpapier'],
        'aktie': ['aktien','aktienkurs','wertpapier','kurs','börse'],
        'aktien': ['aktie','aktienkurs','wertpapier','kurs','börse'],
        'dividende': ['fundamentaldaten','kennzahlen','aktie'],
        'kgv': ['fundamentaldaten','kennzahlen','aktie'],
        'pe': ['fundamentaldaten','kennzahlen'],
        'wetter': ['weather','forecast','temperatur'],
        'weather': ['wetter','forecast','temperatur'],
        'chart': ['kursverlauf','historische','kursdaten'],
        'kursverlauf': ['chart','historische','kursdaten'],
        'optionsschein': ['derivat','zertifikat','knock'],
        'derivat': ['optionsschein','zertifikat','knock'],
        'mail': ['email','e-mail','senden','schicken'],
        'email': ['mail','e-mail','senden','schicken'],
        'notiz': ['note','notes','apple','notiere'],
        'notiere': ['note','notes','apple','notiz'],
        'reminder': ['erinnerung','reminders','apple'],
        'erinnerung': ['reminder','reminders','apple'],
    }

    def expand_tokens(tokens: set) -> set:
        expanded = set(tokens)
        for tok in tokens:
            if tok in _synonyms:
                expanded.update(_synonyms[tok])
        return expanded

    def substring_bonus(user_tokens: set, desc_text: str) -> float:
        """Bonus if user tokens appear as substrings in description or vice versa."""
        desc_lower = desc_text.lower()
        bonus = 0.0
        for tok in user_tokens:
            if len(tok) >= 4 and tok in desc_lower:
                bonus += 0.03
        # Also check if description words appear in user query
        user_text = ' '.join(user_tokens)
        desc_tokens = set(_re.findall(r'\b\w+\b', desc_lower)) - _stopwords
        for dtok in desc_tokens:
            if len(dtok) >= 4 and dtok in user_text:
                bonus += 0.02
        return min(bonus, 0.15)  # cap

    def ts() -> int:
        return int(_time.time() * 1000)

    # ---- Resolve workspace ----
    agents_base = config.get_agents_base()
    workspace = os.path.expanduser('~/.openclaw/workspace')
    agent_config_path = os.path.join(agents_base, agent, 'agent', 'agent.json')
    if os.path.exists(agent_config_path):
        try:
            with open(agent_config_path) as _acf:
                _ac = json.load(_acf)
                if _ac.get('workspace'):
                    workspace = os.path.expanduser(_ac['workspace'])
        except Exception:
            pass

    # Subagent/cron agents get minimal bootstrap
    MINIMAL_ALLOWLIST = ['AGENTS.md', 'TOOLS.md', 'SOUL.md', 'IDENTITY.md', 'USER.md']
    FULL_BOOTSTRAP = ['AGENTS.md', 'SOUL.md', 'TOOLS.md', 'IDENTITY.md', 'USER.md', 'HEARTBEAT.md', 'BOOTSTRAP.md', 'MEMORY.md']
    is_minimal = agent in ('subagent', 'cron', 'gclight')
    boot_files = MINIMAL_ALLOWLIST if is_minimal else FULL_BOOTSTRAP

    steps = []
    assembled_parts = []
    grand_total_chars = 0

    # ============================================================
    # STEP 1: Bootstrap Files
    # ============================================================
    t0 = ts()
    boot_items = []
    bootstrap_chars = 0
    for fname in boot_files:
        fpath = os.path.join(workspace, fname)
        found = os.path.isfile(fpath)
        chars = 0
        if found:
            try:
                with open(fpath, 'r') as f:
                    content = f.read()
                chars = len(content)
                bootstrap_chars += chars
                assembled_parts.append(f'## {fname}\n{content}')
            except Exception:
                found = False
        boot_items.append({
            'name': fname,
            'found': found,
            'chars': chars,
            'tokens': est_tokens(chars),
        })
    found_count = sum(1 for x in boot_items if x['found'])
    steps.append({
        'id': 'bootstrap',
        'label': 'Bootstrap Files',
        'icon': 'files',
        'status': 'success',
        'duration_ms': ts() - t0,
        'items': boot_items,
        'total_tokens': est_tokens(bootstrap_chars),
        'total_chars': bootstrap_chars,
        'cached': True,
        'detail': f'{len(boot_files)} files scanned, {found_count} found — MINIMAL_BOOTSTRAP={is_minimal}',
    })
    grand_total_chars += bootstrap_chars

    # ============================================================
    # STEP 2: Skills Discovery
    # ============================================================
    t0 = ts()
    skills = []
    skills_total = 0
    try:
        result = _sp.run(['openclaw', 'skills'], capture_output=True, text=True, timeout=15)
        output = result.stdout or ''
        header_match = _re.search(r'Skills \((\d+)/(\d+) ready\)', output)
        if header_match:
            skills_total = int(header_match.group(2))
        current_skill = None
        for line in output.split('\n'):
            if '│' not in line:
                continue
            cols = [c.strip() for c in line.split('│')]
            if len(cols) < 5:
                continue
            status_col, name_col, desc_col, source_col = cols[1], cols[2], cols[3], cols[4]
            if '✓ ready' in status_col or '△ needs setup' in status_col:
                clean_name = _re.sub(r'[^\w\-]', '', name_col.encode('ascii', 'ignore').decode()).strip().strip('-')
                is_ready = '✓ ready' in status_col
                source = 'user' if 'managed' in source_col else ('workspace' if 'workspace' in source_col else 'builtin')
                current_skill = {'name': clean_name, 'source': source, 'status': 'ready' if is_ready else 'needs-setup', 'description': desc_col}
                if is_ready:
                    skills.append(current_skill)
            elif current_skill and desc_col:
                current_skill['description'] += ' ' + desc_col
    except Exception as e:
        skills = [{'name': 'error', 'source': 'unknown', 'status': 'error', 'description': f'CLI error: {e}'}]

    # Resolve SKILL.md locations
    skill_search_dirs = [
        os.path.join(workspace, 'skills'),
        os.path.expanduser('~/.openclaw/skills'),
        '/opt/homebrew/lib/node_modules/openclaw/skills',
    ]
    for sk in skills:
        sk['location'] = ''
        for sd in skill_search_dirs:
            candidate = os.path.join(sd, sk['name'], 'SKILL.md')
            if os.path.isfile(candidate):
                sk['location'] = candidate
                break

    # Build skills XML block
    skills_xml_lines = ['<available_skills>']
    for sk in skills:
        skills_xml_lines += ['  <skill>', f'    <name>{sk["name"]}</name>',
                             f'    <description>{sk["description"]}</description>',
                             f'    <location>{sk.get("location", "")}</location>', '  </skill>']
    skills_xml_lines.append('</available_skills>')
    skills_xml = '\n'.join(skills_xml_lines)
    skills_chars = len(skills_xml)
    grand_total_chars += skills_chars

    skill_items = [{
        'name': sk['name'],
        'description': sk['description'][:120] + ('...' if len(sk['description']) > 120 else ''),
        'location': sk.get('location', ''),
        'status': sk.get('status', 'ready'),
        'source': sk.get('source', 'builtin'),
    } for sk in skills]

    steps.append({
        'id': 'skills',
        'label': 'Skills Discovery',
        'icon': 'skills',
        'status': 'success',
        'duration_ms': ts() - t0,
        'items': skill_items,
        'total_tokens': est_tokens(skills_chars),
        'total_chars': skills_chars,
        'cached': True,
        'detail': f'{len(skills)}/{skills_total} skills ready — XML-Block {est_tokens(skills_chars)} tokens',
    })
    assembled_parts.append(skills_xml)

    # ============================================================
    # STEP 3: Skill Matching (Jaccard similarity, no hardcoding)
    # ============================================================
    t0 = ts()
    MATCH_THRESHOLD = 0.02  # low threshold — LLM does semantic matching, we approximate
    user_tokens_raw = tokenize(sample_text)
    user_tokens_set = expand_tokens(user_tokens_raw)
    skill_scores = []
    for sk in skills:
        desc_tokens_set = tokenize(sk['description'])
        name_tokens_set = tokenize(sk['name'])
        score = jaccard(user_tokens_set, desc_tokens_set)
        # Bonus: name word overlap
        name_score = jaccard(user_tokens_set, name_tokens_set)
        # Bonus: substring matching (catches "marketcap" in "Fundamentaldaten" desc etc.)
        sub_bonus = substring_bonus(user_tokens_set, sk['description'] + ' ' + sk['name'])
        combined = score + name_score * 0.5 + sub_bonus
        skill_scores.append({'skill': sk, 'score': combined, 'desc_score': score, 'name_score': name_score})

    skill_scores.sort(key=lambda x: x['score'], reverse=True)
    top3 = skill_scores[:3]

    # Top match — load SKILL.md if above threshold
    matched_skill = None
    skill_load_tokens = 0
    if top3 and top3[0]['score'] >= MATCH_THRESHOLD:
        matched_skill = top3[0]['skill']
        if matched_skill.get('location'):
            try:
                with open(matched_skill['location'], 'r') as f:
                    skill_content = f.read()
                skill_load_tokens = len(skill_content) // 4
            except Exception:
                skill_load_tokens = 1000

    match_status = 'success' if matched_skill else 'warning'
    match_items = [{
        'name': entry['skill']['name'],
        'score': round(entry['score'], 4),
        'desc_score': round(entry['desc_score'], 4),
        'name_score': round(entry['name_score'], 4),
        'matched': entry['skill'] is matched_skill,
        'skill_md_tokens': skill_load_tokens if entry['skill'] is matched_skill else 0,
    } for entry in top3]

    steps.append({
        'id': 'skill_match',
        'label': 'Skill Matching',
        'icon': 'match',
        'status': match_status,
        'duration_ms': ts() - t0,
        'items': match_items,
        'total_tokens': skill_load_tokens,
        'total_chars': skill_load_tokens * 4,
        'cached': False,
        'detail': f'Jaccard similarity auf {len(skills)} Skills — threshold={MATCH_THRESHOLD}' +
                  (f' — Match: {matched_skill["name"]} ({top3[0]["score"]:.4f})' if matched_skill else ' — kein Match'),
        'matched_skill': matched_skill['name'] if matched_skill else None,
    })

    # ============================================================
    # STEP 4: Runtime Sections Assembly
    # ============================================================
    t0 = ts()
    RUNTIME_SECTIONS = [
        ('tooling',          'Tooling',              'Tool-Liste + Policies',               8000, True),
        ('tool_call_style',  'Tool Call Style',      'Stil-Vorgaben für Tool-Calls',        400,  True),
        ('safety',           'Safety',               'Sicherheitsregeln',                   600,  True),
        ('cli_reference',    'CLI Quick Reference',  'openclaw Befehle',                    800,  True),
        ('skills_mandatory', 'Skills (mandatory)',   'Skill-Matching Anleitung',            400,  True),
        ('memory_recall',    'Memory Recall',        'Erinnerungsprotokoll',                300,  True),
        ('model_aliases',    'Model Aliases',        'Modell-Shortnames',                   200,  True),
        ('workspace',        'Workspace',            'Pfad + Arbeitsmodus',                 150,  True),
        ('documentation',    'Documentation',        'Technische Doku-Links',               300,  True),
        ('authorized_senders','Authorized Senders',  'Telegram-Whitelist',                  200,  True),
        ('date_time',        'Date & Time',          'Aktuelle Zeit (dynamisch)',            100,  False),
        ('reply_tags',       'Reply Tags',           'NO_REPLY, HEARTBEAT_OK etc.',         200,  True),
        ('messaging',        'Messaging',            'Kanal-Routing & Format',              500,  True),
        ('reactions',        'Reactions',            'Emoji-Reaktionen Konfiguration',      150,  True),
        ('silent_replies',   'Silent Replies',       'When to send no reply',           150,  True),
        ('runtime_meta',     'Runtime Metadata',     'Model, OS, Channel, Capabilities',    200,  False),
    ]
    runtime_items = []
    runtime_cached_chars = 0
    runtime_dynamic_chars = 0
    for rid, rlabel, rsublabel, rchars, rcached in RUNTIME_SECTIONS:
        rtokens = est_tokens(rchars)
        runtime_items.append({
            'id': rid, 'label': rlabel, 'sublabel': rsublabel,
            'chars': rchars, 'tokens': rtokens, 'cached': rcached,
        })
        if rcached:
            runtime_cached_chars += rchars
        else:
            runtime_dynamic_chars += rchars
    runtime_total_chars = runtime_cached_chars + runtime_dynamic_chars
    grand_total_chars += runtime_total_chars

    steps.append({
        'id': 'runtime',
        'label': 'Runtime Sections Assembly',
        'icon': 'sections',
        'status': 'success',
        'duration_ms': ts() - t0,
        'items': runtime_items,
        'total_tokens': est_tokens(runtime_total_chars),
        'total_chars': runtime_total_chars,
        'cached': True,
        'detail': f'{len(RUNTIME_SECTIONS)} sections — {est_tokens(runtime_cached_chars)} cached + {est_tokens(runtime_dynamic_chars)} dynamic tokens',
    })

    # ============================================================
    # STEP 5: Context Files (Project Context)
    # ============================================================
    t0 = ts()
    soul_detected = os.path.isfile(os.path.join(workspace, 'SOUL.md'))
    context_items = []
    context_chars = 0
    for item in boot_items:
        if item['found']:
            context_items.append({
                'name': item['name'],
                'chars': item['chars'],
                'tokens': item['tokens'],
                'soul': item['name'] == 'SOUL.md',
                'note': '→ aktiviert extra Persona-Direktive' if item['name'] == 'SOUL.md' else '',
            })
            context_chars += item['chars']

    steps.append({
        'id': 'context_files',
        'label': 'Context Files (Project Context)',
        'icon': 'context',
        'status': 'success',
        'duration_ms': ts() - t0,
        'items': context_items,
        'total_tokens': est_tokens(context_chars),
        'total_chars': context_chars,
        'cached': True,
        'detail': f'{found_count} files injected as Project Context' +
                  (' — SOUL.md detected: extra Persona-Zeile aktiv' if soul_detected else ''),
        'soul_detected': soul_detected,
    })

    # ============================================================
    # STEP 6: Cache Boundary
    # ============================================================
    t0 = ts()
    # Everything before the boundary is cached; after = dynamic
    cached_sections = ['bootstrap', 'skills', 'runtime (cached parts)', 'context_files', 'tool_schemas']
    dynamic_sections = ['date_time', 'runtime_meta', 'inbound_meta', 'conversation_history', 'user_message']
    # Estimate sizes
    inbound_meta_chars = 280
    history_chars = 2000
    user_msg_chars = len(sample_text)
    tool_schema_chars = 12000

    cached_chars = bootstrap_chars + skills_chars + runtime_cached_chars + tool_schema_chars
    dynamic_chars = runtime_dynamic_chars + inbound_meta_chars + history_chars + user_msg_chars
    if matched_skill and skill_load_tokens:
        dynamic_chars += skill_load_tokens * 4  # SKILL.md loaded dynamically after boundary

    boundary_items = [
        {'section': 'Bootstrap Files',       'chars': bootstrap_chars,       'tokens': est_tokens(bootstrap_chars),       'side': 'cached'},
        {'section': 'Skills XML',             'chars': skills_chars,          'tokens': est_tokens(skills_chars),          'side': 'cached'},
        {'section': 'Runtime (statisch)',     'chars': runtime_cached_chars,  'tokens': est_tokens(runtime_cached_chars),  'side': 'cached'},
        {'section': 'Tool Schemas',           'chars': tool_schema_chars,     'tokens': est_tokens(tool_schema_chars),     'side': 'cached'},
        {'section': '── CACHE BOUNDARY ──',  'chars': 0,                     'tokens': 0,                                 'side': 'boundary'},
        {'section': 'Runtime (dynamisch)',    'chars': runtime_dynamic_chars, 'tokens': est_tokens(runtime_dynamic_chars), 'side': 'dynamic'},
        {'section': 'Inbound Meta',           'chars': inbound_meta_chars,    'tokens': est_tokens(inbound_meta_chars),    'side': 'dynamic'},
        {'section': 'Konversations-History',  'chars': history_chars,         'tokens': est_tokens(history_chars),         'side': 'dynamic'},
        {'section': 'User Message',           'chars': user_msg_chars,        'tokens': est_tokens(user_msg_chars),        'side': 'dynamic'},
    ]
    if matched_skill and skill_load_tokens:
        boundary_items.append({'section': f'SKILL.md ({matched_skill["name"]})',
                                'chars': skill_load_tokens * 4, 'tokens': skill_load_tokens, 'side': 'dynamic'})

    steps.append({
        'id': 'cache_boundary',
        'label': 'Cache Boundary',
        'icon': 'cache',
        'status': 'success',
        'duration_ms': ts() - t0,
        'items': boundary_items,
        'total_tokens': est_tokens(cached_chars) + est_tokens(dynamic_chars),
        'total_chars': cached_chars + dynamic_chars,
        'cached': True,
        'detail': f'Cached: {est_tokens(cached_chars):,} tokens (günstig) | Dynamic: {est_tokens(dynamic_chars):,} tokens (teuer)',
        'cached_tokens': est_tokens(cached_chars),
        'dynamic_tokens': est_tokens(dynamic_chars),
    })

    # ============================================================
    # STEP 7: Cost Calculation
    # ============================================================
    t0 = ts()
    model_pricing = config.get_model_pricing()
    default_pricing = config.get_default_pricing()
    if not model_id:
        agent_model_map = {'main': 'claude-opus-4-6', 'worker': 'claude-sonnet-4-6', 'gclight': 'claude-haiku-4-5'}
        model_id = agent_model_map.get(agent, 'claude-sonnet-4-6')
    mp = model_pricing.get(model_id, default_pricing)
    prices = {'input': mp.get('input', 3), 'output': mp.get('output', 15),
               'cache_write': mp.get('cache_write', 3.75), 'cache_read': mp.get('cache_read', 0.3)}

    total_cached_tokens = est_tokens(cached_chars)
    total_dynamic_tokens = est_tokens(dynamic_chars)
    output_est = 500

    cache_read_cost  = (total_cached_tokens  / 1_000_000) * prices['cache_read']
    input_cost       = (total_dynamic_tokens / 1_000_000) * prices['input']
    output_cost      = (output_est           / 1_000_000) * prices['output']
    total_cost       = cache_read_cost + input_cost + output_cost

    # Without cache
    nocache_input_cost = ((total_cached_tokens + total_dynamic_tokens) / 1_000_000) * prices['input']
    nocache_total      = nocache_input_cost + output_cost
    savings            = nocache_total - total_cost
    savings_pct        = (savings / nocache_total * 100) if nocache_total > 0 else 0

    cost_items = [
        {'label': 'Cached tokens (cache_read)',  'tokens': total_cached_tokens,  'rate': prices['cache_read'], 'cost': round(cache_read_cost, 6)},
        {'label': 'Dynamic tokens (input)',      'tokens': total_dynamic_tokens, 'rate': prices['input'],      'cost': round(input_cost, 6)},
        {'label': 'Output estimate',             'tokens': output_est,           'rate': prices['output'],     'cost': round(output_cost, 6)},
    ]

    steps.append({
        'id': 'cost',
        'label': 'Cost Calculation',
        'icon': 'cost',
        'status': 'success',
        'duration_ms': ts() - t0,
        'items': cost_items,
        'total_tokens': total_cached_tokens + total_dynamic_tokens + output_est,
        'total_chars': 0,
        'cached': False,
        'detail': f'Modell: {model_id} — Total: ${round(total_cost, 6)} (Ersparnis vs. kein Cache: ${round(savings, 6)}, {round(savings_pct, 1)}%)',
        'cost': {
            'cache_read_cost': round(cache_read_cost, 6),
            'input_cost': round(input_cost, 6),
            'output_cost': round(output_cost, 6),
            'total_cost': round(total_cost, 6),
            'nocache_total': round(nocache_total, 6),
            'savings': round(savings, 6),
            'savings_pct': round(savings_pct, 1),
            'model_id': model_id,
            'prices': prices,
            'output_tokens_est': output_est,
        },
    })

    # ============================================================
    # Assemble summary
    # ============================================================
    total_all_tokens = est_tokens(cached_chars) + est_tokens(dynamic_chars)
    # Append user message at the end (as the API sees it)
    assembled_parts.append(f'--- USER MESSAGE ---\n{sample_text}')
    assembled_preview = '\n\n'.join(assembled_parts)

    return {
        'steps': steps,
        'total_tokens': total_all_tokens,
        'cached_tokens': total_cached_tokens,
        'uncached_tokens': total_dynamic_tokens,
        'cost': {
            'total_cost': round(total_cost, 6),
            'savings': round(savings, 6),
            'savings_pct': round(savings_pct, 1),
            'model_id': model_id,
        },
        'assembled_prompt_preview': assembled_preview,
        'matched_skill': matched_skill['name'] if matched_skill else None,
        'skill_load_tokens': skill_load_tokens,
    }


@app.get("/api/real-prompts")
async def get_real_prompts(limit: int = 20, offset: int = 0, agent: str = "main", user=Depends(check_session)):
    """Return recent real prompt runs with token/cost breakdown from session JSONLs."""
    import glob
    # Use agent-specific sessions directory
    agents_base = config.get_agents_base()
    sessions_dir = os.path.join(agents_base, agent, 'sessions')
    if not os.path.isdir(sessions_dir):
        sessions_dir = config.get_sessions_dir()  # fallback to main
    # Load more files when paginating deeper
    max_files = max(10, (offset + limit) // 5 + 10)
    jsonl_files = sorted(glob.glob(os.path.join(sessions_dir, '*.jsonl')), key=os.path.getmtime, reverse=True)[:max_files]

    runs = []
    for jf in jsonl_files:
        session_id = os.path.basename(jf).replace('.jsonl', '')
        try:
            with open(jf, 'r') as f:
                lines = f.readlines()
        except Exception:
            continue

        # Find user messages and their following assistant responses
        messages = []
        for line in lines:
            try:
                d = json.loads(line)
                if d.get('type') == 'message':
                    messages.append(d)
            except Exception:
                continue

        # --- helper: extract clean user text from OpenClaw envelope ---
        def extract_user_text(content):
            if isinstance(content, list):
                raw = ' '.join(c.get('text', '') for c in content if isinstance(c, dict) and c.get('type') == 'text')
            elif isinstance(content, str):
                raw = content
            else:
                return ''
            if 'Conversation info' in raw:
                parts = raw.split('```')
                if len(parts) >= 3:
                    candidate = parts[-1].strip()
                    if candidate and not candidate.startswith('{') and not candidate.startswith('Sender'):
                        return candidate[:200]
                    for p in reversed(parts):
                        p = p.strip()
                        if p and not p.startswith('{') and not p.startswith('json') and not p.startswith('Conversation') and not p.startswith('Sender') and len(p) > 2:
                            return p[:200]
                return raw[:200]
            return raw[:200]

        # --- Group messages into user turns ---
        # A "turn" = one user message + all assistant responses until the next user message
        turns = []  # list of (user_msg_index, [assistant_msg_indices])
        current_user_idx = None
        current_assistants = []
        for idx, m in enumerate(messages):
            role = m.get('message', {}).get('role', '')
            if role == 'user':
                if current_user_idx is not None and current_assistants:
                    turns.append((current_user_idx, current_assistants))
                current_user_idx = idx
                current_assistants = []
            elif role == 'assistant':
                usage = m.get('message', {}).get('usage', {})
                if usage.get('totalTokens', 0) > 0:
                    current_assistants.append(idx)
        if current_user_idx is not None and current_assistants:
            turns.append((current_user_idx, current_assistants))

        # Process turns in reverse (newest first)
        for user_idx, asst_indices in reversed(turns):
            user_msg = messages[user_idx].get('message', {})
            user_text = extract_user_text(user_msg.get('content', ''))

            # Aggregate all API calls in this turn
            api_calls = []
            total_input = 0
            total_output = 0
            total_cache_read = 0
            total_cache_write = 0
            total_tokens = 0
            total_cost = 0
            model = 'unknown'
            last_timestamp = ''

            for ai in asst_indices:
                amsg = messages[ai].get('message', {})
                usage = amsg.get('usage', {})
                cost_data = usage.get('cost', {})
                call_input = usage.get('input', 0)
                call_output = usage.get('output', 0)
                call_cache_read = usage.get('cacheRead', 0)
                call_cache_write = usage.get('cacheWrite', 0)
                call_total = usage.get('totalTokens', 0)
                call_cost = cost_data.get('total', 0)

                total_input += call_input
                total_output += call_output
                total_cache_read += call_cache_read
                total_cache_write += call_cache_write
                total_tokens += call_total
                total_cost += call_cost
                model = amsg.get('model', model)
                last_timestamp = messages[ai].get('timestamp', last_timestamp)

                # Extract text from this assistant response
                a_content = amsg.get('content', '')
                if isinstance(a_content, list):
                    a_text = ' '.join(c.get('text', '') for c in a_content if isinstance(c, dict) and c.get('type') == 'text')
                elif isinstance(a_content, str):
                    a_text = a_content
                else:
                    a_text = ''

                api_calls.append({
                    'tokens': call_total,
                    'output': call_output,
                    'cost': call_cost,
                    'response_preview': a_text[:500],
                })

            # Final assistant response = last one with text
            final_response = ''
            for ai in reversed(asst_indices):
                amsg = messages[ai].get('message', {})
                a_content = amsg.get('content', '')
                if isinstance(a_content, list):
                    final_response = ' '.join(c.get('text', '') for c in a_content if isinstance(c, dict) and c.get('type') == 'text')
                elif isinstance(a_content, str):
                    final_response = a_content
                if final_response.strip():
                    break

            runs.append({
                'session_id': session_id,
                'timestamp': last_timestamp,
                'model': model,
                'user_message': user_text,
                'assistant_response': final_response[:2000],
                'api_calls': len(asst_indices),
                'api_call_details': api_calls,
                'input_tokens': total_input,
                'output_tokens': total_output,
                'cache_read': total_cache_read,
                'cache_write': total_cache_write,
                'total_tokens': total_tokens,
                'cost_total': round(total_cost, 6),
                'cost_input': 0,
                'cost_output': 0,
                'cost_cache_read': 0,
                'cost_cache_write': 0,
                'cache_pct': round(total_cache_read / max(total_tokens, 1) * 100, 1),
            })
            if len(runs) >= offset + limit:
                break
        if len(runs) >= offset + limit:
            break

    # Sort by timestamp descending
    runs.sort(key=lambda x: x['timestamp'], reverse=True)
    return runs[offset:offset + limit]


@app.post("/api/refresh")
async def trigger_refresh(user=Depends(check_session)):
    """Trigger data collector + transcript collector."""
    import subprocess
    backend_dir = os.path.dirname(__file__)
    venv_python = os.path.join(backend_dir, '..', 'venv', 'bin', 'python')
    cwd = os.path.join(backend_dir, '..')
    outputs = []
    
    # 1. Gateway/Agent collector
    collector_path = os.path.join(backend_dir, 'collector.py')
    try:
        r1 = subprocess.run([venv_python, collector_path], capture_output=True, text=True, timeout=30, cwd=cwd)
        outputs.append(f"collector: {r1.stdout[-300:] if r1.stdout else 'ok'}")
    except Exception as e:
        outputs.append(f"collector error: {e}")
    
    # 2. Transcript collector (API key + model breakdown)
    transcript_path = os.path.join(backend_dir, 'transcript_collector.py')
    try:
        r2 = subprocess.run([venv_python, transcript_path], capture_output=True, text=True, timeout=60, cwd=cwd)
        outputs.append(f"transcript: {r2.stdout[-300:] if r2.stdout else 'ok'}")
    except Exception as e:
        outputs.append(f"transcript error: {e}")
    
    # 3. Prompt collector (session analysis)
    prompt_path = os.path.join(backend_dir, 'prompt_collector.py')
    try:
        r3 = subprocess.run([venv_python, prompt_path], capture_output=True, text=True, timeout=120, cwd=cwd)
        outputs.append(f"prompt: {r3.stdout[-300:] if r3.stdout else 'ok'}")
    except Exception as e:
        outputs.append(f"prompt error: {e}")
    
    return {"status": "ok", "output": "\n".join(outputs)}

# === Prompt History Endpoints ===

@app.get("/api/prompt-sessions")
async def get_prompt_sessions(
    days: int = 7,
    user: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    offset: int = 0,
    limit: int = 50,
    db: Session = Depends(get_db),
    _user=Depends(check_session)
):
    """List sessions that have turns in time range."""
    if date_from:
        start_date = datetime.fromisoformat(date_from)
    else:
        start_date = datetime.utcnow() - timedelta(days=days)
    # Find sessions that have at least one turn in the time range
    turn_filter = PromptTurn.started_at >= start_date
    if date_to:
        turn_filter = turn_filter & (PromptTurn.started_at < datetime.fromisoformat(date_to))
    active_sids = db.query(PromptTurn.session_id).filter(turn_filter).distinct().subquery()
    q = db.query(PromptSession).filter(PromptSession.session_id.in_(db.query(active_sids)))
    if user:
        q = q.filter(PromptSession.user_category == user)
    total = q.count()
    sessions = q.order_by(desc(PromptSession.last_message_at)).offset(offset).limit(limit).all()
    return {
        "total": total,
        "offset": offset,
        "limit": limit,
        "sessions": [
            {
                "session_id": s.session_id,
                "user_category": s.user_category,
                "started_at": s.started_at.isoformat() if s.started_at else None,
                "last_message_at": s.last_message_at.isoformat() if s.last_message_at else None,
                "total_turns": s.total_turns,
                "total_api_calls": s.total_api_calls,
                "total_tokens": s.total_tokens,
                "total_cost": s.total_cost,
                "primary_model": s.primary_model,
            }
            for s in sessions
        ]
    }

@app.get("/api/prompt-history")
async def get_prompt_history(
    days: int = 7,
    user: Optional[str] = None,
    session_id: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    offset: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    _user=Depends(check_session)
):
    """Get prompt turns chronologically."""
    if date_from:
        start_date = datetime.fromisoformat(date_from)
    else:
        start_date = datetime.utcnow() - timedelta(days=days)
    q = db.query(PromptTurn).filter(PromptTurn.started_at >= start_date)
    if date_to:
        q = q.filter(PromptTurn.started_at < datetime.fromisoformat(date_to))
    if session_id:
        q = q.filter(PromptTurn.session_id == session_id)
    if user:
        # Join with session to filter by user
        q = q.join(PromptSession, PromptTurn.session_id == PromptSession.session_id)
        q = q.filter(PromptSession.user_category == user)
    total = q.count()
    turns = q.order_by(desc(PromptTurn.started_at)).offset(offset).limit(limit).all()
    
    # Get session info for each turn
    session_ids = list(set(t.session_id for t in turns))
    sessions_map = {}
    if session_ids:
        sessions = db.query(PromptSession).filter(PromptSession.session_id.in_(session_ids)).all()
        sessions_map = {s.session_id: s for s in sessions}
    
    return {
        "total": total,
        "offset": offset,
        "limit": limit,
        "turns": [
            {
                "session_id": t.session_id,
                "user_category": sessions_map.get(t.session_id, None) and sessions_map[t.session_id].user_category,
                "turn_index": t.turn_index,
                "user_message": t.user_message,
                "assistant_response": t.assistant_response,
                "started_at": t.started_at.isoformat() if t.started_at else None,
                "ended_at": t.ended_at.isoformat() if t.ended_at else None,
                "duration_ms": t.duration_ms,
                "api_calls": t.api_calls,
                "tool_calls": t.tool_calls,
                "tool_names": t.tool_names,
                "total_tokens_input": t.total_tokens_input,
                "total_tokens_output": t.total_tokens_output,
                "total_tokens_cache_read": t.total_tokens_cache_read,
                "total_tokens_cache_write": t.total_tokens_cache_write,
                "total_cost": t.total_cost,
                "model": t.model,
            }
            for t in turns
        ]
    }

@app.get("/api/prompt-history/{session_id}/turn/{turn_index}")
async def get_turn_detail(
    session_id: str,
    turn_index: int,
    db: Session = Depends(get_db),
    _user=Depends(check_session)
):
    """Get API calls for a specific turn."""
    turn = db.query(PromptTurn).filter(
        PromptTurn.session_id == session_id,
        PromptTurn.turn_index == turn_index
    ).first()
    if not turn:
        raise HTTPException(status_code=404, detail="Turn not found")
    
    calls = db.query(PromptApiCall).filter(
        PromptApiCall.session_id == session_id,
        PromptApiCall.turn_index == turn_index
    ).order_by(PromptApiCall.call_index).all()
    
    return {
        "turn": {
            "session_id": turn.session_id,
            "turn_index": turn.turn_index,
            "user_message": turn.user_message_full or turn.user_message,
            "assistant_response": turn.assistant_response,
            "started_at": turn.started_at.isoformat() if turn.started_at else None,
            "ended_at": turn.ended_at.isoformat() if turn.ended_at else None,
            "duration_ms": turn.duration_ms,
            "api_calls": turn.api_calls,
            "tool_calls": turn.tool_calls,
            "tool_names": turn.tool_names,
            "total_cost": turn.total_cost,
            "model": turn.model,
        },
        "calls": [
            {
                "call_index": c.call_index,
                "message_id": c.message_id,
                "timestamp": c.timestamp.isoformat() if c.timestamp else None,
                "model": c.model,
                "provider": c.provider,
                "stop_reason": c.stop_reason,
                "tokens_input": c.tokens_input,
                "tokens_output": c.tokens_output,
                "tokens_cache_read": c.tokens_cache_read,
                "tokens_cache_write": c.tokens_cache_write,
                "cost_total": c.cost_total,
                "content_preview": c.content_preview,
                "tool_name": c.tool_name,
            }
            for c in calls
        ]
    }

@app.get("/api/prompt-stats")
async def get_prompt_stats(
    days: int = 7,
    user: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    db: Session = Depends(get_db),
    _user=Depends(check_session)
):
    """Summary stats for prompt history — aggregates from turns in time range."""
    if date_from:
        start_date = datetime.fromisoformat(date_from)
    else:
        start_date = datetime.utcnow() - timedelta(days=days)
    # Query turns in time range, join session for user_category
    tq = db.query(PromptTurn).join(PromptSession, PromptTurn.session_id == PromptSession.session_id).filter(PromptTurn.started_at >= start_date)
    if date_to:
        tq = tq.filter(PromptTurn.started_at < datetime.fromisoformat(date_to))
    if user:
        tq = tq.filter(PromptSession.user_category == user)
    turns = tq.all()
    
    # Build session map for categories
    session_ids = set(t.session_id for t in turns)
    sessions_map = {}
    if session_ids:
        for s in db.query(PromptSession).filter(PromptSession.session_id.in_(session_ids)).all():
            sessions_map[s.session_id] = s
    
    total_sessions = len(session_ids)
    total_turns = len(turns)
    total_api_calls = sum(t.api_calls or 0 for t in turns)
    total_tokens = sum((t.total_tokens_input or 0) + (t.total_tokens_output or 0) + (t.total_tokens_cache_read or 0) + (t.total_tokens_cache_write or 0) for t in turns)
    total_cost = sum(t.total_cost or 0 for t in turns)
    
    # By user category
    by_user = {}
    for t in turns:
        s = sessions_map.get(t.session_id)
        cat = (s.user_category if s else None) or 'unknown'
        if cat not in by_user:
            by_user[cat] = {'sessions': set(), 'turns': 0, 'api_calls': 0, 'cost': 0.0}
        by_user[cat]['sessions'].add(t.session_id)
        by_user[cat]['turns'] += 1
        by_user[cat]['api_calls'] += t.api_calls or 0
        by_user[cat]['cost'] += t.total_cost or 0
    # Convert sets to counts
    for cat in by_user:
        by_user[cat]['sessions'] = len(by_user[cat]['sessions'])
    
    return {
        "total_sessions": total_sessions,
        "total_turns": total_turns,
        "total_api_calls": total_api_calls,
        "total_tokens": total_tokens,
        "total_cost": total_cost,
        "by_user": by_user,
    }

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "timestamp": datetime.utcnow()}


# ─── Live Agents ───────────────────────────────────────────────

from agent_collector import collect_agents, parse_session_file
import glob

AGENTS_SESSIONS_DIR = os.path.expanduser("~/.openclaw/agents/main/sessions")

@app.get("/api/agents/live")
async def get_live_agents(
    hours: int = 24,
    status_filter: Optional[str] = None,
    _=Depends(check_session),
):
    """Get live and recent subagent runs (spawned agents only)."""
    agents = collect_agents(max_age_hours=hours, include_types=['subagent'])
    
    if status_filter:
        agents = [a for a in agents if a['status'] == status_filter]
    
    # Summary stats
    running = [a for a in agents if a['status'] == 'running']
    subagents = [a for a in agents if a['is_subagent']]
    crons = [a for a in agents if a['is_cron']]
    
    return {
        "total": len(agents),
        "running": len(running),
        "subagents_count": len(subagents),
        "crons_count": len(crons),
        "total_cost": sum(a['total_cost'] for a in agents),
        "total_api_calls": sum(a['api_calls'] for a in agents),
        "total_tool_calls": sum(a['tool_calls_count'] for a in agents),
        "agents": [
            {
                'session_id': a['session_id'],
                'session_type': a['session_type'],
                'status': a['status'],
                'task': a['task'],
                'label': a['label'],
                'model': a['model'],
                'requester': a['requester'],
                'started_at': a['started_at'],
                'ended_at': a['ended_at'],
                'duration_ms': a['duration_ms'],
                'api_calls': a['api_calls'],
                'tool_calls_count': a['tool_calls_count'],
                'tokens_input': a['tokens_input'],
                'tokens_output': a['tokens_output'],
                'tokens_total': a['tokens_total'],
                'total_cost': a['total_cost'],
                'final_response': a['final_response'][:500],
            }
            for a in agents
        ],
    }

@app.get("/api/agents/{session_id}")
async def get_agent_detail(
    session_id: str,
    _=Depends(check_session),
):
    """Get detailed info for a single agent run including tool calls."""
    # Find the session file
    candidates = glob.glob(os.path.join(AGENTS_SESSIONS_DIR, f"{session_id}.jsonl*"))
    if not candidates:
        raise HTTPException(status_code=404, detail="Session not found")
    
    result = parse_session_file(candidates[0])
    if result is None:
        raise HTTPException(status_code=404, detail="Could not parse session")
    
    return result

# =============================================================================
# Settings API
# =============================================================================

@app.get("/api/settings")
async def get_settings(user=Depends(check_session)):
    """Return current config (password redacted)."""
    raw = config.get_raw()
    # Redact sensitive fields for display
    safe = dict(raw)
    if 'auth' in safe:
        safe['auth'] = dict(safe['auth'])
        safe['auth']['password'] = '••••••••'
        safe['auth']['secret_key'] = '••••••••'
    return safe


@app.put("/api/settings")
async def update_settings(request: Request, user=Depends(check_session)):
    """Update config from frontend. Merges with existing, preserves unset auth fields."""
    body = await request.json()
    current = config.get_raw()
    
    # Merge: don't overwrite redacted auth fields
    if 'auth' in body:
        auth = body['auth']
        if auth.get('password') == '••••••••' or not auth.get('password'):
            auth['password'] = current.get('auth', {}).get('password', 'changeme')
        if auth.get('secret_key') == '••••••••' or not auth.get('secret_key'):
            auth['secret_key'] = current.get('auth', {}).get('secret_key', 'changeme')
    
    config.save_raw(body)
    return {"status": "ok", "message": "Configuration saved"}


@app.put("/api/settings/password")
async def update_password(request: Request, user=Depends(check_session)):
    """Update only the dashboard password."""
    body = await request.json()
    new_pw = body.get('password', '')
    if not new_pw or len(new_pw) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    raw = config.get_raw()
    if 'auth' not in raw:
        raw['auth'] = {}
    raw['auth']['password'] = new_pw
    config.save_raw(raw)
    return {"status": "ok", "message": "Password updated"}


# ─── Collector Status ──────────────────────────────────────────

@app.get("/api/collector-status")
async def get_collector_status(db: Session = Depends(get_db), user=Depends(check_session)):
    """Live status of all data collection jobs"""
    import subprocess, re
    from pathlib import Path

    collectors = []
    log_path = Path(os.path.expanduser("~/.openclaw/clawscope/data/collector.log"))

    # Parse collector log for last run times and errors
    log_content = log_path.read_text() if log_path.exists() else ""
    log_lines = log_content.strip().split("\n") if log_content.strip() else []

    def find_last_run(marker: str):
        """Find last occurrence of marker in log, return timestamp + error status.
        Only checks errors between this marker and the next section marker."""
        last_idx = None
        last_ts = None
        for i, line in enumerate(log_lines):
            if marker in line:
                last_idx = i
                m = re.search(r'(\d{4}-\d{2}-\d{2} \d{2}:\d{2})', line)
                if m:
                    last_ts = m.group(1)
                m2 = re.search(r'(\w{3} \w{3} +\d+ \d{2}:\d{2}:\d{2} \w+ \d{4})', line)
                if m2:
                    try:
                        last_ts = datetime.strptime(m2.group(1), '%a %b %d %H:%M:%S %Z %Y').strftime('%Y-%m-%d %H:%M')
                    except Exception:
                        pass
        # Check errors only in the block after last marker until next === marker
        has_error = False
        if last_idx is not None:
            for line in log_lines[last_idx + 1:]:
                if line.startswith('==='):
                    break  # next section starts
                if 'Traceback' in line or 'ModuleNotFoundError' in line:
                    has_error = True
                    break
        return last_ts, has_error

    # 1. Gateway Cost Collector (collector.py)
    coll_ts, coll_err = find_last_run('Collection ')
    # Check if gateway data exists
    gw_count = db.query(func.count(TokenUsage.id)).filter(TokenUsage.source == 'gateway').scalar() or 0
    latest_gw = db.query(func.max(TokenUsage.date)).filter(TokenUsage.source == 'gateway').scalar()
    collectors.append({
        "name": "Gateway Costs",
        "description": "Daily cost aggregation from OpenClaw gateway",
        "schedule": "Every 30 min",
        "last_run": coll_ts,
        "status": "error" if coll_err else ("ok" if coll_ts else "never"),
        "records": gw_count,
        "latest_data": str(latest_gw) if latest_gw else None,
    })

    # 2. Transcript Collector
    tc_ts, tc_err = find_last_run('Transcript Collector')
    tc_count = db.query(func.count(TokenUsage.id)).filter(TokenUsage.source == 'transcript').scalar() or 0
    latest_tc = db.query(func.max(TokenUsage.date)).filter(TokenUsage.source == 'transcript').scalar()
    collectors.append({
        "name": "Transcript Usage",
        "description": "Token usage extracted from session JSONL files (8 agents)",
        "schedule": "Every 30 min",
        "last_run": tc_ts,
        "status": "error" if tc_err else ("ok" if tc_ts else "never"),
        "records": tc_count,
        "latest_data": str(latest_tc) if latest_tc else None,
    })

    # 3. Prompt History Collector
    ph_ts, ph_err = find_last_run('Prompt History Collector')
    ph_sessions = db.query(func.count(PromptSession.id)).scalar() or 0
    ph_turns = db.query(func.count(PromptTurn.id)).scalar() or 0
    ph_calls = db.query(func.count(PromptApiCall.id)).scalar() or 0
    collectors.append({
        "name": "Prompt History",
        "description": "Session turns and API calls for prompt analysis",
        "schedule": "Every 30 min",
        "last_run": ph_ts,
        "status": "error" if ph_err else ("ok" if ph_ts else "never"),
        "records": ph_calls,
        "details": f"{ph_sessions} sessions, {ph_turns} turns, {ph_calls} API calls",
    })

    # 4. LaunchAgent status (query each label individually for reliable PID)
    agents = []
    for label in ["ai.openclaw.clawscope", "ai.openclaw.clawscope-collector"]:
        try:
            result = subprocess.run(["launchctl", "list", label], capture_output=True, text=True, timeout=5)
            output = result.stdout
            pid_match = re.search(r'"PID"\s*=\s*(\d+)', output)
            exit_match = re.search(r'"LastExitStatus"\s*=\s*(\d+)', output)
            pid = pid_match.group(1) if pid_match else None
            exit_code = int(exit_match.group(1)) if exit_match else None
            agents.append({
                "label": label,
                "pid": pid,
                "exit_code": exit_code,
                "running": pid is not None,
            })
        except Exception:
            agents.append({"label": label, "running": False, "pid": None, "exit_code": None})

    # DB file sizes
    db_dir = Path(os.path.expanduser("~/.openclaw/clawscope/data"))
    db_files = []
    for f in sorted(db_dir.glob("*.db")):
        db_files.append({"name": f.name, "size_mb": round(f.stat().st_size / 1024 / 1024, 2)})

    return {
        "collectors": collectors,
        "launch_agents": agents,
        "db_files": db_files,
        "log_path": str(log_path),
        "log_tail": "\n".join(log_lines[-20:]) if log_lines else "",
    }


@app.get("/api/settings/users")
async def get_users(user=Depends(check_session)):
    """Return known users list."""
    return config.get_users()


@app.get("/api/settings/api-key-labels")
async def get_api_key_labels(user=Depends(check_session)):
    """Return API key → label mapping."""
    return config.get_api_key_labels()


# ─── Version & Update ──────────────────────────────────────────

import urllib.request

@app.get("/api/version")
async def get_version(user=Depends(check_session)):
    """Return local version and check GitHub for updates."""
    result = {"local": CLAWSCOPE_VERSION, "remote": None, "update_available": False}
    try:
        # Use GitHub API (60s cache) instead of raw.githubusercontent (5min cache)
        req = urllib.request.Request(
            "https://api.github.com/repos/applab-ai/clawscope/contents/backend/main.py?ref=main",
            headers={"User-Agent": "Clawscope", "Accept": "application/vnd.github.raw+json"}
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            for line in resp.read().decode().splitlines():
                if line.startswith("CLAWSCOPE_VERSION"):
                    remote = line.split('"')[1]
                    result["remote"] = remote
                    result["update_available"] = remote != CLAWSCOPE_VERSION
                    break
    except Exception:
        pass
    return result


@app.post("/api/update")
async def run_update(user=Depends(check_session)):
    """Pull latest from GitHub, rebuild frontend, restart backend."""
    project_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    steps = []
    try:
        # git pull
        r = subprocess.run(["git", "pull", "--ff-only"], capture_output=True, text=True, cwd=project_dir, timeout=30)
        steps.append({"step": "git pull", "ok": r.returncode == 0, "output": (r.stdout + r.stderr).strip()[:500]})
        if r.returncode != 0:
            return {"success": False, "steps": steps}

        # pip install
        venv_pip = os.path.join(project_dir, ".venv", "bin", "pip")
        if os.path.exists(venv_pip):
            r = subprocess.run([venv_pip, "install", "-r", "backend/requirements.txt", "-q"], capture_output=True, text=True, cwd=project_dir, timeout=60)
            steps.append({"step": "pip install", "ok": r.returncode == 0, "output": (r.stdout + r.stderr).strip()[:300]})

        # npm build
        frontend_dir = os.path.join(project_dir, "frontend")
        if os.path.exists(os.path.join(frontend_dir, "package.json")):
            r = subprocess.run(["npx", "vite", "build"], capture_output=True, text=True, cwd=frontend_dir, timeout=120,
                             env={**os.environ, "PATH": f"/opt/homebrew/bin:/usr/local/bin:{os.environ.get('PATH', '')}" })
            steps.append({"step": "npm build", "ok": r.returncode == 0, "output": (r.stdout + r.stderr).strip()[:300]})

        # Restart via launchctl
        uid = os.getuid()
        r = subprocess.run(["launchctl", "kickstart", "-k", f"gui/{uid}/ai.openclaw.clawscope"], capture_output=True, text=True, timeout=10)
        steps.append({"step": "restart", "ok": r.returncode == 0, "output": (r.stdout + r.stderr).strip()[:200]})

        return {"success": all(s["ok"] for s in steps), "steps": steps}
    except Exception as e:
        steps.append({"step": "error", "ok": False, "output": str(e)})
        return {"success": False, "steps": steps}


# Catch-all for frontend routing
@app.get("/{path:path}")
async def serve_frontend(path: str, request: Request):
    """Serve frontend for all unmatched routes"""
    return await read_root(request)

if __name__ == "__main__":
    import uvicorn
    server_cfg = config.get_raw().get("server", {})
    host = os.environ.get("CLAWSCOPE_HOST", server_cfg.get("host", "0.0.0.0"))
    port = int(os.environ.get("CLAWSCOPE_PORT", server_cfg.get("port", 8000)))
    uvicorn.run(app, host=host, port=port)