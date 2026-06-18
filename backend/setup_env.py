import os
from cryptography.fernet import Fernet

env_path = ".env"
env_example_path = ".env.example"

if not os.path.exists(env_path):
    print("Creating .env file from .env.example...")
    with open(env_example_path, "r") as f:
        content = f.read()
    
    # Generate AES Fernet Key
    key = Fernet.generate_key().decode()
    content = content.replace("your-fernet-encryption-key-here", key)
    
    with open(env_path, "w") as f:
        f.write(content)
    print("Successfully generated .env with secure key.")
else:
    print(".env already exists.")
