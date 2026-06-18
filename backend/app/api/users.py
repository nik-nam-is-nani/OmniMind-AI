from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from pydantic import BaseModel, Field
from typing import Optional
import httpx
import logging

from app.core.security import verify_clerk_token
from app.core.database import upsert_user, get_user_chats, create_chat, delete_user_data, get_db_connection
from app.core.graph import delete_user_graph_data, ensure_session_node
from app.core.config import get_settings

router = APIRouter()
logger = logging.getLogger(__name__)

class UserInitRequest(BaseModel):
    email: str = Field(default="developer@omnimind.ai")
    display_name: Optional[str] = None
    nickname: Optional[str] = None
    avatar_url: Optional[str] = None

@router.post("/init")
async def init_user(
    payload: UserInitRequest,
    background_tasks: BackgroundTasks,
    user_id: str = Depends(verify_clerk_token)
):
    """
    Onboards/Upserts the user profile into SQLite and Supabase.
    Determines if user is new by checking nickname presence before upsert.
    If the user has zero existing chat sessions, auto-creates a default chat session and Neo4j node.
    """
    try:
        # Trigger background database sync from SQLite to Supabase
        from app.core.database import sync_local_db_to_supabase
        background_tasks.add_task(sync_local_db_to_supabase, user_id)

        # Check if user already exists and has a nickname before we upsert
        is_new_user = True
        conn = get_db_connection()
        cursor = conn.cursor()
        try:
            cursor.execute("SELECT nickname FROM users WHERE id = ?", (user_id,))
            row = cursor.fetchone()
            if row and row["nickname"]:
                is_new_user = False
        except Exception as e:
            logger.warning(f"Error checking existing user nickname: {e}")
        finally:
            conn.close()

        # Upsert the user profile details
        user_profile = upsert_user(
            user_id=user_id,
            email=payload.email,
            display_name=payload.display_name,
            nickname=payload.nickname,
            avatar_url=payload.avatar_url
        )
        
        # Check if the user has any chat sessions
        chats = get_user_chats(user_id)
        default_chat_created = False
        default_chat_id = None
        
        if not chats:
            default_chat_id = create_chat(user_id, "New Session")
            default_chat_created = True
            
            # Sync to Neo4j
            try:
                ensure_session_node(user_id, default_chat_id, "New Session")
            except Exception as graph_err:
                logger.warning(f"Failed to create default Neo4j session node: {graph_err}")
                
            chats = get_user_chats(user_id)
            
        return {
            "success": True,
            "user": user_profile,
            "is_new_user": is_new_user,
            "default_chat_created": default_chat_created,
            "default_chat_id": default_chat_id,
            "chats": chats
        }
    except Exception as e:
        logger.error(f"Error initializing user profile: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to initialize user session: {str(e)}"
        )

@router.delete("/me")
async def delete_me(user_id: str = Depends(verify_clerk_token)):
    """
    Permanently deletes a user's entire account, cascading deletions to:
    1. Clerk API (if Clerk is configured)
    2. Supabase Cloud Database (if active)
    3. Neo4j Graph DB instances
    4. SQLite Local Databases
    """
    if user_id == "dev_user":
        # Clear database and graph for offline dev mode
        db_success = delete_user_data(user_id)
        graph_success = delete_user_graph_data(user_id)
        return {
            "success": db_success and graph_success,
            "message": "Offline developer data wiped successfully."
        }
        
    settings = get_settings()
    clerk_deleted = False
    
    # 1. Cascade to Clerk API
    if settings.CLERK_SECRET_KEY:
        clerk_url = f"https://api.clerk.com/v1/users/{user_id}"
        headers = {
            "Authorization": f"Bearer {settings.CLERK_SECRET_KEY}",
            "Content-Type": "application/json"
        }
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                res = await client.delete(clerk_url, headers=headers)
                if res.status_code in [200, 204]:
                    clerk_deleted = True
                    logger.info(f"Successfully deleted user '{user_id}' from Clerk.")
                else:
                    logger.warning(f"Clerk deletion returned status {res.status_code}: {res.text}")
        except Exception as e:
            logger.error(f"Failed calling Clerk user deletion: {e}")
            
    # 2 & 3 & 4. Cascade to Supabase, Neo4j, and local SQLite
    db_success = delete_user_data(user_id)
    graph_success = delete_user_graph_data(user_id)
    
    return {
        "success": db_success and graph_success,
        "clerk_deleted": clerk_deleted,
        "message": "Account deletion completed."
    }
