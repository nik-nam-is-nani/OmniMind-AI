from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any

class APIKeysSaveRequest(BaseModel):
    gemini_key: Optional[str] = None
    groq_key: Optional[str] = None
    deepseek_key: Optional[str] = None
    openrouter_key: Optional[str] = None

class APIKeysResponse(BaseModel):
    gemini_key_configured: bool
    groq_key_configured: bool
    deepseek_key_configured: bool
    openrouter_key_configured: bool
    gemini_key_masked: str
    groq_key_masked: str
    deepseek_key_masked: str
    openrouter_key_masked: str

class APIKeyTestRequest(BaseModel):
    key_type: str = Field(..., description="One of 'gemini', 'groq', 'deepseek', 'openrouter'")
    api_key: str

class APIKeyTestResponse(BaseModel):
    success: bool
    message: str

class ChatCreateRequest(BaseModel):
    title: str

class ChatMessageRequest(BaseModel):
    content: str
    model_override: Optional[str] = None
    web_search: Optional[bool] = False
    display_content: Optional[str] = None

class ChatMessageResponse(BaseModel):
    content: str
    routed_model: str
    input_tokens: int
    output_tokens: int
    calculated_cost: float
    savings: float

class ChatRenameRequest(BaseModel):
    title: str
