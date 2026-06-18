from pydantic_settings import BaseSettings
from functools import lru_cache
import os
import logging

logger = logging.getLogger(__name__)

class Settings(BaseSettings):
    PORT: int = 8000
    HOST: str = "0.0.0.0"
    ENCRYPTION_KEY: str = ""
    SUPABASE_URL: str = ""
    SUPABASE_KEY: str = ""
    SUPABASE_SERVICE_ROLE_KEY: str = ""
    CLERK_SECRET_KEY: str = ""
    NEO4J_URI: str = ""
    NEO4J_USERNAME: str = "neo4j"
    NEO4J_PASSWORD: str = ""

    # AWS RDS configuration
    AWS_RDS_HOST: str = ""
    AWS_RDS_PORT: int = 5432
    AWS_RDS_DATABASE: str = "omnimind"
    AWS_RDS_USER: str = "omnimind_admin"
    AWS_RDS_PASSWORD: str = ""

    # AWS Credentials for Secrets Manager
    AWS_ACCESS_KEY_ID: str = ""
    AWS_SECRET_ACCESS_KEY: str = ""
    AWS_DEFAULT_REGION: str = "us-east-1"

    # Universal Fallback Agent Key
    UNIVERSAL_FALLBACK_API_KEY: str = ""

    class Config:
        env_file = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), ".env")
        env_file_encoding = "utf-8"
        extra = "ignore"

    def __init__(self, **values):
        super().__init__(**values)
        if self.AWS_ACCESS_KEY_ID and self.AWS_SECRET_ACCESS_KEY:
            try:
                import boto3
                import json
                session = boto3.Session(
                    aws_access_key_id=self.AWS_ACCESS_KEY_ID,
                    aws_secret_access_key=self.AWS_SECRET_ACCESS_KEY,
                    region_name=self.AWS_DEFAULT_REGION or "us-east-1"
                )
                client = session.client('secretsmanager')
                secret_name = "omnimind/production/secrets"
                logger.info(f"[AWS Secrets Manager] Fetching secret '{secret_name}'...")
                response = client.get_secret_value(SecretId=secret_name)
                if 'SecretString' in response:
                    secrets = json.loads(response['SecretString'])
                    if 'ENCRYPTION_KEY' in secrets:
                        self.ENCRYPTION_KEY = secrets['ENCRYPTION_KEY']
                        logger.info("[AWS Secrets Manager] Successfully loaded ENCRYPTION_KEY")
                    if 'NEO4J_PASSWORD' in secrets:
                        self.NEO4J_PASSWORD = secrets['NEO4J_PASSWORD']
                        logger.info("[AWS Secrets Manager] Successfully loaded NEO4J_PASSWORD")
            except Exception as e:
                logger.error(f"[AWS Secrets Manager] Warning: Could not fetch secrets: {e}")


@lru_cache()
def get_settings():
    return Settings()

