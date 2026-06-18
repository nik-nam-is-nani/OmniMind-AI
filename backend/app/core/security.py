from cryptography.fernet import Fernet
import logging
from fastapi import Header, HTTPException, status
from jose import jwt
import httpx
from app.core.config import get_settings

logger = logging.getLogger(__name__)

def encrypt_key(plain_key: str, encryption_key: str) -> str:
    """
    Encrypts a plain text API key using a symmetric Fernet key.
    """
    if not plain_key:
        return ""
    try:
        f = Fernet(encryption_key.encode())
        return f.encrypt(plain_key.encode()).decode()
    except Exception as e:
        logger.error(f"Error encrypting API key: {e}")
        raise ValueError("Failed to encrypt key")

def decrypt_key(encrypted_key: str, encryption_key: str) -> str:
    """
    Decrypts an encrypted API key using a symmetric Fernet key.
    """
    if not encrypted_key:
        return ""
    try:
        f = Fernet(encryption_key.encode())
        return f.decrypt(encrypted_key.encode()).decode()
    except Exception as e:
        logger.error(f"Error decrypting API key: {e}")
        raise ValueError("Failed to decrypt key")

async def verify_clerk_token(authorization: str = Header(None)) -> str:
    """
    FastAPI dependency function that extracts and validates a Clerk or Google JWT token.
    Allows "dev_user" bypass if Clerk/Google is unconfigured or token is "dev_user".
    """
    settings = get_settings()
    
    # 1. Check if token is missing
    if not authorization:
        clerk_secret = settings.CLERK_SECRET_KEY
        if not clerk_secret or clerk_secret.startswith("sk_test_xxx") or clerk_secret == "":
            return "dev_user"
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Authorization Header"
        )
        
    if not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Authorization Header (must start with 'Bearer ')"
        )
        
    token = authorization.split(" ")[1].strip()
    
    # 2. Support development bypass and unique guest session isolation
    clerk_secret = settings.CLERK_SECRET_KEY
    if not clerk_secret or clerk_secret.startswith("sk_test_xxx") or token == "dev_user" or token.startswith("guest_") or token == "":
        return token if token else "dev_user"
        
    try:
        # Unverified decode to get issuer and locate JWKS endpoint
        unverified_claims = jwt.get_unverified_claims(token)
        iss = unverified_claims.get("iss")
        if not iss:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token payload: missing issuer ('iss')"
            )
            
        # Determine JWKS endpoint based on issuer
        if "accounts.google.com" in iss:
            jwks_url = "https://www.googleapis.com/oauth2/v3/certs"
        else:
            jwks_url = f"{iss.rstrip('/')}/.well-known/jwks.json"
            
        # Fetch JWKS (JSON Web Key Set)
        async with httpx.AsyncClient(timeout=10.0) as client:
            res = await client.get(jwks_url)
            if res.status_code != 200:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail=f"Failed to fetch JWKS from issuer endpoint: {jwks_url}"
                )
            jwks = res.json()
            
        # Decode and verify the token signature
        payload = jwt.decode(
            token,
            jwks,
            algorithms=["RS256"],
            options={"verify_aud": False}
        )
        
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token verified but missing subject ('sub') user ID"
            )
            
        return user_id
        
    except Exception as e:
        logger.error(f"JWT authentication failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Authentication failed: {str(e)}"
        )


