from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import get_settings
from app.api import chat, settings, stats, users

settings_env = get_settings()

app = FastAPI(
    title="OmniMind Unified LLM Platform API",
    description="Backend API serving OmniMind's multi-LLM router and memory graph integration.",
    version="1.0.0"
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, lock this down to the frontend URL
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API Routers
app.include_router(chat.router, prefix="/api/chat", tags=["Chat"])
app.include_router(settings.router, prefix="/api/settings", tags=["Settings"])
app.include_router(stats.router, prefix="/api/stats", tags=["Stats"])
app.include_router(users.router, prefix="/api/users", tags=["Users"])

import asyncio
import logging
from app.services.model_registry import load_registry_from_disk, update_model_registry

logger = logging.getLogger(__name__)

async def daily_registry_update_loop():
    while True:
        try:
            await asyncio.sleep(24 * 60 * 60)
            await update_model_registry()
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error(f"Error in daily registry update loop: {e}")
            await asyncio.sleep(60)

@app.on_event("startup")
async def startup_event():
    registry = load_registry_from_disk()
    logger.info("Current loaded model performance scores:")
    for model_name, metrics in registry.get("models", {}).items():
        logger.info(f" - {model_name}: {metrics}")
    
    asyncio.create_task(daily_registry_update_loop())

@app.get("/api/health")
def health_check():
    return {"status": "healthy", "version": "1.0.0"}
