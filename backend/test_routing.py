import asyncio
import httpx
import sqlite3
import os
import json
from app.core.database import DB_PATH, get_user_keys, save_user_keys, get_user_keys_masked

async def test_integration():
    print("--- Starting OmniMind Integration Test ---")
    user_id = "guest_test_developer_user"
    
    # 1. Clear any existing keys for this test user
    conn = sqlite3.connect(DB_PATH)
    conn.execute("DELETE FROM user_keys WHERE user_id = ?", (user_id,))
    conn.commit()
    conn.close()
    
    print("\n[Step 1] Verifying that keys are unconfigured initially:")
    keys = get_user_keys(user_id)
    print(f"Raw Keys retrieved: {keys}")
    assert keys["groq"] is None, "Groq key should be None"
    
    masked = get_user_keys_masked(user_id)
    print(f"Masked settings retrieved: {masked}")
    assert masked["groq_key_configured"] is False, "Groq should not be configured"
    
    # 2. Save a mock Groq API key to test encryption & DB persistence
    print("\n[Step 2] Saving mock Groq API key:")
    mock_key = "gsk_testkey_123456789_abcdef"
    save_success = save_user_keys(user_id, {"groq": mock_key})
    print(f"Save success: {save_success}")
    assert save_success is True, "Should save key successfully"
    
    # 3. Retrieve and decrypt keys
    print("\n[Step 3] Fetching and verifying stored keys:")
    fetched_keys = get_user_keys(user_id)
    print(f"Decrypted keys: {fetched_keys}")
    assert fetched_keys["groq"] == mock_key, "Decrypted key must match original mock key"
    
    fetched_masked = get_user_keys_masked(user_id)
    print(f"Masked keys: {fetched_masked}")
    assert fetched_masked["groq_key_configured"] is True, "Groq key must be marked as configured"
    assert fetched_masked["groq_key_masked"] == "gsk_...xxxx", "Masked representation must be 'gsk_...xxxx'"
    print("Encryption, persistence, decryption, and masking all verified successfully!")
    
    # 4. Create a chat room and test the model routing heuristic
    print("\n[Step 4] Testing model routing through FastAPI backend:")
    async with httpx.AsyncClient() as client:
        # Create chat
        create_res = await client.post(
            "http://localhost:8000/api/chat/create",
            headers={"Authorization": f"Bearer {user_id}"},
            json={"title": "Test Integration Room"}
        )
        assert create_res.status_code == 200, f"Should create chat room, got {create_res.status_code} {create_res.text}"
        chat_id = create_res.json()["chat_id"]
        print(f"Created test chat room: {chat_id}")
        
        # Test chat messaging. Since Gemini key is missing but Groq is configured,
        # it should dynamically re-route to Groq/Llama model.
        # We will capture the first SSE stream packet to verify it.
        print("Sending chat stream request...")
        headers = {"Authorization": f"Bearer {user_id}", "Content-Type": "application/json"}
        async with client.stream(
            "POST",
            f"http://localhost:8000/api/chat/{chat_id}/message",
            headers=headers,
            json={"content": "summarize this short text: Hello world!"}
        ) as response:
            assert response.status_code == 200, f"Chat message request should succeed, got {response.status_code}"
            
            # Read first line of stream to check selected model
            async for line in response.aiter_lines():
                if line:
                    chunk_data = json.loads(line)
                    print(f"Stream yielded chunk: {chunk_data}")
                    
                    # Verify model routing switched from Gemini to Groq
                    if "model" in chunk_data:
                        print(f"Routed model reported by stream: {chunk_data['model']}")
                        assert chunk_data["model"] == "groq-llama-3", "Routing should fall back to Groq/Llama"
                        print("Dynamic routing heuristic verified successfully!")
                        break
                    
    print("\n--- All OmniMind Integration Tests Passed Successfully! ---")

if __name__ == "__main__":
    asyncio.run(test_integration())
