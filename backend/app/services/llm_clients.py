import os
import httpx
import json
import re
import logging
from typing import AsyncGenerator, List, Dict, Any

logger = logging.getLogger(__name__)

async def stream_gemini(
    prompt: str,
    system_instruction: str,
    api_key: str,
    model_name: str = "gemini-1.5-flash"
) -> AsyncGenerator[str, None]:
    """
    Streams responses from Google Gemini 1.5 using direct, Zero-SDK HTTPX async REST calls.
    Eliminates dependency on the google-generativeai package index.
    """
    if not api_key:
        yield "[Error: Gemini API key is missing. Please configure it in Settings.]"
        return

    headers = {
        "Content-Type": "application/json"
    }

    last_error_message = ""
    stream_started = False

    candidate_models = [model_name]
    if model_name == "gemini-1.5-flash":
        candidate_models.extend(["gemini-2.0-flash", "gemini-2.5-flash", "gemini-3.5-flash"])
    elif model_name == "gemini-1.5-pro":
        candidate_models.extend(["gemini-2.0-pro", "gemini-2.5-pro", "gemini-3.1-pro", "gemini-3.5-pro"])

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            for model in candidate_models:
                if stream_started:
                    break
                for version in ["v1", "v1beta"]:
                    url = f"https://generativelanguage.googleapis.com/{version}/models/{model}:streamGenerateContent?key={api_key}"
                    
                    # Build version-specific payload
                    if version == "v1beta":
                        payload = {
                            "contents": [{"parts": [{"text": prompt}]}]
                        }
                        if system_instruction:
                            payload["systemInstruction"] = {
                                "parts": [{"text": system_instruction}]
                            }
                    else: # v1 stable
                        # On v1, systemInstruction causes 400 errors for some models. Prepend to contents instead.
                        combined_text = f"{system_instruction}\n\nUser Message:\n{prompt}" if system_instruction else prompt
                        payload = {
                            "contents": [{"parts": [{"text": combined_text}]}]
                        }

                    try:
                        async with client.stream("POST", url, headers=headers, json=payload) as response:
                            if response.status_code == 200:
                                stream_started = True
                                buffer = ""
                                async for chunk in response.aiter_text():
                                    buffer += chunk
                                    while True:
                                        match = re.search(r'"text"\s*:\s*"((?:[^"\\]|\\.)*)"', buffer)
                                        if not match:
                                            break
                                        escaped_text = match.group(1)
                                        try:
                                            unescaped = json.loads(f'"{escaped_text}"')
                                            if unescaped:
                                                yield unescaped
                                        except Exception:
                                            pass
                                        buffer = buffer[match.end():]
                                return # Success, exit generator
                            else:
                                err_body = await response.aread()
                                last_error_message = f"Gemini {model} ({version}) failed ({response.status_code}): {err_body.decode()[:150]}"
                                logger.warning(last_error_message)
                                if response.status_code in [400, 403, 429]:
                                    # Halt the fallback chain immediately for invalid key, forbidden, or rate limit
                                    raise ValueError(last_error_message)
                    except Exception as stream_err:
                        last_error_message = f"Gemini {model} ({version}) connection error: {str(stream_err)}"
                        logger.warning(last_error_message)
            
            # If both endpoints failed and stream never started
            if not stream_started:
                raise ValueError(last_error_message)
                        
    except Exception as e:
        logger.error(f"Error in stream_gemini HTTPX bypass: {e}")
        raise ValueError(f"Gemini REST endpoint error: {str(e)}")

async def stream_openai_compatible(
    base_url: str,
    messages: List[Dict[str, str]],
    api_key: str,
    model_name: str,
    provider_name: str
) -> AsyncGenerator[str, None]:
    """
    Unified stream adapter for all OpenAI-compatible endpoints (Groq, DeepSeek, OpenRouter) via HTTPX.
    """
    if not api_key:
        yield f"[Error: {provider_name} API key is missing. Please configure it in Settings.]"
        return

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }
    payload = {
        "model": model_name,
        "messages": messages,
        "stream": True
    }

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            async with client.stream(
                "POST",
                f"{base_url.rstrip('/')}/chat/completions",
                headers=headers,
                json=payload
            ) as response:
                if response.status_code != 200:
                    error_body = await response.aread()
                    logger.error(f"OpenAI-compatible {provider_name} error: {response.status_code} - {error_body.decode()}")
                    raise ValueError(f"Provider {provider_name} failed with status {response.status_code}: {error_body.decode()[:150]}")

                async for line in response.aiter_lines():
                    if not line:
                        continue
                    if line.startswith("data: "):
                        data_str = line[6:]
                        if data_str.strip() == "[DONE]":
                            break
                        try:
                            data_json = json.loads(data_str)
                            if data_json.get("choices") and data_json["choices"][0].get("delta", {}).get("content"):
                                yield data_json["choices"][0]["delta"]["content"]
                        except json.JSONDecodeError:
                            continue
    except Exception as e:
        logger.error(f"Error in stream_openai_compatible for {provider_name}: {e}")
        raise ValueError(f"Stream from {provider_name} failed: {str(e)}")

async def stream_groq(
    messages: List[Dict[str, str]],
    api_key: str,
    model_name: str = "llama-3.1-8b-instant"
) -> AsyncGenerator[str, None]:
    """
    Streams responses from Groq Llama 3/Mixtral via OpenAI-compatible HTTPX.
    """
    async for chunk in stream_openai_compatible(
        base_url="https://api.groq.com/openai/v1",
        messages=messages,
        api_key=api_key,
        model_name=model_name,
        provider_name="Groq"
    ):
        yield chunk

async def stream_deepseek(
    messages: List[Dict[str, str]],
    api_key: str,
    model_name: str = "deepseek-chat"
) -> AsyncGenerator[str, None]:
    """
    Streams responses from DeepSeek.
    """
    async for chunk in stream_openai_compatible(
        base_url="https://api.deepseek.com/v1",
        messages=messages,
        api_key=api_key,
        model_name=model_name,
        provider_name="DeepSeek"
    ):
        yield chunk

async def stream_openrouter(
    messages: List[Dict[str, str]],
    api_key: str,
    model_name: str = "openrouter/auto"
) -> AsyncGenerator[str, None]:
    """
    Streams responses from OpenRouter.
    """
    async for chunk in stream_openai_compatible(
        base_url="https://openrouter.ai/api/v1",
        messages=messages,
        api_key=api_key,
        model_name=model_name,
        provider_name="OpenRouter"
    ):
        yield chunk
