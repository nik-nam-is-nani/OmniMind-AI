from fastapi import APIRouter, HTTPException, Depends
from app.core.security import verify_clerk_token
from app.core.database import get_user_stats
import logging

router = APIRouter()
logger = logging.getLogger(__name__)

@router.get("/")
def read_stats(user_id: str = Depends(verify_clerk_token)):
    """
    Retrieves token counts, costs, savings, and LLM distribution breakdown for the user.
    """
    try:
        stats = get_user_stats(user_id)
        return stats
    except Exception as e:
        logger.error(f"Error compiling stats: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve usage and savings analytics")
