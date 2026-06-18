import re
import json
import httpx
import logging
from typing import Dict, Any, Tuple, Optional

logger = logging.getLogger(__name__)

# Model mapping categories
CATEGORIES = ["summarization", "math_logic", "architecture_coding", "general_creative"]


FALLBACK_CHAIN = {
    "gemini-1.5-flash": ["groq-llama-3", "openrouter-fallback"],
    "gemini-1.5-pro": ["deepseek-chat", "openrouter-fallback"],
    "groq-llama-3": ["gemini-1.5-flash", "openrouter-fallback"],
    "deepseek-chat": ["gemini-1.5-pro", "openrouter-fallback"],
    "openrouter-fallback": ["gemini-1.5-flash"]
}

# Estimated costs per 1K tokens in USD
MODEL_COSTS = {
    "gemini-1.5-flash": {"input": 0.0, "output": 0.0},  # Free Tier
    "gemini-1.5-pro": {"input": 0.0, "output": 0.0},    # Free Tier
    "groq-llama-3": {"input": 0.0, "output": 0.0},       # Free Tier
    "deepseek-chat": {"input": 0.00014, "output": 0.00028}, # Near Free
    "openrouter-fallback": {"input": 0.0, "output": 0.0} # Free
}

# Premium reference cost for comparison
PREMIUM_REFERENCE_COSTS = {
    "input": 0.003,
    "output": 0.015
}

def classify_by_keywords(prompt: str) -> str:
    """
    Super-fast keyword-based heuristic classifier.
    """
    p_lower = prompt.lower()

    # Math, logic, and analytical reasoning
    math_patterns = [
        r"\b(solve|math|calculate|compute|integral|derivative|equation|algebra|calculus)\b",
        r"\b(theorem|proof|logic|reasoning|probability|statistics|combinatorics)\b",
        r"[+\-*/=^]{2,}",
        r"\b(deepseek|r1|v3)\b"
    ]
    if any(re.search(pattern, p_lower) for pattern in math_patterns):
        return "math_logic"

    # Architecture design, complex coding, and technical documentation
    coding_patterns = [
        r"\b(architecture|system design|schema|database schema|microservice|uml)\b",
        r"\b(code|program|function|class|struct|compile|debug|refactor|optimize)\b",
        r"\b(typescript|javascript|python|rust|c\+\+|golang|html|css|react|nextjs|fastapi)\b",
        r"\b(documentation|readme|tutorial|guide|technical doc|api endpoint)\b"
    ]
    if any(re.search(pattern, p_lower) for pattern in coding_patterns):
        return "architecture_coding"

    # Summarization, explanation, and description tasks
    summarization_patterns = [
        r"\b(summarize|summary|tldr|tl;dr|read through|outline|bullet points)\b",
        r"\b(explain|explanation|describe|description|walkthrough|what does|how does)\b",
        r"\b(details|synthesize|condense|abstract|groq|llama)\b"
    ]
    if any(re.search(pattern, p_lower) for pattern in summarization_patterns):
        return "summarization"

    return "general_creative"

async def classify_by_llm(prompt: str, keys: Dict[str, Optional[str]]) -> str:
    """
    Advanced LLM-based classifier using direct async HTTPX calls.
    Decoupled from Gemini dependency; uses the first available key.
    """
    if not keys or not any(keys.values()):
        return classify_by_keywords(prompt)

    system_prompt = (
        "You are a routing router assistant. Classify the user's prompt into one of these categories:\n"
        "1. 'summarization': summarization, explanations, descriptions, TL;DR, outline, text explanations.\n"
        "2. 'math_logic': math, algorithms, calculations, formal proofs, deep logical reasoning.\n"
        "3. 'architecture_coding': architecture design, database schema, coding tasks, debugging, api writing, technical docs.\n"
        "4. 'general_creative': general conversation, brainstorming, creative writing, greeting, open chat.\n"
        "\n"
        "Respond ONLY with a JSON object in the format:\n"
        "{\"category\": \"one_of_the_four_categories_above\"}"
    )
    
    full_prompt = f"{system_prompt}\n\nClassify this prompt:\n\n{prompt}"
    category = None

    # Helper function to parse JSON classification safely
    def parse_category(text: str) -> str:
        text = text.strip()
        # Clean markdown code blocks if any
        if text.startswith("```"):
            lines = text.splitlines()
            if len(lines) >= 2:
                if lines[0].startswith("```"):
                    lines = lines[1:]
                if lines[-1].startswith("```"):
                    lines = lines[:-1]
                text = "\n".join(lines).strip()
        # Extract object matching { ... }
        match = re.search(r"(\{.*\})", text, re.DOTALL)
        if match:
            text = match.group(1)
        data = json.loads(text)
        cat = data.get("category", "general_creative").strip().lower()
        if cat in CATEGORIES:
            return cat
        return "general_creative"

    # 1. Try Google Gemini
    if keys.get("gemini"):
        gemini_key = keys["gemini"]
        candidate_models = ["gemini-1.5-flash", "gemini-2.0-flash", "gemini-2.5-flash", "gemini-3.5-flash"]
        gemini_success = False
        
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                for model in candidate_models:
                    if gemini_success:
                        break
                    for version in ["v1", "v1beta"]:
                        url = f"https://generativelanguage.googleapis.com/{version}/models/{model}:generateContent?key={gemini_key}"
                        try:
                            response = await client.post(
                                url,
                                headers={"Content-Type": "application/json"},
                                json={
                                    "contents": [{"parts": [{"text": full_prompt}]}],
                                    "generationConfig": {"responseMimeType": "application/json"}
                                }
                            )
                            if response.status_code == 200:
                                res_json = response.json()
                                raw_text = res_json["candidates"][0]["content"]["parts"][0]["text"].strip()
                                category = parse_category(raw_text)
                                gemini_success = True
                                break
                        except Exception:
                            pass
        except Exception as e:
            logger.warning(f"Classification via Gemini encountered error: {e}")

    # 2. Try Groq
    if not category and keys.get("groq"):
        groq_key = keys["groq"]
        try:
            url = "https://api.groq.com/openai/v1/chat/completions"
            headers = {
                "Authorization": f"Bearer {groq_key}",
                "Content-Type": "application/json"
            }
            json_payload = {
                "model": "llama-3.1-8b-instant",
                "messages": [
                    {"role": "user", "content": full_prompt}
                ],
                "response_format": {"type": "json_object"}
            }
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.post(url, headers=headers, json=json_payload)
                if response.status_code == 200:
                    res_json = response.json()
                    raw_text = res_json["choices"][0]["message"]["content"].strip()
                    category = parse_category(raw_text)
                else:
                    logger.warning(f"Classification via Groq failed: {response.status_code}")
        except Exception as e:
            logger.warning(f"Classification via Groq encountered error: {e}")

    # 3. Try DeepSeek
    if not category and keys.get("deepseek"):
        deepseek_key = keys["deepseek"]
        try:
            url = "https://api.deepseek.com/v1/chat/completions"
            headers = {
                "Authorization": f"Bearer {deepseek_key}",
                "Content-Type": "application/json"
            }
            json_payload = {
                "model": "deepseek-chat",
                "messages": [
                    {"role": "user", "content": full_prompt}
                ],
                "response_format": {"type": "json_object"}
            }
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.post(url, headers=headers, json=json_payload)
                if response.status_code == 200:
                    res_json = response.json()
                    raw_text = res_json["choices"][0]["message"]["content"].strip()
                    category = parse_category(raw_text)
                else:
                    logger.warning(f"Classification via DeepSeek failed: {response.status_code}")
        except Exception as e:
            logger.warning(f"Classification via DeepSeek encountered error: {e}")

    # 4. Try OpenRouter
    if not category and keys.get("openrouter"):
        openrouter_key = keys["openrouter"]
        try:
            url = "https://openrouter.ai/api/v1/chat/completions"
            headers = {
                "Authorization": f"Bearer {openrouter_key}",
                "Content-Type": "application/json"
            }
            json_payload = {
                "model": "meta-llama/llama-3.1-8b-instruct:free",
                "messages": [
                    {"role": "user", "content": full_prompt}
                ]
            }
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.post(url, headers=headers, json=json_payload)
                if response.status_code == 200:
                    res_json = response.json()
                    raw_text = res_json["choices"][0]["message"]["content"].strip()
                    category = parse_category(raw_text)
                else:
                    logger.warning(f"Classification via OpenRouter failed: {response.status_code}")
        except Exception as e:
            logger.warning(f"Classification via OpenRouter encountered error: {e}")

    if category:
        return category
    
    # Ultimate fallback to keyword routing
    return classify_by_keywords(prompt)

def calculate_costs(model_name: str, input_tokens: int, output_tokens: int) -> Tuple[float, float]:
    """
    Calculates estimated actual cost and savings generated vs premium models.
    """
    model_rate = MODEL_COSTS.get(model_name, {"input": 0.0, "output": 0.0})
    actual_cost = (input_tokens / 1000.0) * model_rate["input"] + (output_tokens / 1000.0) * model_rate["output"]
    reference_cost = (input_tokens / 1000.0) * PREMIUM_REFERENCE_COSTS["input"] + (output_tokens / 1000.0) * PREMIUM_REFERENCE_COSTS["output"]
    savings = max(0.0, reference_cost - actual_cost)
    return round(actual_cost, 6), round(savings, 6)

from typing import Tuple

async def route_model(prompt: str, keys: Dict[str, Optional[str]], model_override: Optional[str] = None) -> Tuple[Optional[str], str]:
    """
    Intelligent router selecting the best model based on prompt category and user's active API keys.
    Returns a tuple of (selected_model, classified_category).
    """
    # Classify prompt first so we always have the category
    category = "general_creative"
    if any(keys.values()):
        try:
            category = await classify_by_llm(prompt, keys)
        except Exception:
            category = classify_by_keywords(prompt)
    else:
        category = classify_by_keywords(prompt)

    if model_override:
        return model_override, category

    # Build active models based on saved keys
    active_models = []
    if keys.get("gemini"):
        active_models.extend(["gemini-1.5-flash", "gemini-1.5-pro"])
    if keys.get("groq"):
        active_models.append("groq-llama-3")
    if keys.get("deepseek"):
        active_models.append("deepseek-chat")
    if keys.get("openrouter"):
        active_models.append("openrouter-fallback")

    if not active_models:
        return None, category

    # Use the model registry to select the best model based on current performance scores
    from app.services.model_registry import get_best_model_for_category
    ideal_model = get_best_model_for_category(category, active_models)

    # Context size check (upgrade to large models if input is huge)
    if len(prompt) > 6000:
        if "gemini-1.5-pro" in active_models:
            ideal_model = "gemini-1.5-pro"
        elif "deepseek-chat" in active_models:
            ideal_model = "deepseek-chat"
        elif "openrouter-fallback" in active_models:
            ideal_model = "openrouter-fallback"

    # If the ideal model is configured, route to it
    if ideal_model in active_models:
        return ideal_model, category

    # Fallback chains depending on category
    preference_order = []
    if category in ["general_creative", "summarization"]:
        preference_order = ["gemini-1.5-flash", "groq-llama-3", "gemini-1.5-pro", "deepseek-chat", "openrouter-fallback"]
    elif category == "math_logic":
        preference_order = ["deepseek-chat", "gemini-1.5-pro", "groq-llama-3", "gemini-1.5-flash", "openrouter-fallback"]
    else: # architecture_coding
        preference_order = ["gemini-1.5-pro", "deepseek-chat", "groq-llama-3", "gemini-1.5-flash", "openrouter-fallback"]

    for model in preference_order:
        if model in active_models:
            return model, category

    return active_models[0], category

