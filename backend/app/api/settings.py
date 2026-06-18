import httpx
import logging
from fastapi import APIRouter, HTTPException, Depends
from app.models.schemas import APIKeysSaveRequest, APIKeysResponse, APIKeyTestRequest, APIKeyTestResponse
from app.core.database import save_user_keys, get_user_keys_masked
from app.core.security import verify_clerk_token

router = APIRouter()
logger = logging.getLogger(__name__)

@router.get("/", response_model=APIKeysResponse)
def read_settings(user_id: str = Depends(verify_clerk_token)):

    try:
        return get_user_keys_masked(user_id)
    except Exception as e:
        logger.error(f"Error reading keys: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve API key configuration")

@router.post("/save")
def save_settings(payload: APIKeysSaveRequest, user_id: str = Depends(verify_clerk_token)):
    keys_dict = {
        "gemini": payload.gemini_key,
        "groq": payload.groq_key,
        "deepseek": payload.deepseek_key,
        "openrouter": payload.openrouter_key
    }
    
    # Filter out empty strings or values that are just mask text (e.g. contain '...xxxx')
    filtered_keys = {}
    for provider, val in keys_dict.items():
        if val is not None:
            val_strip = val.strip()
            if val_strip == "" or "...xxxx" in val_strip:
                continue
            filtered_keys[provider] = val_strip

    if not filtered_keys:
        return {"success": True, "message": "No new keys provided for encryption"}

    success = save_user_keys(user_id, filtered_keys)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to securely encrypt and save keys")
        
    return {"success": True, "message": "API keys encrypted and saved successfully"}

@router.post("/test", response_model=APIKeyTestResponse)
async def test_api_key(payload: APIKeyTestRequest, user_id: str = Depends(verify_clerk_token)):

    """
    Validates an API key against its respective provider in real time.
    If validation succeeds, it instantly AES-encrypts and Auto-Saves the key to the database!
    """
    key = payload.api_key.strip()
    provider = payload.key_type.lower()

    if not key:
        return APIKeyTestResponse(success=False, message="API Key cannot be blank")

    try:
        success = False
        message = ""

        # 1. Test Google Gemini via direct REST endpoint
        if provider == "gemini":
            success = False
            for model in ["gemini-1.5-flash", "gemini-2.0-flash", "gemini-2.5-flash", "gemini-3.5-flash"]:
                if success:
                    break
                for version in ["v1", "v1beta"]:
                    url = f"https://generativelanguage.googleapis.com/{version}/models/{model}:generateContent?key={key}"
                    try:
                        async with httpx.AsyncClient(timeout=10.0) as client:
                            response = await client.post(
                                url,
                                headers={"Content-Type": "application/json"},
                                json={"contents": [{"parts": [{"text": "ping"}]}]}
                            )
                            if response.status_code == 200:
                                success = True
                                message = f"Successfully authenticated with Gemini API using {model} ({version})!"
                                break
                            elif response.status_code in [400, 403, 429]:
                                # API key issue or quota limits - no need to loop further
                                err_msg = response.text[:100]
                                message = f"Gemini connection failed ({response.status_code}): {err_msg}"
                                break
                            else:
                                err_msg = response.text[:100]
                                message = f"Gemini connection failed ({response.status_code}): {err_msg}"
                    except Exception as exc:
                        message = f"Gemini connection error: {str(exc)}"
                if message and "API key not valid" in message:
                    break

        # 2. Test Groq via direct OpenAI-compatible REST endpoint
        elif provider == "groq":
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.post(
                    "https://api.groq.com/openai/v1/chat/completions",
                    headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                    json={
                        "model": "llama-3.1-8b-instant",
                        "messages": [{"role": "user", "content": "ping"}],
                        "max_tokens": 5
                    }
                )
                if response.status_code == 200:
                    success = True
                    message = "Successfully authenticated with Groq API!"
                elif response.status_code == 402 or "insufficient" in response.text.lower():
                    success = True
                    message = "Key is valid, but Groq reports Insufficient Balance / Rate Limits!"
                else:
                    err_msg = response.text[:100]
                    message = f"Groq connection failed ({response.status_code}): {err_msg}"

        # 3. Test DeepSeek via direct REST endpoint
        elif provider == "deepseek":
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.post(
                    "https://api.deepseek.com/v1/chat/completions",
                    headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                    json={
                        "model": "deepseek-chat",
                        "messages": [{"role": "user", "content": "ping"}],
                        "max_tokens": 5
                    }
                )
                if response.status_code == 200:
                    success = True
                    message = "Successfully authenticated with DeepSeek API!"
                elif response.status_code == 402 or "insufficient" in response.text.lower():
                    success = True
                    message = "Key is valid, but DeepSeek reports Insufficient Balance (please top up your account)!"
                else:
                    err_msg = response.text[:100]
                    message = f"DeepSeek connection failed ({response.status_code}): {err_msg}"

        # 4. Test OpenRouter via direct REST endpoint
        elif provider == "openrouter":
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.post(
                    "https://openrouter.ai/api/v1/chat/completions",
                    headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                    json={
                        "model": "openrouter/auto",
                        "messages": [{"role": "user", "content": "ping"}],
                        "max_tokens": 5
                    }
                )
                if response.status_code == 200:
                    success = True
                    message = "Successfully authenticated with OpenRouter API!"
                elif response.status_code == 402 or "insufficient" in response.text.lower():
                    success = True
                    message = "Key is valid, but OpenRouter reports Insufficient Balance!"
                else:
                    err_msg = response.text[:100]
                    message = f"OpenRouter connection failed ({response.status_code}): {err_msg}"

        else:
            return APIKeyTestResponse(success=False, message=f"Unknown provider '{provider}'")

        # AUTO-SAVE TRICK: If authentication check passes, save to database instantly!
        if success:
            logger.info(f"Auto-saving validated credentials for '{provider}' user '{user_id}'")
            save_user_keys(user_id, {provider: key})
            message += " (Credentials encrypted & auto-saved permanently)"

        return APIKeyTestResponse(success=success, message=message)

    except Exception as e:
        logger.error(f"Error testing key for {provider}: {e}")
        return APIKeyTestResponse(success=False, message=f"Authentication test failed: {str(e)}")
