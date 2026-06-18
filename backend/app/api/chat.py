from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks, File, UploadFile, Response
from fastapi.responses import StreamingResponse
from app.core.security import verify_clerk_token
from app.models.schemas import ChatCreateRequest, ChatMessageRequest, ChatRenameRequest
from app.core.database import (
    create_chat, get_user_chats, delete_chat,
    log_message, get_chat_messages, get_user_keys,
    get_recent_messages, update_chat_title, get_chat_message_count
)
from app.services.llm_router import route_model, calculate_costs, FALLBACK_CHAIN
from app.services.llm_clients import stream_gemini, stream_groq, stream_deepseek, stream_openrouter
from app.core.graph import (
    retrieve_graph_context, extract_and_store_entities,
    ensure_session_node, update_session_name,
    get_session_graph, delete_graph_node,
    get_session_dominant_topic
)
from app.services.search import search_duckduckgo
import json
import httpx
import logging
import time
from typing import AsyncGenerator

router = APIRouter()
logger = logging.getLogger(__name__)

class MessageCache:
    def __init__(self, max_size=10):
        self.cache = {}
        self.order = []
        self.max_size = max_size

    def get(self, chat_id: str):
        return self.cache.get(chat_id)

    def set(self, chat_id: str, messages: list):
        if chat_id in self.cache:
            self.order.remove(chat_id)
        self.cache[chat_id] = messages
        self.order.append(chat_id)
        if len(self.order) > self.max_size:
            oldest = self.order.pop(0)
            self.cache.pop(oldest, None)

    def invalidate(self, chat_id: str):
        self.cache.pop(chat_id, None)
        if chat_id in self.order:
            self.order.remove(chat_id)

_messages_cache = MessageCache(max_size=10)

@router.get("/")
def list_user_chats(response: Response, user_id: str = Depends(verify_clerk_token)):
    response.headers["Cache-Control"] = "max-age=30"
    try:
        return get_user_chats(user_id)
    except Exception as e:
        logger.error(f"Error listing chats: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve chat history")

@router.post("/create")
def create_user_chat(payload: ChatCreateRequest, user_id: str = Depends(verify_clerk_token)):
    try:
        chat_id = create_chat(user_id, payload.title)
        if not chat_id:
            raise HTTPException(status_code=500, detail="Failed to create chat session")
        return {"chat_id": chat_id, "title": payload.title}
    except Exception as e:
        logger.error(f"Error creating chat: {e}")
        raise HTTPException(status_code=500, detail="Failed to create chat session")

@router.get("/{chat_id}/messages")
def get_messages(
    chat_id: str,
    response: Response,
    limit: int = 50,
    offset: int = 0,
    user_id: str = Depends(verify_clerk_token)
):
    response.headers["Cache-Control"] = "max-age=10"
    try:
        # Check cache first if retrieving the initial 50 messages
        if limit == 50 and offset == 0:
            cached = _messages_cache.get(chat_id)
            if cached is not None:
                return cached
                
        messages = get_chat_messages(user_id, chat_id, limit, offset)
        
        # Save to cache if initial 50 messages
        if limit == 50 and offset == 0:
            _messages_cache.set(chat_id, messages)
            
        return messages
    except Exception as e:
        logger.error(f"Error getting messages for chat {chat_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve messages")

@router.delete("/{chat_id}")
def delete_user_chat(chat_id: str, user_id: str = Depends(verify_clerk_token)):
    try:
        success = delete_chat(user_id, chat_id)

        if not success:
            raise HTTPException(status_code=500, detail="Failed to delete chat")
        return {"success": True, "message": "Chat deleted"}
    except Exception as e:
        logger.error(f"Error deleting chat {chat_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete chat")

async def rewrite_query_for_search(prompt: str, keys: dict) -> list:
    """
    Rewrites user's conversational prompt into 1 or 2 search engine queries using LLMs,
    with a stop-word cleaner fallback.
    """
    import re
    import json
    import httpx

    cleaned_prompt = prompt
    # Strip any image markdown tag to not confuse the query rewriter
    cleaned_prompt = re.sub(r'!\[.*?\]\(data:image\/.*?;base64,.*?\)', '', cleaned_prompt).strip()

    if "User Question:" in cleaned_prompt:
        cleaned_prompt = cleaned_prompt.split("User Question:")[-1].strip()
    elif "Current Question:" in cleaned_prompt:
        cleaned_prompt = cleaned_prompt.split("Current Question:")[-1].strip()

    system_prompt = (
        "You are a search query optimizer. Given a user's conversational prompt, extract 1 or 2 distinct, "
        "high-quality search queries that can be used on a search engine like DuckDuckGo to get the most "
        "up-to-date and relevant information. "
        "Return ONLY a JSON list of strings, nothing else. "
        "Example: [\"query 1\", \"query 2\"]"
    )

    # 1. Try Gemini
    if keys.get("gemini"):
        api_key = keys["gemini"]
        candidate_models = ["gemini-1.5-flash", "gemini-2.0-flash", "gemini-2.5-flash"]
        for model in candidate_models:
            for version in ["v1beta", "v1"]:
                url = f"https://generativelanguage.googleapis.com/{version}/models/{model}:generateContent?key={api_key}"
                try:
                    async with httpx.AsyncClient(timeout=4.0) as client:
                        response = await client.post(
                            url,
                            headers={"Content-Type": "application/json"},
                            json={
                                "contents": [
                                    {"role": "user", "parts": [{"text": f"Context: {system_prompt}\nUser Prompt: {cleaned_prompt}"}]}
                                ]
                            }
                        )
                        if response.status_code == 200:
                            res_json = response.json()
                            text = res_json["candidates"][0]["content"]["parts"][0]["text"].strip()
                            match = re.search(r'\[.*\]', text, re.DOTALL)
                            if match:
                                queries = json.loads(match.group(0))
                                if isinstance(queries, list) and len(queries) > 0:
                                    return [q.strip() for q in queries[:2] if isinstance(q, str)]
                except Exception:
                    pass

    # 2. Try Groq
    if keys.get("groq"):
        api_key = keys["groq"]
        url = "https://api.groq.com/openai/v1/chat/completions"
        try:
            async with httpx.AsyncClient(timeout=4.0) as client:
                response = await client.post(
                    url,
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json"
                    },
                    json={
                        "model": "llama-3.1-8b-instant",
                        "messages": [
                            {"role": "system", "content": system_prompt},
                            {"role": "user", "content": cleaned_prompt}
                        ]
                    }
                )
                if response.status_code == 200:
                    res_json = response.json()
                    text = res_json["choices"][0]["message"]["content"].strip()
                    match = re.search(r'\[.*\]', text, re.DOTALL)
                    if match:
                        queries = json.loads(match.group(0))
                        if isinstance(queries, list) and len(queries) > 0:
                            return [q.strip() for q in queries[:2] if isinstance(q, str)]
        except Exception:
            pass

    # 3. Fallback: NLP keyword extractor
    words = cleaned_prompt.lower()
    words = re.sub(r'[^\w\s]', ' ', words)
    stop_words = {
        "can", "you", "tell", "me", "the", "and", "also", "what", "is", "of", "related", "to", "in", 
        "by", "fetching", "into", "internet", "how", "much", "that", "give", "please", "show", "find",
        "search", "google", "about", "for", "on", "a", "an", "i", "we", "he", "she", "they", "it", "this",
        "these", "those", "have", "has", "had", "do", "does", "did", "am", "are", "was", "were", "be", "been"
    }
    filtered_words = [w for w in words.split() if w not in stop_words]
    if filtered_words:
        return [" ".join(filtered_words)]

    return [cleaned_prompt]

@router.post("/{chat_id}/message")
async def send_chat_message(
    chat_id: str,
    payload: ChatMessageRequest,
    background_tasks: BackgroundTasks,
    user_id: str = Depends(verify_clerk_token)
):
    """
    Core OmniMind streaming chat endpoint.
    Routes user prompt, injects Neo4j memory context, handles API fallbacks,
    streams responses chunk-by-chunk, and logs token usage and cost in the background.
    """
    import re
    prompt = payload.content.strip()
    display_prompt = payload.display_content.strip() if payload.display_content else prompt
    if not display_prompt:
        display_prompt = prompt
    if not prompt:
        raise HTTPException(status_code=400, detail="Message content cannot be blank")

    # Clean user message from base64 image tags for token estimation and LLM usage
    token_prompt = re.sub(r'!\[.*?\]\(data:image\/.*?;base64,.*?\)', '', prompt)
    input_tokens_est = len(token_prompt) // 4

    # 1. Log user message to the database immediately (using display_prompt for rendering/persistence)
    user_msg_id = log_message(user_id, chat_id, "user", display_prompt)
    _messages_cache.invalidate(chat_id)

    # 2. Sync user message to Supabase in the background
    background_tasks.add_task(
        sync_message_to_supabase,
        chat_id=chat_id,
        user_id=user_id,
        role="user",
        content=display_prompt,
        msg_id=user_msg_id,
        input_tokens=input_tokens_est
    )

    # 3. Retrieve user keys from database
    keys = get_user_keys(user_id)

    # Clean user message from base64 image tags for search/LLM reasoning
    llm_prompt = token_prompt.strip()
    if not llm_prompt:
        llm_prompt = "Describe and analyze the attached image."

    # 4. Model Classification and Routing
    routed_model, category = await route_model(llm_prompt, keys, payload.model_override)

    # 5. Inject Knowledge Graph Memory (Session-Scoped 3-Tier)
    memory_result = retrieve_graph_context(user_id, chat_id, llm_prompt)
    memory_context_text = memory_result.get("context_text", "")
    memory_entity_count = memory_result.get("entity_count", 0)
    memory_rel_count = memory_result.get("relationship_count", 0)

    # Hot memory: last 5 message pairs from this session
    recent_msgs = get_recent_messages(user_id, chat_id, limit=5)
    
    # Filter out current prompt if it was already saved
    past_msgs = list(recent_msgs)
    if past_msgs and past_msgs[-1]["role"] == "user" and (past_msgs[-1]["content"] == prompt or past_msgs[-1].get("id") == user_msg_id):
        past_msgs.pop()

    dominant_topic = get_session_dominant_topic(user_id, chat_id) or "General Discussion"
    
    # Format Relevant Entities
    entities_block_list = []
    for ent in memory_result.get("entities", []):
        desc_str = f": {ent['description']}" if ent.get('description') else ""
        entities_block_list.append(f"- {ent['name']} ({ent['type']}){desc_str}")
    entities_block = "\n".join(entities_block_list)
    if not entities_block:
        entities_block = "None"
        
    # Format Relationships
    relationships_block_list = []
    for rel in memory_result.get("relationships", []):
        rel_type = rel.get("type") or rel.get("relation") or "RELATED_TO"
        desc_str = f": {rel['description']}" if rel.get('description') else ""
        relationships_block_list.append(f"- {rel['source']} -> {rel_type} -> {rel['target']}{desc_str}")
    relationships_block = "\n".join(relationships_block_list)
    if not relationships_block:
        relationships_block = "None"
        
    # Format Key Facts
    key_facts_block_list = []
    for fact in memory_result.get("key_facts", []):
        key_facts_block_list.append(f"- {fact}")
    key_facts_block = "\n".join(key_facts_block_list)
    if not key_facts_block:
        key_facts_block = "None"

    # Format Recent Conversation
    recent_conv_list = []
    for m in past_msgs:
        role_label = "User" if m["role"] == "user" else "Assistant"
        recent_conv_list.append(f"{role_label}: {m['content']}")
    recent_conversation_block = "\n".join(recent_conv_list)
    if not recent_conversation_block:
        recent_conversation_block = "User: None\nAssistant: None"

    search_context_text = ""
    search_queries_used = []
    if payload.web_search:
        import asyncio
        search_prompt = re.sub(r'!\[.*?\]\(data:image\/.*?;base64,.*?\)', '', prompt).strip()
        if "User Question:" in search_prompt:
            search_prompt = search_prompt.split("User Question:")[-1].strip()
        elif "Current Question:" in search_prompt:
            search_prompt = search_prompt.split("Current Question:")[-1].strip()

        search_queries_used = await rewrite_query_for_search(search_prompt, keys)
        logger.info(f"Running web search RAG for queries: {search_queries_used}")

        # Parallel search queries execution
        tasks = [search_duckduckgo(q, max_results=3) for q in search_queries_used]
        results_lists = await asyncio.gather(*tasks, return_exceptions=True)

        combined_results = []
        seen_urls = set()
        for res_list in results_lists:
            if isinstance(res_list, list):
                for r in res_list:
                    if r.get('url') and r['url'] not in seen_urls:
                        seen_urls.add(r['url'])
                        combined_results.append(r)

        if combined_results:
            lines = []
            for idx, r in enumerate(combined_results, 1):
                lines.append(f"{idx}. {r['title']} ({r['url']})\n   {r['snippet']}")
            search_context_text = "\n".join(lines)

    system_instruction = (
        "[OmniMind Knowledge Graph Memory]\n"
        f"Session Topic: {dominant_topic}\n"
        "Relevant Entities:\n"
        f"{entities_block}\n"
        "Relationships:\n"
        f"{relationships_block}\n"
        "Key Facts:\n"
        f"{key_facts_block}\n"
        "Recent Conversation:\n"
        f"{recent_conversation_block}\n"
        "---\n"
        f"Current Question: {llm_prompt}"
    )

    if search_context_text:
        queries_str = ", ".join(f"'{q}'" for q in search_queries_used)
        system_instruction = (
            "[OmniMind Real-Time Web Search Context]\n"
            f"Search Queries: {queries_str}\n"
            "Search Results:\n"
            f"{search_context_text}\n"
            "Use the search results above to provide a comprehensive, accurate, up-to-date answer. "
            "Cite your sources using markdown link format like [Title](URL) where appropriate.\n\n"
        ) + system_instruction




    # 6. Core SSE Stream Generator
    async def sse_generator() -> AsyncGenerator[str, None]:
        nonlocal routed_model
        
        # Helper mapping to fetch model stream
        async def get_stream(model_name: str) -> AsyncGenerator[str, None]:
            if model_name == "gemini-1.5-flash" or model_name == "gemini-1.5-pro":
                if not keys.get("gemini"):
                    raise ValueError("Gemini API key is not configured in Settings.")
                return stream_gemini(
                    prompt=llm_prompt,
                    system_instruction=system_instruction,
                    api_key=keys.get("gemini"),
                    model_name=model_name
                )
            elif model_name == "groq-llama-3":
                if not keys.get("groq"):
                    raise ValueError("Groq API key is not configured in Settings.")
                # Convert simple string prompt to chat history for Groq
                messages = [
                    {"role": "system", "content": system_instruction},
                    {"role": "user", "content": llm_prompt}
                ]
                return stream_groq(messages=messages, api_key=keys.get("groq"))
            elif model_name == "deepseek-chat":
                if not keys.get("deepseek"):
                    raise ValueError("DeepSeek API key is not configured in Settings.")
                messages = [
                    {"role": "system", "content": system_instruction},
                    {"role": "user", "content": llm_prompt}
                ]
                return stream_deepseek(messages=messages, api_key=keys.get("deepseek"))
            elif model_name == "openrouter-fallback":
                if not keys.get("openrouter"):
                    raise ValueError("OpenRouter API key is not configured in Settings.")
                messages = [
                    {"role": "system", "content": system_instruction},
                    {"role": "user", "content": llm_prompt}
                ]
                return stream_openrouter(messages=messages, api_key=keys.get("openrouter"))
            else:
                raise ValueError(f"Unknown model provider path: {model_name}")

        stream = None
        current_model = routed_model
        first_chunk = ""
        full_response = ""
        start_time = time.time()
        
        # Try primary model and execute fallback chain on failure
        try:
            stream = await get_stream(current_model)
            # Prime the stream to check for immediate connection/quota/auth errors
            first_chunk = await stream.__anext__()
        except Exception as e:
            logger.warning(f"Primary model {current_model} failed to initialize: {e}. Trying fallback chain...")
            stream = None
            fallbacks = FALLBACK_CHAIN.get(current_model, ["openrouter-fallback"])
            for fb_model in fallbacks:
                try:
                    logger.info(f"Falling back to {fb_model}")
                    fb_stream = await get_stream(fb_model)
                    first_chunk = await fb_stream.__anext__()
                    stream = fb_stream
                    current_model = fb_model
                    break
                except Exception as fb_err:
                    logger.error(f"Fallback to {fb_model} failed: {fb_err}")
                    continue

        if not stream:
            from app.core.config import get_settings
            settings = get_settings()
            fallback_key = settings.UNIVERSAL_FALLBACK_API_KEY
            if fallback_key:
                try:
                    logger.info("Normal streams failed or keys unconfigured. Invoking Universal Fallback API Limit Agent...")
                    API_LIMIT_AGENT_SYSTEM_INSTRUCTION = (
                        "You are the OmniMind API Limit Assistant. You must ONLY inform the user that their API keys "
                        "are either missing, unconfigured, or have exceeded their quota/limits (resulting in API call failures). "
                        "Guide the user to the Settings page (by clicking the Settings icon in the sidebar) where they can configure "
                        "their own API keys for Gemini, Groq, DeepSeek, or OpenRouter. Briefly explain the general process of creating "
                        "a free or paid API key for these services (e.g. going to Google AI Studio for Gemini, Console Groq for Groq, "
                        "or OpenRouter.ai). Do NOT answer any other questions, do NOT chat, do NOT access any memory graph, and "
                        "do NOT use any other words unrelated to API key configuration, limits, or billing issues. Keep your tone polite and helpful."
                    )
                    current_model = "gemini-1.5-flash"
                    stream = stream_gemini(
                        prompt=prompt,
                        system_instruction=API_LIMIT_AGENT_SYSTEM_INSTRUCTION,
                        api_key=fallback_key,
                        model_name=current_model
                    )
                    first_chunk = await stream.__anext__()
                except Exception as fb_agent_err:
                    logger.error(f"Universal Fallback API Limit Agent failed to initialize: {fb_agent_err}")
                    stream = None

            if not stream:
                # Yield critical error chunk if everything failed
                yield json.dumps({"error": "All primary and fallback LLM services are currently unavailable. Please check your API keys and quotas."}) + "\n"
                return


        # Notify frontend immediately of the finalized model selection in the first stream chunk
        yield json.dumps({"model": current_model}) + "\n"

        # Yield the primed first chunk so the user receives it!
        full_response = first_chunk
        yield json.dumps({"text": first_chunk}) + "\n"

        try:
            try:
                async for chunk in stream:
                    if chunk:
                        full_response += chunk
                        yield json.dumps({"text": chunk}) + "\n"
            except Exception as stream_err:
                logger.error(f"Streaming error midway: {stream_err}")
                yield json.dumps({"error": f"Streaming disrupted: {str(stream_err)}"}) + "\n"
        finally:
            if full_response:
                # Post-Stream Metrics Calculation & Logging
                input_tokens = len(llm_prompt) // 4  # Robust default token heuristic using clean prompt
                output_tokens = len(full_response) // 4
                cost, savings = calculate_costs(current_model, input_tokens, output_tokens)

                # Log assistant response to database
                assistant_msg_id = log_message(
                    user_id=user_id,
                    chat_id=chat_id,
                    role="assistant",
                    content=full_response,
                    model=current_model,
                    input_tokens=input_tokens,
                    output_tokens=output_tokens,
                    cost=cost,
                    savings=savings,
                    memory_active=1 if memory_context_text else 0
                )
                _messages_cache.invalidate(chat_id)

                # Sync to Supabase in the background
                background_tasks.add_task(
                    sync_message_to_supabase,
                    chat_id=chat_id,
                    user_id=user_id,
                    role="assistant",
                    content=full_response,
                    msg_id=assistant_msg_id,
                    model=current_model,
                    input_tokens=input_tokens,
                    output_tokens=output_tokens,
                    cost=cost,
                    savings=savings
                )

                # Record model performance metrics in registry
                try:
                    latency = time.time() - start_time
                    from app.services.model_registry import record_model_outcome
                    record_model_outcome(current_model, category, latency, full_response)
                except Exception as route_err:
                    logger.error(f"Error recording model outcome: {route_err}")

                # Fetch updated session title from SQLite
                current_title = "New Session"
                try:
                    from app.core.database import get_db_connection
                    conn = get_db_connection()
                    cursor = conn.cursor()
                    cursor.execute("SELECT title FROM chats WHERE id = ? AND user_id = ?", (chat_id, user_id))
                    row = cursor.fetchone()
                    conn.close()
                    if row:
                        current_title = row["title"]
                except Exception as db_err:
                    logger.error(f"Error fetching current chat title for metadata chunk: {db_err}")

                print(f"[SESSION NAME] Starting name generation for chat_id: {chat_id}")
                print(f"[SESSION NAME] Current title: {current_title}")

                # Auto generate title if it is still "New Session" or unset
                new_title = current_title
                if current_title == "New Session" or not current_title:
                    try:
                        new_title = await generate_session_name(user_id, chat_id, llm_prompt, full_response)
                        print(f"[SESSION NAME] Generated title: {new_title}")
                        print(f"[SESSION NAME] Title saved successfully")
                    except Exception as name_err:
                        print(f"[SESSION NAME] Error generating title: {name_err}")
                        logger.error(f"Error in generate_session_name task: {name_err}")
                else:
                    print(f"[SESSION NAME] Generated title: {current_title}")
                    print(f"[SESSION NAME] Title saved successfully")

                current_title = new_title

                # Yield metadata chunk at the end of stream including database IDs
                try:
                    yield json.dumps({
                        "meta": {
                            "model": current_model,
                            "input_tokens": input_tokens,
                            "output_tokens": output_tokens,
                            "cost": cost,
                            "savings": savings,
                            "memory_active": bool(memory_context_text),
                            "memory_entity_count": memory_entity_count,
                            "memory_relationship_count": memory_rel_count,
                            "session_title": current_title,
                            "user_message_id": user_msg_id,
                            "assistant_message_id": assistant_msg_id
                        }
                    }) + "\n"
                except GeneratorExit:
                    raise
                except Exception:
                    pass

                # Ensure Session node and trigger background entity extraction
                ensure_session_node(user_id, chat_id)

                background_tasks.add_task(
                    run_memory_extraction_task,
                    user_id=user_id,
                    chat_id=chat_id,
                    user_msg=llm_prompt,
                    ai_msg=full_response
                )

    return StreamingResponse(sse_generator(), media_type="application/x-ndjson")

async def run_memory_extraction_task(
    user_id: str,
    chat_id: str,
    user_msg: str,
    ai_msg: str
):
    """
    Runs background entity extraction, and evaluates dominant topic from Neo4j to update session title in SQLite and Neo4j Session node name.
    """
    print(f"[MEMORY] Extraction triggered for chat_id: {chat_id}")
    try:
        await extract_and_store_entities(user_id, chat_id, user_msg, ai_msg)
    except Exception as e:
        logger.error(f"Error in background entity extraction: {e}")
        
    try:
        dominant_topic = get_session_dominant_topic(user_id, chat_id)
        if dominant_topic:
            # Check current title in SQLite
            from app.core.database import get_db_connection
            conn = get_db_connection()
            cursor = conn.cursor()
            cursor.execute("SELECT title FROM chats WHERE id = ? AND user_id = ?", (chat_id, user_id))
            row = cursor.fetchone()
            conn.close()
            
            current_title = row["title"] if row else None
            if current_title and dominant_topic != current_title:
                # Update SQLite and Supabase
                update_chat_title(user_id, chat_id, dominant_topic)
                # Update Neo4j session node name
                update_session_name(user_id, chat_id, dominant_topic)
                logger.info(f"Automatically renamed chat {chat_id} from '{current_title}' to '{dominant_topic}' based on Neo4j Graph")
    except Exception as e:
        logger.error(f"Failed to auto-rename chat session from dominant topic: {e}")

async def generate_session_name(user_id: str, chat_id: str, user_msg: str, ai_msg: str) -> str:
    """
    Sends the user message and assistant reply to the fastest model (Gemini Flash or Groq)
    to generate a 4-word Title Case session title.
    Falls back to first 5 words of user message if both fail.
    """
    current_title = "New Session"
    try:
        from app.core.database import get_db_connection
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT title FROM chats WHERE id = ? AND user_id = ?", (chat_id, user_id))
        row = cursor.fetchone()
        conn.close()
        if row:
            current_title = row["title"]
    except Exception as db_err:
        logger.error(f"Error fetching current title in generate_session_name: {db_err}")

    # If already set to a custom name, do not change it
    if current_title and current_title != "New Session" and current_title != "":
        return current_title

    prompt = (
        "Based on this conversation exchange, generate a short specific session title of maximum 4 words in title case that captures the exact topic. Return only the title, nothing else, no punctuation at the end.\n\n"
        f"User: {user_msg}\n"
        f"Assistant: {ai_msg[:200]}"
    )

    from app.core.database import get_user_keys
    keys = get_user_keys(user_id)

    # 1. Try Gemini Flash
    if keys.get("gemini"):
        api_key = keys["gemini"]
        candidate_models = ["gemini-1.5-flash", "gemini-2.0-flash", "gemini-2.5-flash", "gemini-3.5-flash"]
        for model in candidate_models:
            for version in ["v1", "v1beta"]:
                url = f"https://generativelanguage.googleapis.com/{version}/models/{model}:generateContent?key={api_key}"
                try:
                    async with httpx.AsyncClient(timeout=5.0) as client:
                        response = await client.post(
                            url,
                            headers={"Content-Type": "application/json"},
                            json={"contents": [{"parts": [{"text": prompt}]}]}
                        )
                        if response.status_code == 200:
                            res_json = response.json()
                            title = res_json["candidates"][0]["content"]["parts"][0]["text"].strip()
                            title = title.replace('"', '').replace("'", '').strip()
                            if title and len(title) > 0:
                                update_chat_title(user_id, chat_id, title)
                                update_session_name(user_id, chat_id, title)
                                logger.info(f"Generated session name with Gemini: '{title}'")
                                return title
                except Exception:
                    pass

    # 2. Try Groq
    if keys.get("groq"):
        api_key = keys["groq"]
        url = "https://api.groq.com/openai/v1/chat/completions"
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.post(
                    url,
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json"
                    },
                    json={
                        "model": "llama-3.1-8b-instant",
                        "messages": [{"role": "user", "content": prompt}]
                    }
                )
                if response.status_code == 200:
                    res_json = response.json()
                    title = res_json["choices"][0]["message"]["content"].strip()
                    title = title.replace('"', '').replace("'", '').strip()
                    if title and len(title) > 0:
                        update_chat_title(user_id, chat_id, title)
                        update_session_name(user_id, chat_id, title)
                        logger.info(f"Generated session name with Groq: '{title}'")
                        return title
        except Exception:
            pass

    # 3. Fallback: first six words capitalized
    fallback_title = " ".join(word.capitalize() for word in user_msg.split()[:6])
    fallback_title = fallback_title.replace('"', '').replace("'", '').strip()
    if fallback_title:
        try:
            update_chat_title(user_id, chat_id, fallback_title)
            update_session_name(user_id, chat_id, fallback_title)
            logger.info(f"Fallback session name generated: '{fallback_title}'")
            return fallback_title
        except Exception as e:
            logger.error(f"Error saving fallback session name: {e}")

    return current_title

async def sync_message_to_supabase(
    chat_id: str,
    user_id: str,
    role: str,
    content: str,
    msg_id: str = None,
    model: str = None,
    input_tokens: int = 0,
    output_tokens: int = 0,
    cost: float = 0.0,
    savings: float = 0.0
):
    """
    Lightweight, zero-dependency async PostgREST sync helper for chat messages.
    Logs message transaction, tokens, cost, and savings directly to Supabase messages.
    """
    from app.core.config import get_settings
    settings = get_settings()
    key = settings.SUPABASE_SERVICE_ROLE_KEY or settings.SUPABASE_KEY
    if not settings.SUPABASE_URL or not key:
        return
        
    url = f"{settings.SUPABASE_URL.rstrip('/')}/rest/v1/messages"
    headers = {
        "Authorization": f"Bearer {key}",
        "apikey": key,
        "Content-Type": "application/json",
        "Prefer": "return=minimal"
    }
    payload = {
        "chat_id": chat_id,
        "user_id": user_id,
        "role": role,
        "content": content,
        "model_used": model,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "cost": cost,
        "savings": savings
    }
    if msg_id:
        payload["id"] = msg_id

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            res = await client.post(url, headers=headers, json=payload)
            if res.status_code not in [200, 201, 204]:
                err_msg = f"[SUPABASE ERROR] Message sync returned status {res.status_code}: {res.text}"
                print(err_msg)
                logger.error(err_msg)
            else:
                print(f"[SUPABASE] Successfully synchronized {role} message log to Supabase.")
    except Exception as e:
        err_msg = f"[SUPABASE ERROR] Failed to sync message log to Supabase: {e}"
        print(err_msg)
        logger.warning(err_msg)



# --- Memory Explorer API Endpoints ---

@router.get("/{chat_id}/graph")
def get_chat_graph(chat_id: str, user_id: str = Depends(verify_clerk_token)):
    """Returns the Neo4j knowledge graph for a specific chat session."""
    try:
        return get_session_graph(user_id, chat_id)
    except Exception as e:
        logger.error(f"Error fetching graph for chat {chat_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve session graph")

@router.delete("/{chat_id}/graph/{node_name}")
def delete_chat_graph_node(chat_id: str, node_name: str, user_id: str = Depends(verify_clerk_token)):
    """Deletes a specific entity node from the session's Neo4j graph."""
    try:
        success = delete_graph_node(user_id, node_name, chat_id)
        if not success:
            raise HTTPException(status_code=500, detail="Failed to delete node")
        return {"success": True, "message": f"Node '{node_name}' deleted"}
    except Exception as e:
        logger.error(f"Error deleting graph node: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete graph node")

@router.get("/{chat_id}/name")
def get_chat_name(chat_id: str, user_id: str = Depends(verify_clerk_token)):
    """Returns the current session name. Used by frontend for auto-naming polling."""
    try:
        from app.core.database import get_db_connection
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT title FROM chats WHERE id = ? AND user_id = ?", (chat_id, user_id))
        row = cursor.fetchone()
        conn.close()
        if row:
            return {"title": row["title"]}
        raise HTTPException(status_code=404, detail="Chat not found")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting chat name: {e}")
        raise HTTPException(status_code=500, detail="Failed to get chat name")

@router.post("/upload-document")
async def upload_chat_document(
    file: UploadFile = File(...),
    user_id: str = Depends(verify_clerk_token)
):
    """
    Parses an uploaded document (PDF, Word, Excel, PPT) and returns the extracted text contents.
    """
    try:
        from app.services.document_parser import parse_document
        contents = await file.read()
        extracted_text = parse_document(file.filename, contents, user_id)
        
        char_count = len(extracted_text)
        word_count = len(extracted_text.split())
        
        return {
            "success": True,
            "filename": file.filename,
            "text": extracted_text,
            "char_count": char_count,
            "word_count": word_count
        }
    except ValueError as val_err:
        raise HTTPException(status_code=400, detail=str(val_err))
    except Exception as e:
        logger.error(f"Error parsing document upload: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to process and extract text from document: {str(e)}")

@router.get("/{chat_id}/message/{message_id}/pdf")
def download_message_pdf(
    chat_id: str,
    message_id: str,
    user_id: str = Depends(verify_clerk_token)
):
    """
    Fetches the specific assistant message and its preceding user message,
    generates a beautifully formatted PDF report, and streams it to the user.
    """
    from app.core.database import get_db_connection, is_supabase_active, supabase_select
    from app.services.pdf_generator import generate_pdf_report
    
    assistant_row = None
    user_query = "AI Inquiry"
    session_title = "General Session"

    # Try Supabase First
    if is_supabase_active():
        try:
            # Check chats table to verify user ownership
            chat_check = supabase_select("chats", {"id": f"eq.{chat_id}", "user_id": f"eq.{user_id}"})
            if chat_check:
                session_title = chat_check[0]["title"]
                
                # Fetch assistant message
                msg_rows = supabase_select("messages", {"id": f"eq.{message_id}", "chat_id": f"eq.{chat_id}"})
                if msg_rows:
                    assistant_row = msg_rows[0]
                    assistant_row["model"] = assistant_row.get("model_used")
                    
                    # Fetch preceding user message (query)
                    user_msg_rows = supabase_select("messages", {
                        "chat_id": f"eq.{chat_id}",
                        "role": "eq.user",
                        "created_at": f"lt.{assistant_row['created_at']}",
                        "order": "created_at.desc",
                        "limit": "1"
                    })
                    if user_msg_rows:
                        user_query = user_msg_rows[0]["content"]
        except Exception as sb_err:
            logger.warning(f"Error reading message from Supabase for PDF: {sb_err}")

    # Fallback to local SQLite database
    if not assistant_row:
        conn = get_db_connection()
        cursor = conn.cursor()
        try:
            # 1. Fetch assistant message (model_used as model)
            cursor.execute(
                """
                SELECT role, content, model_used as model, created_at FROM messages
                WHERE id = ? AND chat_id = ?
                """,
                (message_id, chat_id)
            )
            row = cursor.fetchone()
            if row:
                assistant_row = dict(row)
                
                # 2. Fetch preceding user message (the query)
                cursor.execute(
                    """
                    SELECT content FROM messages
                    WHERE chat_id = ? AND role = 'user' AND created_at < ?
                    ORDER BY created_at DESC LIMIT 1
                    """,
                    (chat_id, assistant_row["created_at"])
                )
                user_row = cursor.fetchone()
                if user_row:
                    user_query = user_row["content"]
                
                # 3. Fetch chat session title
                cursor.execute(
                    "SELECT title FROM chats WHERE id = ? AND user_id = ?",
                    (chat_id, user_id)
                )
                chat_row = cursor.fetchone()
                if chat_row:
                    session_title = chat_row["title"]
        except Exception as db_err:
            logger.error(f"Error reading message from SQLite for PDF: {db_err}")
            raise HTTPException(status_code=500, detail="Database lookup failed")
        finally:
            conn.close()
        
    # Generate PDF report
    try:
        from datetime import datetime
        try:
            created_dt = datetime.fromisoformat(assistant_row["created_at"].replace("Z", "+00:00"))
            date_str = created_dt.strftime("%Y-%m-%d %H:%M")
        except Exception:
            date_str = datetime.now().strftime("%Y-%m-%d")
            
        pdf_bytes = generate_pdf_report(
            session_title=session_title,
            query=user_query,
            answer=assistant_row["content"],
            model_name=assistant_row["model"],
            date_str=date_str
        )
        
        from fastapi.responses import Response
        headers = {
            "Content-Disposition": f'attachment; filename="OmniMind_Report_{message_id[:8]}.pdf"'
        }
        return Response(content=pdf_bytes, media_type="application/pdf", headers=headers)
    except Exception as pdf_err:
        logger.error(f"Error generating PDF report: {pdf_err}")
        raise HTTPException(status_code=500, detail=f"PDF generation failed: {str(pdf_err)}")

@router.put("/{chat_id}/rename")
def rename_user_chat(
    chat_id: str,
    payload: ChatRenameRequest,
    user_id: str = Depends(verify_clerk_token)
):
    """Manually renames a chat session in SQLite, Supabase, and Neo4j."""
    try:
        # Update SQLite & Supabase
        update_chat_title(user_id, chat_id, payload.title)
        # Update Neo4j
        update_session_name(user_id, chat_id, payload.title)
        return {"success": True, "title": payload.title}
    except Exception as e:
        logger.error(f"Error renaming chat session: {e}")
        raise HTTPException(status_code=500, detail="Failed to rename chat session")
