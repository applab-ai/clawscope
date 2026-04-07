from sqlalchemy import create_engine, Column, Integer, String, DateTime, Float, Boolean, Text, UniqueConstraint, text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import os
from datetime import datetime

# Database setup
DATABASE_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
os.makedirs(DATABASE_DIR, exist_ok=True)
DATABASE_URL = f"sqlite:///{os.path.join(DATABASE_DIR, 'status.db')}"

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

# Models
class CronJob(Base):
    __tablename__ = "cron_jobs"
    
    id = Column(Integer, primary_key=True, index=True)
    cron_id = Column(String, index=True)  # openclaw cron job UUID
    name = Column(String, index=True)
    enabled = Column(Boolean, default=True)
    schedule = Column(String)
    model = Column(String)
    last_status = Column(String)  # ok/error/overloaded
    last_error = Column(Text)
    next_run = Column(String)
    consecutive_errors = Column(Integer, default=0)
    total_tokens = Column(Integer, default=0)
    total_cost = Column(Float, default=0)
    total_runs = Column(Integer, default=0)
    avg_tokens_per_run = Column(Integer, default=0)
    avg_cost_per_run = Column(Float, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow)

class ActiveSession(Base):
    __tablename__ = "active_sessions"
    
    id = Column(Integer, primary_key=True, index=True)
    session_key = Column(String, index=True)
    model = Column(String)
    tokens_total = Column(Integer, default=0)
    tokens_input = Column(Integer, default=0)
    tokens_output = Column(Integer, default=0)
    estimated_cost = Column(Float, default=0.0)
    status = Column(String)
    session_type = Column(String)  # Direct/Cron/Subagent
    start_time = Column(DateTime)
    runtime_minutes = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow)

class TokenUsage(Base):
    __tablename__ = "token_usage"
    
    id = Column(Integer, primary_key=True, index=True)
    date = Column(String, index=True)  # YYYY-MM-DD
    source = Column(String, index=True)  # 'gateway' oder 'transcript'
    api_key = Column(String, index=True)  # 'total' for Gateway, user categories for Transcripts
    model = Column(String, index=True)  # 'all' für Gateway, konkretes Model für Transcripts
    channel = Column(String, index=True)  # telegram, whatsapp, discord, system, etc.
    tokens_input = Column(Integer, default=0)
    tokens_output = Column(Integer, default=0)
    tokens_cache_write = Column(Integer, default=0)
    tokens_cache_read = Column(Integer, default=0)
    cost_input = Column(Float, default=0.0)
    cost_output = Column(Float, default=0.0)
    cost_cache_write = Column(Float, default=0.0)
    cost_cache_read = Column(Float, default=0.0)
    cost_total = Column(Float, default=0.0)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # UNIQUE constraint auf (date, source, api_key, model)
    __table_args__ = (
        UniqueConstraint('date', 'source', 'api_key', 'model', name='unique_token_usage'),
    )

class PromptSession(Base):
    __tablename__ = "prompt_sessions"
    id = Column(Integer, primary_key=True)
    session_id = Column(String, unique=True, index=True)  # UUID aus JSONL
    agent_id = Column(String, index=True)  # main/worker/gclight/etc.
    user_category = Column(String, index=True)  # user/admin/cron/subagent
    started_at = Column(DateTime, index=True)
    last_message_at = Column(DateTime, index=True)
    total_turns = Column(Integer, default=0)
    total_api_calls = Column(Integer, default=0)
    total_tokens = Column(Integer, default=0)
    total_cost = Column(Float, default=0.0)
    primary_model = Column(String)
    last_parsed_bytes = Column(Integer, default=0)  # For incremental processing
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow)

class PromptTurn(Base):
    __tablename__ = "prompt_turns"
    id = Column(Integer, primary_key=True)
    session_id = Column(String, index=True)  # FK to session UUID
    turn_index = Column(Integer)  # Sequential turn number in session
    user_message = Column(Text)  # User prompt (truncated to 500 chars for display)
    user_message_full = Column(Text)  # Full user message
    started_at = Column(DateTime, index=True)
    ended_at = Column(DateTime)
    duration_ms = Column(Integer, default=0)
    api_calls = Column(Integer, default=0)  # Number of assistant responses in this turn
    tool_calls = Column(Integer, default=0)  # Number of tool uses
    tool_names = Column(String)  # Comma-separated tool names used
    total_tokens_input = Column(Integer, default=0)
    total_tokens_output = Column(Integer, default=0)
    total_tokens_cache_read = Column(Integer, default=0)
    total_tokens_cache_write = Column(Integer, default=0)
    total_cost = Column(Float, default=0.0)
    model = Column(String)  # Primary model used
    assistant_response = Column(Text)  # Final assistant text (truncated to 500 chars)
    created_at = Column(DateTime, default=datetime.utcnow)
    __table_args__ = (UniqueConstraint('session_id', 'turn_index', name='unique_turn'),)

class PromptApiCall(Base):
    __tablename__ = "prompt_api_calls"
    id = Column(Integer, primary_key=True)
    session_id = Column(String, index=True)
    turn_index = Column(Integer, index=True)  # Which turn this belongs to
    call_index = Column(Integer)  # Sequential within turn
    message_id = Column(String)  # From JSONL
    parent_id = Column(String)
    timestamp = Column(DateTime, index=True)
    model = Column(String)
    provider = Column(String)
    stop_reason = Column(String)  # stop/toolUse
    tokens_input = Column(Integer, default=0)
    tokens_output = Column(Integer, default=0)
    tokens_cache_read = Column(Integer, default=0)
    tokens_cache_write = Column(Integer, default=0)
    cost_input = Column(Float, default=0.0)
    cost_output = Column(Float, default=0.0)
    cost_cache_read = Column(Float, default=0.0)
    cost_cache_write = Column(Float, default=0.0)
    cost_total = Column(Float, default=0.0)
    content_preview = Column(Text)  # First 200 chars of response
    tool_name = Column(String)  # If stopReason=toolUse, which tool
    created_at = Column(DateTime, default=datetime.utcnow)
    __table_args__ = (UniqueConstraint('session_id', 'message_id', name='unique_api_call'),)

class CronRun(Base):
    __tablename__ = "cron_runs"
    
    id = Column(Integer, primary_key=True, index=True)
    job_name = Column(String, index=True)
    job_id = Column(String, index=True)
    agent_id = Column(String)
    model = Column(String)
    run_at = Column(DateTime, index=True)
    status = Column(String)  # ok/error/skipped
    duration_ms = Column(Integer, default=0)
    error = Column(Text)
    consecutive_errors = Column(Integer, default=0)
    delivered = Column(Boolean, default=False)
    tokens_total = Column(Integer, default=0)
    cost_est = Column(Float, default=0.0)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    __table_args__ = (
        UniqueConstraint('job_id', 'run_at', name='unique_cron_run'),
    )

def _ensure_schema_updates():
    """Best-effort lightweight migrations for existing installs."""
    with engine.begin() as conn:
        try:
            cols = {row[1] for row in conn.execute(text("PRAGMA table_info(prompt_sessions)"))}
            if 'agent_id' not in cols:
                conn.execute(text("ALTER TABLE prompt_sessions ADD COLUMN agent_id VARCHAR"))
        except Exception:
            pass

        indexes = {row[1] for row in conn.execute(text("PRAGMA index_list(prompt_sessions)"))}
        if 'ix_prompt_sessions_agent_id' not in indexes:
            try:
                conn.execute(text("CREATE INDEX ix_prompt_sessions_agent_id ON prompt_sessions (agent_id)"))
            except Exception:
                pass
        if 'ix_prompt_sessions_last_message_at' not in indexes:
            try:
                conn.execute(text("CREATE INDEX ix_prompt_sessions_last_message_at ON prompt_sessions (last_message_at)"))
            except Exception:
                pass

        turn_indexes = {row[1] for row in conn.execute(text("PRAGMA index_list(prompt_turns)"))}
        if 'ix_prompt_turns_session_id_started_at' not in turn_indexes:
            try:
                conn.execute(text("CREATE INDEX ix_prompt_turns_session_id_started_at ON prompt_turns (session_id, started_at DESC)"))
            except Exception:
                pass

        call_indexes = {row[1] for row in conn.execute(text("PRAGMA index_list(prompt_api_calls)"))}
        if 'ix_prompt_api_calls_session_turn_call' not in call_indexes:
            try:
                conn.execute(text("CREATE INDEX ix_prompt_api_calls_session_turn_call ON prompt_api_calls (session_id, turn_index, call_index)"))
            except Exception:
                pass

# Create tables
def create_tables():
    Base.metadata.create_all(bind=engine)
    _ensure_schema_updates()

# Dependency
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()