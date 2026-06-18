import logging
import json
import re
import httpx
from typing import Dict, List, Any
from neo4j import GraphDatabase
from app.core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

# Initialize Neo4j driver. Falls back to None if credentials aren't defined.
driver = None
if settings.NEO4J_URI and settings.NEO4J_PASSWORD:
    try:
        driver = GraphDatabase.driver(
            settings.NEO4J_URI,
            auth=(settings.NEO4J_USERNAME, settings.NEO4J_PASSWORD)
        )
        # Test connection
        driver.verify_connectivity()
        logger.info("Successfully established connection to Neo4j AuraDB!")
    except Exception as e:
        logger.error(f"Failed to connect to Neo4j at {settings.NEO4J_URI}: {e}")
        driver = None
else:
    logger.warning("Neo4j database credentials not configured. Running in fallback memory mode.")

def ensure_session_node(user_id: str, chat_id: str, session_name: str = "New Session"):
    """Creates or merges a Session node in Neo4j for per-session memory isolation."""
    if not user_id:
        raise ValueError("user_id cannot be None or empty in Neo4j operations")
    if not driver:
        return
    try:
        with driver.session() as session:
            session.run(
                """
                MERGE (s:Session {session_id: $chat_id, user_id: $user_id})
                ON CREATE SET s.name = $session_name, s.created_at = timestamp()
                ON MATCH SET s.name = $session_name
                """,
                chat_id=chat_id, user_id=user_id, session_name=session_name
            )
    except Exception as e:
        logger.error(f"Error ensuring session node: {e}")

def update_session_name(user_id: str, chat_id: str, name: str):
    """Updates the name property on a Session node in Neo4j."""
    if not user_id:
        raise ValueError("user_id cannot be None or empty in Neo4j operations")
    if not driver:
        return
    try:
        with driver.session() as session:
            session.run(
                "MATCH (s:Session {session_id: $chat_id, user_id: $user_id}) SET s.name = $name",
                chat_id=chat_id, user_id=user_id, name=name
            )
    except Exception as e:
        logger.error(f"Error updating session name in Neo4j: {e}")

def retrieve_sqlite_graph_context(user_id: str, chat_id: str, prompt: str) -> dict:
    from app.core.database import get_db_connection
    result = {
        "context_text": "",
        "entities": [],
        "relationships": [],
        "key_facts": [],
        "entity_count": 0,
        "relationship_count": 0
    }
    
    words = re.findall(r"\b\w{4,20}\b", prompt.lower())
    if not words:
        return result
    keywords = list(set(words))
    
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        # Fetch all entities for this user & chat to filter in memory
        cursor.execute(
            "SELECT name, type, description FROM entities WHERE user_id = ? AND chat_id = ?",
            (user_id, chat_id)
        )
        all_entities = cursor.fetchall()
        
        entities_seen = set()
        matched_entities = []
        key_facts = []
        
        for row in all_entities:
            ent_type = row["type"]
            ent_name = row["name"]
            ent_desc = row["description"] or ""
            
            if ent_type == "keyfact":
                key_facts.append(ent_desc)
                continue
                
            name_lower = ent_name.lower()
            desc_lower = ent_desc.lower()
            if any(kw in name_lower or kw in desc_lower for kw in keywords):
                entities_seen.add(ent_name)
                matched_entities.append({
                    "name": ent_name,
                    "type": ent_type or "concept",
                    "description": ent_desc
                })
                
        # Cold memory fallback in SQLite
        prompt_lower = prompt.lower()
        if "remember when" in prompt_lower or "going back to" in prompt_lower or "discussed before" in prompt_lower:
            cursor.execute(
                """
                SELECT e.name, e.type, e.description, COUNT(r.id) as degree
                FROM entities e
                LEFT JOIN relationships r ON (r.source = e.name OR r.target = e.name) AND r.chat_id = e.chat_id AND r.user_id = e.user_id
                WHERE e.user_id = ? AND e.chat_id = ? AND e.type != 'keyfact'
                GROUP BY e.name, e.type, e.description
                ORDER BY degree DESC
                LIMIT 10
                """,
                (user_id, chat_id)
            )
            cold_rows = cursor.fetchall()
            for r in cold_rows:
                name = r["name"]
                if name and name not in entities_seen:
                    entities_seen.add(name)
                    matched_entities.append({
                        "name": name,
                        "type": r["type"] or "concept",
                        "description": r["description"] or ""
                    })

        # Fetch matched relationships
        matched_rels = []
        matched_names = list(entities_seen)
        if matched_names:
            cursor.execute(
                "SELECT source, relation as type, target, description FROM relationships WHERE user_id = ? AND chat_id = ?",
                (user_id, chat_id)
            )
            all_rels = cursor.fetchall()
            for r in all_rels:
                src = r["source"]
                tgt = r["target"]
                if src in entities_seen or tgt in entities_seen:
                    matched_rels.append({
                        "source": src,
                        "type": r["type"] or "RELATED_TO",
                        "target": tgt,
                        "description": r["description"] or ""
                    })

        result["entities"] = matched_entities
        result["relationships"] = matched_rels
        result["key_facts"] = key_facts[:10]
        result["entity_count"] = len(matched_entities)
        result["relationship_count"] = len(matched_rels)

        # Build backward-compatible context text
        context_lines = []
        if matched_entities:
            context_lines.append("### Relevant Entities:")
            for ent in matched_entities:
                desc_str = f": {ent['description']}" if ent['description'] else ""
                context_lines.append(f"- {ent['name']} ({ent['type']}){desc_str}")
        if matched_rels:
            context_lines.append("\n### Relevant Relationships:")
            for rel in matched_rels:
                desc_str = f" - {rel['description']}" if rel['description'] else ""
                context_lines.append(f"- {rel['source']} -[{rel['type']}]-> {rel['target']}{desc_str}")
        if key_facts:
            context_lines.append("\n### Key Facts:")
            for fact in key_facts:
                context_lines.append(f"- {fact}")
                
        result["context_text"] = "\n".join(context_lines)
    except Exception as e:
        logger.error(f"Error querying SQLite graph context: {e}")
    finally:
        conn.close()
        
    return result

def retrieve_graph_context(user_id: str, chat_id: str, prompt: str) -> dict:
    """
    Session-scoped 3-tier graph memory retriever.
    Queries Neo4j if driver is active, falls back to SQLite database.
    """
    if not user_id:
        raise ValueError("user_id cannot be None or empty in Neo4j operations")
        
    result = {
        "context_text": "",
        "entities": [],
        "relationships": [],
        "key_facts": [],
        "entity_count": 0,
        "relationship_count": 0
    }
    
    words = re.findall(r"\b\w{4,20}\b", prompt.lower())
    if not words:
        return result
    keywords = list(set(words))

    if not driver:
        return retrieve_sqlite_graph_context(user_id, chat_id, prompt)

    entities_seen = set()
    entity_count = 0
    rel_count = 0
    context_lines = []
    
    try:
        with driver.session() as session:
            # Query Warm memory entities & relationships
            query = """
            MATCH (e:Entity {user_id: $user_id, session_id: $chat_id})
            WHERE toLower(e.name) IN $keywords
            OPTIONAL MATCH (e)-[r]->(adj:Entity {session_id: $chat_id, user_id: $user_id})
            RETURN e.name as source, e.type as source_type, e.description as source_desc,
                   coalesce(r.type, type(r)) as rel_type, adj.name as target,
                   adj.type as target_type, r.description as rel_desc
            LIMIT 20
            """
            records = list(session.run(query, user_id=user_id, chat_id=chat_id, keywords=keywords))
            
            for rec in records:
                src = rec["source"]
                if src and src not in entities_seen:
                    entities_seen.add(src)
                    result["entities"].append({
                        "name": src,
                        "type": rec["source_type"] or "concept",
                        "description": rec["source_desc"] or ""
                    })
                    entity_count += 1
                
                rel_type = rec["rel_type"]
                tgt = rec["target"]
                if rel_type and tgt:
                    result["relationships"].append({
                        "source": src,
                        "type": rel_type,
                        "target": tgt,
                        "description": rec["rel_desc"] or ""
                    })
                    rel_count += 1

            # Query Key Facts
            kf_query = """
            MATCH (kf:KeyFact {user_id: $user_id, session_id: $chat_id})-[:FACT_OF]->(s:Session {session_id: $chat_id, user_id: $user_id})
            RETURN kf.content as fact
            LIMIT 10
            """
            kf_records = list(session.run(kf_query, user_id=user_id, chat_id=chat_id))
            for rec in kf_records:
                if rec["fact"]:
                    result["key_facts"].append(rec["fact"])

            # Check cold memory trigger
            prompt_lower = prompt.lower()
            if "remember when" in prompt_lower or "going back to" in prompt_lower or "discussed before" in prompt_lower:
                cold_query = """
                MATCH (e:Entity {user_id: $user_id, session_id: $chat_id})
                OPTIONAL MATCH (e)-[r]->()
                WITH e, count(r) as degree
                ORDER BY degree DESC
                LIMIT 10
                RETURN e.name as name, e.type as type, e.description as description
                """
                cold_records = list(session.run(cold_query, user_id=user_id, chat_id=chat_id))
                for rec in cold_records:
                    name = rec["name"]
                    if name and name not in entities_seen:
                        entities_seen.add(name)
                        result["entities"].append({
                            "name": name,
                            "type": rec["type"] or "concept",
                            "description": rec["description"] or ""
                        })
                        entity_count += 1

        result["entity_count"] = entity_count
        result["relationship_count"] = rel_count
        
        # Build backward-compatible context text
        if result["entities"]:
            context_lines.append("### Relevant Entities:")
            for ent in result["entities"]:
                desc_str = f": {ent['description']}" if ent['description'] else ""
                context_lines.append(f"- {ent['name']} ({ent['type']}){desc_str}")
        if result["relationships"]:
            context_lines.append("\n### Relevant Relationships:")
            for rel in result["relationships"]:
                desc_str = f" - {rel['description']}" if rel['description'] else ""
                context_lines.append(f"- {rel['source']} -[{rel['type']}]-> {rel['target']}{desc_str}")
        if result["key_facts"]:
            context_lines.append("\n### Key Facts:")
            for fact in result["key_facts"]:
                context_lines.append(f"- {fact}")
                
        result["context_text"] = "\n".join(context_lines)

    except Exception as e:
        logger.error(f"Error querying Neo4j memory context, falling back to SQLite: {e}")
        return retrieve_sqlite_graph_context(user_id, chat_id, prompt)
        
    return result

def parse_json_safely(raw_text: str) -> dict:
    raw_text = raw_text.strip()
    if raw_text.startswith("```"):
        lines = raw_text.splitlines()
        if len(lines) >= 2:
            if lines[0].startswith("```"):
                lines = lines[1:]
            if lines[-1].startswith("```"):
                lines = lines[:-1]
            raw_text = "\n".join(lines).strip()
    
    match = re.search(r"(\{.*\})", raw_text, re.DOTALL)
    if match:
        raw_text = match.group(1)
        
    return json.loads(raw_text)

async def extract_and_store_entities(user_id: str, chat_id: str, user_msg: str, ai_msg: str):
    """
    Asynchronous Background Memory Extractor.
    Extracts entities/relationships using direct async HTTPX calls to the first available API provider.
    Saves to Neo4j (if connected), local SQLite, and synchronizes to Supabase.
    """
    if not user_id:
        raise ValueError("user_id cannot be None or empty in Neo4j/SQLite operations")

    from app.core.database import get_user_keys
    keys = get_user_keys(user_id)
    
    if not any(keys.values()):
        logger.warning("Skipping graph save: No active API keys are configured for entity extraction.")
        return

    ai_msg_truncated = ai_msg[:500]
    extraction_prompt = (
        "You are a knowledge graph builder. Read this conversation exchange and extract all important information.\n\n"
        "Return ONLY a valid JSON object with exactly these three arrays:\n\n"
        "{\n"
        "  \"entities\": [\n"
        "    {\"name\": \"entity name\", \"type\": \"Technology|Project|Concept|Person|Feature|Decision|Math|Code\", \"description\": \"brief description\"}\n"
        "  ],\n"
        "  \"relationships\": [\n"
        "    {\"source\": \"entity name\", \"relation\": \"USES|BUILDS|REQUIRES|DECIDED|REJECTED|RELATED_TO|DEPENDS_ON|CREATED_BY\", \"target\": \"entity name\", \"description\": \"brief description\"}\n"
        "  ],\n"
        "  \"key_facts\": [\n"
        "    {\"fact\": \"important standalone fact that must be remembered\"}\n"
        "  ]\n"
        "}\n\n"
        f"User message: {user_msg}\n"
        f"Assistant response: {ai_msg_truncated}"
    )

    data = None
    extraction_error = ""

    # 1. Try Google Gemini
    if keys.get("gemini"):
        gemini_key = keys["gemini"]
        candidate_models = ["gemini-1.5-flash", "gemini-2.0-flash", "gemini-2.5-flash", "gemini-3.5-flash"]
        gemini_success = False
        
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
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
                                    "contents": [{"parts": [{"text": extraction_prompt}]}],
                                    "generationConfig": {"responseMimeType": "application/json"}
                                }
                            )
                            if response.status_code == 200:
                                res_json = response.json()
                                raw_text = res_json["candidates"][0]["content"]["parts"][0]["text"].strip()
                                data = parse_json_safely(raw_text)
                                gemini_success = True
                                logger.info(f"Successfully extracted entities using Gemini {model} ({version})")
                                break
                        except Exception:
                            pass
        except Exception as e:
            extraction_error = f"Gemini extraction error: {str(e)}"
            logger.warning(extraction_error)

    # 2. Try Groq
    if not data and keys.get("groq"):
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
                    {"role": "user", "content": extraction_prompt}
                ],
                "response_format": {"type": "json_object"}
            }
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(url, headers=headers, json=json_payload)
                if response.status_code == 200:
                    res_json = response.json()
                    raw_text = res_json["choices"][0]["message"]["content"].strip()
                    data = parse_json_safely(raw_text)
                    logger.info("Successfully extracted entities using Groq llama-3.1-8b-instant")
        except Exception as e:
            extraction_error = f"Groq extraction error: {str(e)}"
            logger.warning(extraction_error)

    # 3. Try DeepSeek
    if not data and keys.get("deepseek"):
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
                    {"role": "user", "content": extraction_prompt}
                ],
                "response_format": {"type": "json_object"}
            }
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(url, headers=headers, json=json_payload)
                if response.status_code == 200:
                    res_json = response.json()
                    raw_text = res_json["choices"][0]["message"]["content"].strip()
                    data = parse_json_safely(raw_text)
                    logger.info("Successfully extracted entities using DeepSeek deepseek-chat")
        except Exception as e:
            extraction_error = f"DeepSeek extraction error: {str(e)}"
            logger.warning(extraction_error)

    # 4. Try OpenRouter
    if not data and keys.get("openrouter"):
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
                    {"role": "user", "content": extraction_prompt}
                ]
            }
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(url, headers=headers, json=json_payload)
                if response.status_code == 200:
                    res_json = response.json()
                    raw_text = res_json["choices"][0]["message"]["content"].strip()
                    data = parse_json_safely(raw_text)
                    logger.info("Successfully extracted entities using OpenRouter free model")
        except Exception as e:
            extraction_error = f"OpenRouter extraction error: {str(e)}"
            logger.warning(extraction_error)

    if not data:
        logger.error("All extraction API paths failed or returned invalid structured memory.")
        return

    try:
        entities = data.get("entities", [])
        relationships = data.get("relationships", [])
        key_facts_raw = data.get("key_facts", [])
        
        # Standardize key facts list to clean strings
        key_facts_clean = []
        for kf in key_facts_raw:
            if isinstance(kf, dict) and "fact" in kf:
                key_facts_clean.append(kf["fact"].strip())
            elif isinstance(kf, str):
                key_facts_clean.append(kf.strip())

        if not entities and not relationships and not key_facts_clean:
            logger.info("No new memory graph entities identified in this turn.")
            return

        # 1. Write to Neo4j if driver is active
        if driver:
            try:
                # Ensure session node exists
                ensure_session_node(user_id, chat_id)
                with driver.session() as session:
                    # Write User node
                    session.run("MERGE (u:User {id: $user_id})", user_id=user_id)
                    
                    # Write Entities (session-scoped)
                    for ent in entities:
                        name = ent.get("name", "").strip()
                        ent_type = ent.get("type", "Concept").strip()
                        desc = ent.get("description", "").strip()
                        if not name:
                            continue
                        
                        session.run(
                            """
                            MERGE (e:Entity {name: $name, user_id: $user_id, session_id: $chat_id})
                            ON CREATE SET e.type = $type, e.description = $desc, e.created_at = timestamp(), e.updated_at = timestamp()
                            ON MATCH SET e.description = CASE WHEN $desc <> '' THEN $desc ELSE e.description END, e.updated_at = timestamp()
                            """,
                            name=name, user_id=user_id, chat_id=chat_id, type=ent_type, desc=desc
                        )
                        # Create BELONGS_TO edge to Session
                        session.run(
                            """
                            MATCH (e:Entity {name: $name, user_id: $user_id, session_id: $chat_id})
                            MATCH (s:Session {session_id: $chat_id, user_id: $user_id})
                            MERGE (e)-[:BELONGS_TO]->(s)
                            """,
                            name=name, user_id=user_id, chat_id=chat_id
                        )

                    # Write Relationships (session-scoped)
                    for rel in relationships:
                        src = rel.get("source", "").strip()
                        tgt = rel.get("target", "").strip()
                        rel_type = rel.get("relation") or rel.get("type") or "RELATED_TO"
                        rel_type = rel_type.strip().upper().replace(" ", "_")
                        rel_desc = rel.get("description", "").strip()
                        
                        if not src or not tgt:
                            continue
                        
                        session.run(
                            """
                            MERGE (e1:Entity {name: $src, user_id: $user_id, session_id: $chat_id})
                            ON CREATE SET e1.type = 'Concept', e1.created_at = timestamp(), e1.updated_at = timestamp()
                            
                            MERGE (e2:Entity {name: $tgt, user_id: $user_id, session_id: $chat_id})
                            ON CREATE SET e2.type = 'Concept', e2.created_at = timestamp(), e2.updated_at = timestamp()
                            
                            MERGE (e1)-[r:RELATION {type: $rel_type, user_id: $user_id, session_id: $chat_id}]->(e2)
                            ON CREATE SET r.description = $desc, r.created_at = timestamp()
                            ON MATCH SET r.description = CASE WHEN $desc <> '' THEN $desc ELSE r.description END
                            """,
                            src=src, tgt=tgt, user_id=user_id, chat_id=chat_id, rel_type=rel_type, desc=rel_desc
                        )

                    # Write Key Facts (session-scoped)
                    for fact in key_facts_clean:
                        if not fact:
                            continue
                        session.run(
                            """
                            MATCH (s:Session {session_id: $chat_id, user_id: $user_id})
                            CREATE (kf:KeyFact {content: $fact, user_id: $user_id, session_id: $chat_id, created_at: timestamp()})
                            CREATE (kf)-[:FACT_OF {user_id: $user_id, session_id: $chat_id, created_at: timestamp()}]->(s)
                            """,
                            chat_id=chat_id, fact=fact, user_id=user_id
                        )
                logger.info(f"Successfully cataloged {len(entities)} nodes, {len(relationships)} relations, and {len(key_facts_clean)} facts in Neo4j.")
            except Exception as e:
                logger.error(f"Error writing graph data to Neo4j: {e}")
        else:
            logger.info("Neo4j driver is offline. Skipping Neo4j write.")

        # 2. Write to local SQLite database as backup/fallback!
        try:
            from app.core.database import get_db_connection
            import uuid
            conn = get_db_connection()
            cursor = conn.cursor()
            
            # Write Entities to SQLite
            for ent in entities:
                name = ent.get("name", "").strip()
                ent_type = ent.get("type", "Concept").strip()
                desc = ent.get("description", "").strip()
                if not name:
                    continue
                
                cursor.execute(
                    "SELECT id FROM entities WHERE user_id = ? AND chat_id = ? AND name = ?",
                    (user_id, chat_id, name)
                )
                existing = cursor.fetchone()
                if existing:
                    cursor.execute(
                        "UPDATE entities SET type = ?, description = ? WHERE id = ?",
                        (ent_type, desc, existing["id"])
                    )
                else:
                    ent_id = str(uuid.uuid4())
                    cursor.execute(
                        "INSERT INTO entities (id, user_id, chat_id, name, type, description) VALUES (?, ?, ?, ?, ?, ?)",
                        (ent_id, user_id, chat_id, name, ent_type, desc)
                    )
            
            # Write Key Facts to SQLite as entities of type 'keyfact'
            for fact in key_facts_clean:
                if not fact:
                    continue
                fact_name = fact[:100]
                cursor.execute(
                    "SELECT id FROM entities WHERE user_id = ? AND chat_id = ? AND type = 'keyfact' AND name = ?",
                    (user_id, chat_id, fact_name)
                )
                existing = cursor.fetchone()
                if not existing:
                    cursor.execute(
                        "INSERT INTO entities (id, user_id, chat_id, name, type, description) VALUES (?, ?, ?, ?, ?, ?)",
                        (str(uuid.uuid4()), user_id, chat_id, fact_name, "keyfact", fact)
                    )
            
            # Write Relationships to SQLite
            for rel in relationships:
                src = rel.get("source", "").strip()
                tgt = rel.get("target", "").strip()
                rel_type = rel.get("relation") or rel.get("type") or "RELATED_TO"
                rel_type = rel_type.strip().upper().replace(" ", "_")
                rel_desc = rel.get("description", "").strip()
                if not src or not tgt:
                    continue
                
                cursor.execute(
                    "SELECT id FROM relationships WHERE user_id = ? AND chat_id = ? AND source = ? AND target = ? AND relation = ?",
                    (user_id, chat_id, src, tgt, rel_type)
                )
                existing = cursor.fetchone()
                if existing:
                    cursor.execute(
                        "UPDATE relationships SET description = ? WHERE id = ?",
                        (rel_desc, existing["id"])
                    )
                else:
                    rel_id = str(uuid.uuid4())
                    cursor.execute(
                        "INSERT INTO relationships (id, user_id, chat_id, source, relation, target, description) VALUES (?, ?, ?, ?, ?, ?, ?)",
                        (rel_id, user_id, chat_id, src, rel_type, tgt, rel_desc)
                    )
                    
            conn.commit()
            print(f"[SQLITE GRAPH] Successfully saved {len(entities)} entities, {len(relationships)} relationships, and {len(key_facts_clean)} facts.")
            logger.info(f"Successfully saved {len(entities)} entities to local SQLite.")
        except Exception as e:
            logger.error(f"Error saving graph memory to SQLite: {e}")
        finally:
            if 'conn' in locals() and conn:
                conn.close()

        # 3. Synchronize to Supabase (we also append keyfacts as entities of type 'keyfact' to sync list)
        try:
            sync_entities = list(entities)
            for fact in key_facts_clean:
                sync_entities.append({
                    "name": fact[:100],
                    "type": "keyfact",
                    "description": fact
                })
            await sync_graph_to_supabase(user_id, chat_id, sync_entities, relationships)
        except Exception as sync_err:
            logger.warning(f"Background Supabase sync error: {sync_err}")

    except Exception as e:
        logger.error(f"Error in background memory extractor: {e}")

async def sync_graph_to_supabase(user_id: str, chat_id: str, entities: List[dict], relationships: List[dict]):
    """
    Lightweight, zero-dependency async PostgREST sync helper for Knowledge Graph memory.
    """
    key = settings.SUPABASE_SERVICE_ROLE_KEY or settings.SUPABASE_KEY
    if not settings.SUPABASE_URL or not key:
        return

    headers = {
        "Authorization": f"Bearer {key}",
        "apikey": key,
        "Content-Type": "application/json",
        "Prefer": "return=minimal"
    }

    # Sync Entities
    if entities:
        url_ent = f"{settings.SUPABASE_URL.rstrip('/')}/rest/v1/entities"
        payload_ent = [
            {
                "user_id": user_id,
                "chat_id": chat_id,
                "name": ent.get("name", "").strip(),
                "type": ent.get("type", "Concept").strip(),
                "description": ent.get("description", "").strip()
            }
            for ent in entities if ent.get("name")
        ]
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                res = await client.post(url_ent, headers=headers, json=payload_ent)
                if res.status_code not in [200, 201, 204]:
                    err_msg = f"[SUPABASE ERROR] Entities sync failed with status {res.status_code}: {res.text}"
                    print(err_msg)
                    logger.error(err_msg)
                else:
                    print(f"[SUPABASE] Successfully synchronized {len(payload_ent)} entities to Supabase.")
        except Exception as e:
            err_msg = f"[SUPABASE ERROR] Exception syncing entities to Supabase: {e}"
            print(err_msg)
            logger.warning(err_msg)

    # Sync Relationships
    if relationships:
        url_rel = f"{settings.SUPABASE_URL.rstrip('/')}/rest/v1/relationships"
        payload_rel = [
            {
                "user_id": user_id,
                "chat_id": chat_id,
                "source": rel.get("source", "").strip(),
                "target": rel.get("target", "").strip(),
                "relation": rel.get("relation") or rel.get("type") or "RELATED_TO",
                "description": rel.get("description", "").strip()
            }
            for rel in relationships if rel.get("source") and rel.get("target")
        ]
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                res = await client.post(url_rel, headers=headers, json=payload_rel)
                if res.status_code not in [200, 201, 204]:
                    err_msg = f"[SUPABASE ERROR] Relationships sync failed with status {res.status_code}: {res.text}"
                    print(err_msg)
                    logger.error(err_msg)
                else:
                    print(f"[SUPABASE] Successfully synchronized {len(payload_rel)} relationships to Supabase.")
        except Exception as e:
            err_msg = f"[SUPABASE ERROR] Exception syncing relationships to Supabase: {e}"
            print(err_msg)
            logger.warning(err_msg)

def get_sqlite_session_graph(user_id: str, chat_id: str) -> dict:
    """Returns all entities, relationships, and key facts for a specific session from SQLite database."""
    from app.core.database import get_db_connection
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            "SELECT name, type, description FROM entities WHERE user_id = ? AND chat_id = ? AND type != 'keyfact'",
            (user_id, chat_id)
        )
        entities = [{"name": r["name"], "type": r["type"] or "Concept", "description": r["description"] or ""} for r in cursor.fetchall()]
        
        cursor.execute(
            "SELECT description FROM entities WHERE user_id = ? AND chat_id = ? AND type = 'keyfact'",
            (user_id, chat_id)
        )
        key_facts = [r["description"] for r in cursor.fetchall() if r["description"]]

        cursor.execute(
            "SELECT source, target, relation as type, description FROM relationships WHERE user_id = ? AND chat_id = ?",
            (user_id, chat_id)
        )
        relationships = [{"source": r["source"], "target": r["target"], "type": r["type"] or "RELATED_TO", "description": r["description"] or ""} for r in cursor.fetchall()]
        
        return {"entities": entities, "relationships": relationships, "key_facts": key_facts}
    except Exception as e:
        logger.error(f"Error fetching SQLite session graph: {e}")
        return {"entities": [], "relationships": [], "key_facts": []}
    finally:
        conn.close()

def get_session_graph(user_id: str, chat_id: str) -> dict:
    """Returns all entities, relationships, and key facts for a specific session from Neo4j, falling back to SQLite."""
    if not user_id:
        raise ValueError("user_id cannot be None or empty in Neo4j operations")
    if not driver:
        return get_sqlite_session_graph(user_id, chat_id)
    try:
        with driver.session() as session:
            ent_query = """
            MATCH (e:Entity {user_id: $user_id, session_id: $chat_id})
            RETURN e.name as name, e.type as type, e.description as description
            ORDER BY e.created_at
            """
            ent_records = list(session.run(ent_query, user_id=user_id, chat_id=chat_id))
            entities = [{"name": r["name"], "type": r["type"] or "Concept", "description": r["description"] or ""} for r in ent_records]

            rel_query = """
            MATCH (e1:Entity {user_id: $user_id, session_id: $chat_id})-[r]->(e2:Entity {session_id: $chat_id, user_id: $user_id})
            RETURN e1.name as source, coalesce(r.type, type(r)) as rel_type, e2.name as target, r.description as description
            """
            rel_records = list(session.run(rel_query, user_id=user_id, chat_id=chat_id))
            relationships = [{"source": r["source"], "target": r["target"], "type": r["rel_type"] or "RELATED_TO", "description": r["description"] or ""} for r in rel_records]

            kf_query = """
            MATCH (kf:KeyFact {user_id: $user_id, session_id: $chat_id})-[:FACT_OF]->(s:Session {session_id: $chat_id, user_id: $user_id})
            RETURN kf.content as fact
            LIMIT 20
            """
            kf_records = list(session.run(kf_query, user_id=user_id, chat_id=chat_id))
            key_facts = [r["fact"] for r in kf_records if r["fact"]]

            # Fallback to SQLite if Neo4j is empty
            if not entities:
                sqlite_data = get_sqlite_session_graph(user_id, chat_id)
                if sqlite_data["entities"]:
                    return sqlite_data

            return {"entities": entities, "relationships": relationships, "key_facts": key_facts}
    except Exception as e:
        logger.error(f"Error fetching session graph from Neo4j, falling back to SQLite: {e}")
        return get_sqlite_session_graph(user_id, chat_id)

def delete_graph_node(user_id: str, node_name: str, chat_id: str) -> bool:
    """Deletes a specific entity node and all its edges from SQLite, Supabase, and Neo4j."""
    if not user_id:
        raise ValueError("user_id cannot be None or empty in operations")
        
    sqlite_success = False
    try:
        from app.core.database import get_db_connection
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM entities WHERE user_id = ? AND chat_id = ? AND name = ?", (user_id, chat_id, node_name))
        cursor.execute("DELETE FROM relationships WHERE user_id = ? AND chat_id = ? AND (source = ? OR target = ?)", (user_id, chat_id, node_name, node_name))
        conn.commit()
        sqlite_success = True
    except Exception as e:
        logger.error(f"Error deleting SQLite graph node: {e}")
    finally:
        if 'conn' in locals() and conn:
            conn.close()

    from app.core.database import is_supabase_active, supabase_delete
    if is_supabase_active():
        try:
            supabase_delete("entities", {"user_id": f"eq.{user_id}", "chat_id": f"eq.{chat_id}", "name": f"eq.{node_name}"})
            supabase_delete("relationships", {"user_id": f"eq.{user_id}", "chat_id": f"eq.{chat_id}", "source": f"eq.{node_name}"})
            supabase_delete("relationships", {"user_id": f"eq.{user_id}", "chat_id": f"eq.{chat_id}", "target": f"eq.{node_name}"})
        except Exception as e:
            logger.warning(f"Error deleting Supabase graph node: {e}")

    neo4j_success = False
    if driver:
        try:
            with driver.session() as session:
                session.run(
                    "MATCH (e:Entity {name: $name, user_id: $user_id, session_id: $chat_id}) DETACH DELETE e",
                    name=node_name, user_id=user_id, chat_id=chat_id
                )
            neo4j_success = True
        except Exception as e:
            logger.error(f"Error deleting graph node in Neo4j: {e}")
            
    return sqlite_success or neo4j_success

def delete_user_graph_data(user_id: str) -> bool:
    """Deletes all graph nodes and relationships where user_id matches across SQLite, Supabase, and Neo4j."""
    if not user_id:
        raise ValueError("user_id cannot be None or empty in operations")
        
    sqlite_success = False
    try:
        from app.core.database import get_db_connection
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM entities WHERE user_id = ?", (user_id,))
        cursor.execute("DELETE FROM relationships WHERE user_id = ?", (user_id,))
        conn.commit()
        sqlite_success = True
    except Exception as e:
        logger.error(f"Error deleting SQLite user graph data: {e}")
    finally:
        if 'conn' in locals() and conn:
            conn.close()

    from app.core.database import is_supabase_active, supabase_delete
    if is_supabase_active():
        try:
            supabase_delete("entities", {"user_id": f"eq.{user_id}"})
            supabase_delete("relationships", {"user_id": f"eq.{user_id}"})
        except Exception as e:
            logger.warning(f"Error deleting Supabase user graph data: {e}")

    neo4j_success = False
    if driver:
        try:
            with driver.session() as session:
                session.run("MATCH (n {user_id: $user_id}) DETACH DELETE n", user_id=user_id)
            neo4j_success = True
        except Exception as e:
            logger.error(f"Error deleting user graph data in Neo4j: {e}")
            
    return sqlite_success or neo4j_success

def get_sqlite_session_dominant_topic(user_id: str, chat_id: str) -> str:
    """Calculates the dominant topic based on the entity with the highest relationship degree in SQLite."""
    from app.core.database import get_db_connection
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            SELECT e.name, e.type, COUNT(r.id) as degree
            FROM entities e
            LEFT JOIN relationships r ON (r.source = e.name OR r.target = e.name) AND r.chat_id = e.chat_id AND r.user_id = e.user_id
            WHERE e.user_id = ? AND e.chat_id = ? AND e.type != 'keyfact'
            GROUP BY e.name, e.type
            ORDER BY degree DESC
            LIMIT 1
            """,
            (user_id, chat_id)
        )
        row = cursor.fetchone()
        if not row or not row["name"]:
            return None
        
        name = row["name"]
        ent_type = row["type"]
        
        name_lower = name.lower()
        type_lower = ent_type.lower() if ent_type else ""
        
        # Check for math
        if "math" in name_lower or "math" in type_lower or type_lower == "mathematics":
            return "Mathematical Problem Solving"
        
        # Check for coding
        coding_terms = ["coding", "architecture", "programming", "software design", "code design", "refactor", "algorithm"]
        if any(term in name_lower for term in coding_terms) or any(term in type_lower for term in ["coding", "architecture", "programming"]):
            return "Code Architecture Design"
        
        # Check for project, technology, feature
        if any(t in type_lower for t in ["project", "technology", "feature", "concept", "app"]) or any(t in name_lower for t in ["app", "system", "platform"]):
            formatted_name = name.strip()
            if "development" in formatted_name.lower():
                return formatted_name
            return f"{formatted_name} Development"
        
        return f"{name.strip()}"
    except Exception as e:
        logger.error(f"Error getting SQLite session dominant topic: {e}")
        return None
    finally:
        conn.close()

def get_session_dominant_topic(user_id: str, chat_id: str) -> str:
    """
    Finds the dominant topic of the session based on the entity with the highest relationship degree in Neo4j,
    falling back to SQLite.
    """
    if not user_id:
        raise ValueError("user_id cannot be None or empty in operations")
    if not driver:
        return get_sqlite_session_dominant_topic(user_id, chat_id)
    try:
        with driver.session() as session:
            query = """
            MATCH (e:Entity {user_id: $user_id, session_id: $chat_id})
            WITH e, size([(e)-[r]-() | r]) as degree
            ORDER BY degree DESC
            LIMIT 1
            RETURN e.name as name, e.type as type
            """
            result = session.run(query, user_id=user_id, chat_id=chat_id)
            record = result.single()
            if not record:
                return get_sqlite_session_dominant_topic(user_id, chat_id)
            
            name = record["name"]
            ent_type = record["type"]
            
            if not name:
                return get_sqlite_session_dominant_topic(user_id, chat_id)
            
            name_lower = name.lower()
            type_lower = ent_type.lower() if ent_type else ""
            
            # Check for math
            if "math" in name_lower or "math" in type_lower or type_lower == "mathematics":
                return "Mathematical Problem Solving"
            
            # Check for coding
            coding_terms = ["coding", "architecture", "programming", "software design", "code design", "refactor", "algorithm"]
            if any(term in name_lower for term in coding_terms) or any(term in type_lower for term in ["coding", "architecture", "programming"]):
                return "Code Architecture Design"
            
            # Check for project, technology, feature
            if any(t in type_lower for t in ["project", "technology", "feature", "concept", "app"]) or any(t in name_lower for t in ["app", "system", "platform"]):
                formatted_name = name.strip()
                if "development" in formatted_name.lower():
                    return formatted_name
                return f"{formatted_name} Development"
            
            return f"{name.strip()}"
    except Exception as e:
        logger.error(f"Error getting session dominant topic from Neo4j, falling back to SQLite: {e}")
        return get_sqlite_session_dominant_topic(user_id, chat_id)

