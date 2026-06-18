import os
import psycopg2
import psycopg2.extras
import uuid
import datetime
import logging
import httpx
from typing import Dict, List, Any, Optional
from app.core.config import get_settings
from app.core.security import encrypt_key, decrypt_key

logger = logging.getLogger(__name__)
settings = get_settings()

class PostgresConnectionWrapper:
    """
    Transparent connection wrapper that returns a cursor that automatically 
    translates SQLite '?' parameter placeholders to PostgreSQL '%s' placeholders.
    Allows modules like graph.py to run SQLite queries against RDS PostgreSQL unchanged.
    """
    def __init__(self, conn):
        self._conn = conn
    
    def cursor(self):
        return PostgresCursorWrapper(self._conn.cursor())
    
    def commit(self):
        self._conn.commit()
        
    def rollback(self):
        self._conn.rollback()
        
    def close(self):
        self._conn.close()
        
    def __enter__(self):
        return self
        
    def __exit__(self, exc_type, exc_val, exc_tb):
        if exc_type is not None:
            self.rollback()
        else:
            self.commit()
        self.close()

class PostgresCursorWrapper:
    def __init__(self, cursor):
        self._cursor = cursor
        
    def execute(self, query, params=None):
        if params is not None:
            # Safely translate SQLite '?' placeholders to PostgreSQL '%s'
            query = query.replace('?', '%s')
        self._cursor.execute(query, params)
        
    def fetchone(self):
        row = self._cursor.fetchone()
        return dict(row) if row else None
        
    def fetchall(self):
        rows = self._cursor.fetchall()
        return [dict(r) for r in rows] if rows else []
        
    @property
    def rowcount(self):
        return self._cursor.rowcount
        
    def __enter__(self):
        return self
        
    def __exit__(self, exc_type, exc_val, exc_tb):
        self._cursor.close()

def get_pg_connection():
    """
    Returns a standard connection to the PostgreSQL database on AWS RDS.
    """
    return psycopg2.connect(
        host=settings.AWS_RDS_HOST,
        port=settings.AWS_RDS_PORT,
        database=settings.AWS_RDS_DATABASE,
        user=settings.AWS_RDS_USER,
        password=settings.AWS_RDS_PASSWORD,
        cursor_factory=psycopg2.extras.RealDictCursor
    )

def get_db_connection():
    """
    Returns a wrapped thread-safe connection translating SQLite dialect to PostgreSQL.
    """
    return PostgresConnectionWrapper(get_pg_connection())

def verify_database_integrity():
    """
    Runs at startup and logs the count of rows in each table.
    """
    logger.info("Verifying RDS database integrity...")
    try:
        conn = get_pg_connection()
        cursor = conn.cursor()
        tables = ["users", "chats", "messages", "api_keys", "entities", "relationships"]
        for table in tables:
            try:
                cursor.execute(f"SELECT COUNT(*) as cnt FROM {table}")
                row = cursor.fetchone()
                count = row["cnt"] if row else 0
                print(f"Table '{table}' has {count} rows in RDS.")
                logger.info(f"Table '{table}' has {count} rows in RDS.")
            except Exception as e:
                print(f"Error checking RDS table '{table}': {e}")
                logger.error(f"Error checking RDS table '{table}': {e}")
        conn.close()
    except Exception as e:
        logger.error(f"Failed to connect to RDS to verify database integrity: {e}")

def init_db():
    """
    Initializes the AWS RDS PostgreSQL database schemas.
    """
    if not settings.AWS_RDS_HOST:
        logger.warning("AWS_RDS_HOST not configured. Skipping RDS schema initialization.")
        return
        
    logger.info(f"Initializing RDS database at {settings.AWS_RDS_HOST}")
    try:
        conn = get_pg_connection()
        cursor = conn.cursor()
        
        try:
            cursor.execute('CREATE EXTENSION IF NOT EXISTS "pgcrypto";')
        except Exception as e:
            logger.warning(f"Could not create pgcrypto extension: {e}")
            conn.rollback()
            
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            email TEXT NOT NULL UNIQUE,
            display_name TEXT,
            nickname TEXT,
            avatar_url TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW()
        );
        """)
        
        try:
            cursor.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS hashed_password TEXT;")
            conn.commit()
        except Exception as e:
            logger.warning(f"Could not add hashed_password column to users table: {e}")
            conn.rollback()
        
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS chats (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            title TEXT DEFAULT 'New Session',
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        );
        """)
        
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS messages (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
            user_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            model_used TEXT,
            input_tokens INTEGER DEFAULT 0,
            output_tokens INTEGER DEFAULT 0,
            cost NUMERIC DEFAULT 0,
            savings NUMERIC DEFAULT 0,
            created_at TIMESTAMPTZ DEFAULT NOW()
        );
        """)
        
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS api_keys (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            provider TEXT NOT NULL,
            encrypted_key TEXT NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(user_id, provider)
        );
        """)
        
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS entities (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            type TEXT NOT NULL,
            description TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW()
        );
        """)
        
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS relationships (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
            source TEXT NOT NULL,
            relation TEXT NOT NULL,
            target TEXT NOT NULL,
            description TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW()
        );
        """)
        
        try:
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id);")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(chat_id, created_at);")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_chats_user_id ON chats(user_id);")
        except Exception as e:
            logger.error(f"Error creating indexes on RDS: {e}")
            
        conn.commit()
        conn.close()
        verify_database_integrity()
    except Exception as e:
        logger.error(f"Error initializing RDS database: {e}")

if settings.AWS_RDS_HOST:
    init_db()

print(f"[SUPABASE] URL configured: {bool(settings.SUPABASE_URL)}")
print(f"[SUPABASE] Key configured: {bool(settings.SUPABASE_SERVICE_ROLE_KEY)}")

def get_supabase_headers():
    key = settings.SUPABASE_SERVICE_ROLE_KEY or settings.SUPABASE_KEY
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal"
    }

_supabase_online = True

def check_supabase_connectivity():
    global _supabase_online
    url = settings.SUPABASE_URL
    if not url:
        _supabase_online = False
        return
    try:
        import socket
        from urllib.parse import urlparse
        hostname = urlparse(url).hostname
        if hostname:
            socket.gethostbyname(hostname)
            _supabase_online = True
        else:
            _supabase_online = False
    except Exception:
        print("[SUPABASE] Warning: Failed to resolve Supabase hostname. Supabase is unreachable (possibly paused). Falling back to local/RDS-only mode.")
        _supabase_online = False

check_supabase_connectivity()

def is_supabase_active() -> bool:
    url = settings.SUPABASE_URL
    role_key = settings.SUPABASE_SERVICE_ROLE_KEY
    key = role_key if role_key else settings.SUPABASE_KEY
    return bool(url and key and not key.startswith("sb_service_role_key_xxx") and not key.startswith("sb_publishable_") and _supabase_online)

def supabase_upsert(table: str, data: List[Dict[str, Any]]) -> bool:
    if not is_supabase_active():
        return False
    try:
        url = f"{settings.SUPABASE_URL.rstrip('/')}/rest/v1/{table}"
        headers = get_supabase_headers()
        headers["Prefer"] = "resolution=merge-duplicates"
        with httpx.Client(timeout=10.0) as client:
            res = client.post(url, headers=headers, json=data)
            if res.status_code in [200, 201, 204]:
                return True
            err_msg = f"[SUPABASE ERROR] Upsert on '{table}' failed with status {res.status_code}: {res.text}"
            print(err_msg)
            logger.error(err_msg)
            return False
    except Exception as e:
        err_msg = f"[SUPABASE ERROR] Upsert exception on '{table}': {e}"
        print(err_msg)
        logger.error(err_msg)
        return False

def supabase_select(table: str, query_params: Dict[str, str]) -> Optional[List[Dict[str, Any]]]:
    if not is_supabase_active():
        return None
    try:
        url = f"{settings.SUPABASE_URL.rstrip('/')}/rest/v1/{table}"
        headers = get_supabase_headers()
        with httpx.Client(timeout=10.0) as client:
            res = client.get(url, headers=headers, params=query_params)
            if res.status_code == 200:
                return res.json()
            err_msg = f"[SUPABASE ERROR] Select on '{table}' failed with status {res.status_code}: {res.text}"
            print(err_msg)
            logger.error(err_msg)
            return None
    except Exception as e:
        err_msg = f"[SUPABASE ERROR] Select exception on '{table}': {e}"
        print(err_msg)
        logger.error(err_msg)
        return None

def supabase_delete(table: str, query_params: Dict[str, str]) -> bool:
    if not is_supabase_active():
        return False
    try:
        url = f"{settings.SUPABASE_URL.rstrip('/')}/rest/v1/{table}"
        headers = get_supabase_headers()
        with httpx.Client(timeout=10.0) as client:
            res = client.delete(url, headers=headers, params=query_params)
            if res.status_code in [200, 204]:
                return True
            err_msg = f"[SUPABASE ERROR] Delete on '{table}' failed with status {res.status_code}: {res.text}"
            print(err_msg)
            logger.error(err_msg)
            return False
    except Exception as e:
        err_msg = f"[SUPABASE ERROR] Delete exception on '{table}': {e}"
        print(err_msg)
        logger.error(err_msg)
        return False

def supabase_patch(table: str, query_params: Dict[str, str], data: Dict[str, Any]) -> bool:
    if not is_supabase_active():
        return False
    try:
        url = f"{settings.SUPABASE_URL.rstrip('/')}/rest/v1/{table}"
        headers = get_supabase_headers()
        with httpx.Client(timeout=10.0) as client:
            res = client.patch(url, headers=headers, params=query_params, json=data)
            if res.status_code in [200, 204]:
                return True
            err_msg = f"[SUPABASE ERROR] Patch on '{table}' failed with status {res.status_code}: {res.text}"
            print(err_msg)
            logger.error(err_msg)
            return False
    except Exception as e:
        err_msg = f"[SUPABASE ERROR] Patch exception on '{table}': {e}"
        print(err_msg)
        logger.error(err_msg)
        return False

def upsert_user(
    user_id: str,
    email: str,
    display_name: Optional[str] = None,
    nickname: Optional[str] = None,
    avatar_url: Optional[str] = None
) -> Dict[str, Any]:
    payload = {
        "id": user_id,
        "email": email,
        "display_name": display_name,
        "nickname": nickname,
        "avatar_url": avatar_url
    }
    
    conn = get_pg_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
        INSERT INTO users (id, email, display_name, nickname, avatar_url)
        VALUES (%s, %s, %s, %s, %s)
        ON CONFLICT(id) DO UPDATE SET
            email = EXCLUDED.email,
            display_name = COALESCE(EXCLUDED.display_name, users.display_name),
            nickname = COALESCE(EXCLUDED.nickname, users.nickname),
            avatar_url = COALESCE(EXCLUDED.avatar_url, users.avatar_url)
        """, (user_id, email, display_name, nickname, avatar_url))
        conn.commit()
        
        cursor.execute("SELECT * FROM users WHERE id = %s", (user_id,))
        row = cursor.fetchone()
        return dict(row) if row else payload
    except Exception as e:
        logger.error(f"Error upserting user: {e}")
        return payload
    finally:
        conn.close()

def delete_user_data(user_id: str) -> bool:
    if is_supabase_active():
        params = {"user_id": f"eq.{user_id}"}
        supabase_delete("relationships", params)
        supabase_delete("entities", params)
        
    conn = get_pg_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("DELETE FROM relationships WHERE user_id = %s", (user_id,))
        cursor.execute("DELETE FROM entities WHERE user_id = %s", (user_id,))
        cursor.execute("DELETE FROM messages WHERE user_id = %s", (user_id,))
        cursor.execute("DELETE FROM api_keys WHERE user_id = %s", (user_id,))
        cursor.execute("DELETE FROM chats WHERE user_id = %s", (user_id,))
        cursor.execute("DELETE FROM users WHERE id = %s", (user_id,))
        conn.commit()
        return True
    except Exception as e:
        logger.error(f"Error deleting user data: {e}")
        return False
    finally:
        conn.close()

def save_user_keys(user_id: str, keys: Dict[str, Optional[str]]) -> bool:
    enc_key = settings.ENCRYPTION_KEY or "t1ZryBFuuDk7BqOkNC_ttxcmXlzx61eIK9AXh72Cw5Y="
    if len(enc_key) < 32:
        enc_key = enc_key.ljust(32, "=")[:32]
        
    conn = get_pg_connection()
    cursor = conn.cursor()
    try:
        for provider, val in keys.items():
            if val is not None:
                encrypted_val = encrypt_key(val, enc_key)
                cursor.execute("""
                INSERT INTO api_keys (user_id, provider, encrypted_key, updated_at)
                VALUES (%s, %s, %s, NOW())
                ON CONFLICT (user_id, provider) DO UPDATE SET
                    encrypted_key = EXCLUDED.encrypted_key,
                    updated_at = NOW()
                """, (user_id, provider, encrypted_val))
            else:
                cursor.execute("DELETE FROM api_keys WHERE user_id = %s AND provider = %s", (user_id, provider))
        conn.commit()
        return True
    except Exception as e:
        logger.error(f"Error saving user keys: {e}")
        return False
    finally:
        conn.close()

def get_user_keys(user_id: str) -> Dict[str, Optional[str]]:
    enc_key = settings.ENCRYPTION_KEY or "t1ZryBFuuDk7BqOkNC_ttxcmXlzx61eIK9AXh72Cw5Y="
    if len(enc_key) < 32:
        enc_key = enc_key.ljust(32, "=")[:32]

    decrypted_keys = {"gemini": None, "groq": None, "deepseek": None, "openrouter": None}
    conn = get_pg_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT provider, encrypted_key FROM api_keys WHERE user_id = %s", (user_id,))
        rows = cursor.fetchall()
        for row in rows:
            prov = row["provider"]
            enc_val = row["encrypted_key"]
            if prov in decrypted_keys and enc_val:
                try:
                    decrypted_keys[prov] = decrypt_key(enc_val, enc_key)
                except Exception:
                    pass
        return decrypted_keys
    except Exception as e:
        logger.error(f"Error fetching user keys: {e}")
        return decrypted_keys
    finally:
        conn.close()

def get_user_keys_masked(user_id: str) -> Dict[str, Any]:
    keys = get_user_keys(user_id)
    masked = {}
    configured = {}
    for provider, key in keys.items():
        configured[f"{provider}_key_configured"] = key is not None and len(key) > 0
        if key:
            prefix = key[:4] if len(key) >= 8 else key[:2]
            masked[f"{provider}_key_masked"] = f"{prefix}..." + "x" * 4
        else:
            masked[f"{provider}_key_masked"] = ""
            
    return {**configured, **masked}

def create_chat(user_id: str, title: str) -> str:
    chat_id = str(uuid.uuid4())
    conn = get_pg_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            "INSERT INTO chats (id, user_id, title) VALUES (%s, %s, %s)",
            (chat_id, user_id, title)
        )
        conn.commit()
        return chat_id
    except Exception as e:
        logger.error(f"Error creating chat: {e}")
        return ""
    finally:
        conn.close()

def get_user_chats(user_id: str) -> List[Dict[str, Any]]:
    conn = get_pg_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT * FROM chats WHERE user_id = %s ORDER BY created_at DESC", (user_id,))
        rows = cursor.fetchall()
        result = []
        for r in rows:
            d = dict(r)
            if isinstance(d.get("created_at"), datetime.datetime):
                d["created_at"] = d["created_at"].isoformat()
            if isinstance(d.get("updated_at"), datetime.datetime):
                d["updated_at"] = d["updated_at"].isoformat()
            result.append(d)
        return result
    except Exception as e:
        logger.error(f"Error getting chats: {e}")
        return []
    finally:
        conn.close()

def delete_chat(user_id: str, chat_id: str) -> bool:
    conn = get_pg_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("DELETE FROM chats WHERE id = %s AND user_id = %s", (chat_id, user_id))
        conn.commit()
        return True
    except Exception as e:
        logger.error(f"Error deleting chat: {e}")
        return False
    finally:
        conn.close()

def log_message(
    user_id: str,
    chat_id: str,
    role: str,
    content: str,
    model: Optional[str] = None,
    input_tokens: int = 0,
    output_tokens: int = 0,
    cost: float = 0.0,
    savings: float = 0.0,
    memory_active: int = 0
) -> str:
    msg_id = str(uuid.uuid4())
    conn = get_pg_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            INSERT INTO messages (id, chat_id, user_id, role, content, model_used, input_tokens, output_tokens, cost, savings)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (msg_id, chat_id, user_id, role, content, model, input_tokens, output_tokens, cost, savings)
        )
        cursor.execute(
            "UPDATE chats SET updated_at = NOW() WHERE id = %s",
            (chat_id,)
        )
        conn.commit()
        return msg_id
    except Exception as e:
        logger.error(f"Error logging message to RDS: {e}")
        return ""
    finally:
        conn.close()

def get_chat_messages(user_id: str, chat_id: str, limit: int = 50, offset: int = 0) -> List[Dict[str, Any]]:
    conn = get_pg_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            SELECT messages.* FROM messages
            JOIN chats ON messages.chat_id = chats.id
            WHERE messages.chat_id = %s AND chats.user_id = %s
            ORDER BY messages.created_at DESC
            LIMIT %s OFFSET %s
            """,
            (chat_id, user_id, limit, offset)
        )
        rows = cursor.fetchall()
        local_messages = []
        for row in rows:
            d = dict(row)
            d["id"] = str(d["id"])
            if d.get("model_used"):
                d["model"] = d.get("model_used")
            elif d.get("model") and not d.get("model_used"):
                d["model_used"] = d.get("model")
            if isinstance(d.get("created_at"), datetime.datetime):
                d["created_at"] = d["created_at"].isoformat()
            for k in ["cost", "savings"]:
                if d.get(k) is not None:
                    d[k] = float(d[k])
            local_messages.append(d)
        return list(reversed(local_messages))
    except Exception as e:
        logger.error(f"Error getting messages: {e}")
        return []
    finally:
        conn.close()

def get_messages(user_id: str, chat_id: str) -> List[Dict[str, Any]]:
    return get_chat_messages(user_id, chat_id)

def get_user_stats(user_id: str) -> Dict[str, Any]:
    conn = get_pg_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            SELECT 
                COALESCE(SUM(cost), 0.0) as total_cost,
                COALESCE(SUM(savings), 0.0) as total_savings,
                COALESCE(SUM(input_tokens), 0) as total_input_tokens,
                COALESCE(SUM(output_tokens), 0) as total_output_tokens,
                COUNT(messages.id) as total_messages
            FROM messages
            JOIN chats ON messages.chat_id = chats.id
            WHERE chats.user_id = %s AND messages.role = 'assistant'
            """,
            (user_id,)
        )
        totals = dict(cursor.fetchone() or {})
        
        cursor.execute(
            """
            SELECT 
                COALESCE(model_used, '') as model,
                COUNT(messages.id) as count,
                COALESCE(SUM(cost), 0.0) as cost,
                COALESCE(SUM(savings), 0.0) as savings,
                COALESCE(SUM(input_tokens), 0) as input_tokens,
                COALESCE(SUM(output_tokens), 0) as output_tokens
            FROM messages
            JOIN chats ON messages.chat_id = chats.id
            WHERE chats.user_id = %s AND messages.role = 'assistant' AND model_used IS NOT NULL
            GROUP BY model_used
            """,
            (user_id,)
        )
        rows = cursor.fetchall()
        model_breakdown = [dict(row) for row in rows]
        
        for k in ["total_cost", "total_savings"]:
            if totals.get(k) is not None:
                totals[k] = float(totals[k])
        for m in model_breakdown:
            for k in ["cost", "savings"]:
                if m.get(k) is not None:
                    m[k] = float(m[k])
                    
        return {
            **totals,
            "model_breakdown": model_breakdown
        }
    except Exception as e:
        logger.error(f"Error aggregating user stats: {e}")
        return {
            "total_cost": 0.0,
            "total_savings": 0.0,
            "total_input_tokens": 0,
            "total_output_tokens": 0,
            "total_messages": 0,
            "model_breakdown": []
        }
    finally:
        conn.close()

def get_recent_messages(user_id: str, chat_id: str, limit: int = 5) -> List[Dict[str, Any]]:
    conn = get_pg_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            SELECT messages.id, role, content, model_used as model FROM messages
            JOIN chats ON messages.chat_id = chats.id
            WHERE messages.chat_id = %s AND chats.user_id = %s
            ORDER BY messages.created_at DESC LIMIT %s
            """,
            (chat_id, user_id, limit * 2)
        )
        rows = cursor.fetchall()
        result = []
        for r in rows:
            d = dict(r)
            d["id"] = str(d["id"])
            result.append(d)
        return list(reversed(result))
    except Exception as e:
        logger.error(f"Error getting recent messages: {e}")
        return []
    finally:
        conn.close()

def update_chat_title(user_id: str, chat_id: str, title: str) -> bool:
    conn = get_pg_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("UPDATE chats SET title = %s, updated_at = NOW() WHERE id = %s AND user_id = %s", (title, chat_id, user_id))
        conn.commit()
        return cursor.rowcount > 0
    except Exception as e:
        logger.error(f"Error updating chat title: {e}")
        return False
    finally:
        conn.close()

def get_chat_message_count(user_id: str, chat_id: str) -> int:
    conn = get_pg_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            SELECT COUNT(messages.id) as cnt FROM messages
            JOIN chats ON messages.chat_id = chats.id
            WHERE messages.chat_id = %s AND chats.user_id = %s
            """,
            (chat_id, user_id)
        )
        row = cursor.fetchone()
        return row["cnt"] if row else 0
    except Exception as e:
        logger.error(f"Error counting messages: {e}")
        return 0
    finally:
        conn.close()

def sync_local_db_to_supabase(user_id: str) -> None:
    pass
