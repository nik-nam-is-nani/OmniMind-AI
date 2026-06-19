# OmniMind-AI

OmniMind-AI is a unified enterprise chat platform that intelligently routes user queries across multiple LLM providers (Google Gemini, Groq, DeepSeek, OpenRouter). The platform features cognitive memory graph integration, secure AWS RDS PostgreSQL data storage, transparent SQL dialect adaptation, and custom authentication.

---

## 🌟 Key Features

### 1. Intelligent Model Routing
- **Cognitive Task Classification**: Dynamically classifies prompt payloads into specialized task types (e.g., `summarization`, `math_logic`, `architecture_coding`, `general_creative`).
- **Resilient Fallback Chains**: Automatically cascades queries to alternative providers if a primary model quota/rate-limit is exhausted (e.g., falls back from Gemini to OpenRouter).
- **Universal Fallback API Limit Agent**: If all user API keys are invalid or exhausted, a dedicated limit agent runs using a backend-managed fallback key to guide the user on setting up their own API keys.

### 2. Cognitive Memory Graph
- **Contextual Entity Extraction**: Extracts entities and relationships from conversation history in real-time.
- **Dual-Layer Graph Storage**: Synchronizes cognitive memories to local/RDS SQL tables (`entities`, `relationships`) and visualizes them dynamically.
- **Active User Isolation**: Strictly partitions graph records and data queries so that users only retrieve their own graph nodes.

### 3. Production-Grade Secure Authentication
- **Secure Email/Password Auth**: Server-side registration and login backed by AWS RDS PostgreSQL using PBKDF2-HMAC-SHA256 password hashing (100,000 iterations).
- **Google OAuth Sign-In**: Integration with Google Identity Services (GSI).
- **Dynamic JWT Validation**: Custom JWT token creation and signature validation (supporting RS256 for Google OAuth and HS256 for custom email accounts).
- **Transparent Session ID Migration**: Seamlessly detects and migrates legacy raw-JWT user IDs in the database to clean stable IDs across all dependent tables in a safe transaction.
- **Removed Guest Sandbox**: Completely retired unsecured Guest Modes to guarantee all sessions are securely authenticated.

### 4. Advanced Tooling & UI
- **Real-Time Streaming**: Real-time server-sent events (SSE) for model completions.
- **Multi-Format Document Parsing**: Upload and parse PDFs, DOCX, PPTX, XLSX, CSV, and images.
- **3D Network Visualization**: Interactive WebGL neural net canvas and custom memory graph visualizer.
- **PDF Export**: Download message history and agent logs as a formatted PDF.

---

## 🛠️ Technology Stack

| Layer | Technologies |
|---|---|
| **Frontend** | Next.js (App Router), React, TypeScript, TailwindCSS, Three.js (3D Graph Canvas), Google GSI |
| **Backend** | FastAPI (Python), Uvicorn, Python-Jose (JWT), Cryptography (AES-256 Fernet), Boto3 |
| **Database** | AWS RDS (PostgreSQL), Neo4j AuraDB (Graph Sync), Supabase (Storage and Sync Fallback) |
| **Cloud & Hosting** | AWS EC2, Docker & Docker Compose, Nginx (Reverse Proxy), Certbot (Let's Encrypt SSL) |

---

## 📁 Project Structure

```
OmniMind-AI/
├── backend/
│   ├── app/
│   │   ├── api/            # API Route endpoints (chat, settings, users, stats)
│   │   ├── core/           # Security, config, database adapters, graph helpers
│   │   ├── models/         # Pydantic schemas for request validation
│   │   ├── services/       # LLM routing, Google search, Document parsing
│   │   └── main.py         # FastAPI App Entrypoint & Lifespan triggers
│   ├── Dockerfile
│   ├── requirements.txt    # Python package dependencies
│   └── model_performance.json
├── frontend/
│   ├── src/
│   │   ├── app/            # Next.js App Router (auth, home, layout)
│   │   ├── components/     # UI components (ChatBox, Sidebar, Canvas)
│   │   └── lib/            # Axios API wrappers and authentication contexts
│   ├── Dockerfile
│   └── package.json        # Frontend node dependencies
├── docker-compose.yml      # Orchestrates local/production services
└── README.md
```

---

## 🚀 Installation & Local Setup

### 1. Prerequisites
- Python 3.10+ installed
- Node.js 18+ installed
- Docker and Docker Compose (if running containerized)

### 2. Backend Setup
1. Navigate to the backend directory and set up a virtual environment:
   ```bash
   cd backend
   python -m venv venv
   # Activate virtual env:
   # On Windows:
   .\venv\Scripts\activate
   # On Linux/macOS:
   source venv/bin/activate
   ```
2. Install Python dependencies:
   ```bash
   pip install -r requirements.txt
   ```
3. Set up your local configuration:
   ```bash
   copy .env.example .env
   ```
   *Edit the `.env` file with your database, secrets, and API credentials (see [Environment Variables](#-environment-variables)).*
4. Run the FastAPI development server:
   ```bash
   uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
   ```

### 3. Frontend Setup
1. Navigate to the frontend directory:
   ```bash
   cd ../frontend
   ```
2. Install Node dependencies:
   ```bash
   npm install
   ```
3. Configure the frontend environment:
   ```bash
   copy .env.example .env.local
   ```
   *Configure your Google Client ID and point `NEXT_PUBLIC_API_URL` to your FastAPI server.*
4. Start the Next.js development server:
   ```bash
   npm run dev
   ```
5. Open `http://localhost:3000` in your browser.

---

## 🔒 Environment Variables

### Backend (`backend/.env`)

| Variable | Type | Description |
|---|---|---|
| `PORT` | `int` | FastAPI Port (default: `8000`) |
| `HOST` | `str` | FastAPI Host binding (default: `0.0.0.0`) |
| `AWS_RDS_HOST` | `str` | Hostname of your AWS RDS PostgreSQL database |
| `AWS_RDS_PORT` | `int` | Port of your AWS RDS PostgreSQL database (default: `5432`) |
| `AWS_RDS_DATABASE` | `str` | Name of your PostgreSQL database |
| `AWS_RDS_USER` | `str` | Database master user |
| `AWS_RDS_PASSWORD` | `str` | Database master password |
| `AWS_ACCESS_KEY_ID` | `str` | (Optional) AWS Access Key ID for Secrets Manager integration |
| `AWS_SECRET_ACCESS_KEY` | `str` | (Optional) AWS Secret Access Key |
| `AWS_DEFAULT_REGION` | `str` | AWS region name for secrets (e.g. `us-east-1`) |
| `ENCRYPTION_KEY` | `str` | AES-256 Symmetric Key for encrypting user API keys in the DB |
| `UNIVERSAL_FALLBACK_API_KEY`| `str` | Backend fallback Gemini API key for the limit agent |
| `NEO4J_URI` | `str` | Connection URL for Neo4j database |
| `NEO4J_USERNAME` | `str` | Username for Neo4j database |
| `NEO4J_PASSWORD` | `str` | Password for Neo4j database |
| `SUPABASE_URL` | `str` | (Optional) Supabase API URL for graph sync fallbacks |
| `SUPABASE_KEY` | `str` | (Optional) Supabase API publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | `str` | (Optional) Supabase Service Role Key |

### Frontend (`frontend/.env.local`)

| Variable | Type | Description |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `str` | Backend API Server URL (default: `http://localhost:8000` in dev, or your domain in prod) |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID`| `str` | Google Cloud Console OAuth 2.0 Client ID for Google Sign-In |

---

## 📡 Key API Endpoints

### Authentication
- `POST /api/users/register`: Registers a new user with an email and password.
- `POST /api/users/login`: Authenticates user credentials and returns a signed HS256 JWT access token.
- `POST /api/users/init`: Onboards/upserts the authenticated session, auto-creating a default session and sync nodes if new.
- `DELETE /api/users/me`: Cascades the deletion of all user data across all tables.

### Chats & Sessions
- `GET /api/chat/`: Returns all chats belonging to the authenticated user.
- `POST /api/chat/create`: Spawns a new chat session.
- `GET /api/chat/{id}/messages`: Fetches chat logs for the session.
- `POST /api/chat/{id}/message`: Submits a prompt and streams back the routed LLM response (SSE).
- `GET /api/chat/{id}/graph`: Retrieves the session knowledge graph nodes (entities, relationships).
- `GET /api/chat/{id}/message/{msg_id}/pdf`: Generates and downloads a formatted PDF report of the message.
- `POST /api/chat/upload-document`: Parses and extracts text content from uploaded files.

### Configuration & Analytics
- `GET /api/stats/`: Computes aggregated metrics on tokens used, cumulative cost, and cost savings.
- `POST /api/settings/save`: Encrypts and persists user-provided LLM API keys.

---

## 🚢 Production Deployment (AWS EC2 & Docker Compose)

OmniMind-AI is fully containerized using Docker Compose. Nginx is configured as a reverse proxy, routing web requests to the frontend container and `/api` requests to the FastAPI backend.

### 1. Rebuilding & Starting Services on EC2
To deploy updates on your remote server:
```bash
cd ~/omnimind
# Pull the latest changes from the git branch
git pull origin main
# Shut down active containers
sudo docker compose down
# Rebuild the Docker containers ignoring cache
sudo docker compose build --no-cache
# Start all services in detached background mode
sudo docker compose up -d
```

### 2. Nginx Reverse Proxy Configuration
Place the following block inside your Nginx server site configuration (e.g. `/etc/nginx/sites-available/omnimind`):
```nginx
server {
    server_name omnimind-c.duckdns.org;

    # Route backend endpoints
    location /api {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # Route static frontend application
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### 3. SSL Configuration (Let's Encrypt Certbot)
Google Identity Services (Google Sign-In) **strictly requires HTTPS** to execute client authentications. Configure SSL using Certbot:
```bash
sudo apt update
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d omnimind-c.duckdns.org
```

---

## 🛡️ License

Distributed under the MIT License. See `LICENSE` for more information.