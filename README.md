# OmniMind-AI

A unified chat platform that intelligently routes queries across multiple LLM providers (Google Gemini, Groq, DeepSeek, OpenRouter) with cognitive memory integration and encrypted credential management.

## Features

- **Intelligent Model Routing** - Automatically selects the optimal LLM based on task type, cost, and performance
- **Knowledge Graph Memory** - Session-scoped entity extraction and relationship tracking via Neo4j
- **Multi-Provider Support** - Gemini, Groq, DeepSeek, and OpenRouter in a single interface
- **Document Parsing** - Upload and analyze PDFs, DOCX, PPTX, XLSX, CSV, and images
- **Web Search RAG** - Real-time web search with query rewriting
- **Streaming Responses** - Real-time AI responses with SSE
- **Encrypted Credentials** - AES-256 encrypted API key storage
- **Analytics Dashboard** - Track usage, costs, and model distribution
- **3D Visualizations** - Interactive neural network and memory graph canvases

## Tech Stack

**Backend:** FastAPI, Python, Neo4j, SQLite, Supabase  
**Frontend:** Next.js 16, React 19, TypeScript, TailwindCSS 4, Clerk Auth, Three.js

## Project Structure

```
OmniMind-AI/
├── backend/
│   ├── app/
│   │   ├── api/           # REST API route handlers
│   │   ├── core/          # Config, database, security, graph
│   │   ├── models/        # Pydantic schemas
│   │   ├── services/      # LLM routing, search, PDF, document parsing
│   │   └── main.py        # FastAPI entry point
│   ├── requirements.txt
│   ├── model_performance.json
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── app/           # Next.js App Router pages
│   │   ├── components/    # React components
│   │   └── lib/           # API client utilities
│   ├── package.json
│   └── .env.example
└── README.md
```

## Installation

### Backend

```bash
cd backend

# Create virtual environment
python -m venv venv
.\venv\Scripts\activate  # Windows

# Install dependencies
pip install -r requirements.txt

# Configure environment
copy .env.example .env
# Edit .env with your API keys

# Run server
py -0

```

### Frontend

```bash
cd frontend

# Install dependencies
npm install

# Configure environment
copy .env.example .env.local
# Edit .env.local with your Clerk keys

# Run development server
npm run dev
```

## Environment Variables

### Backend (.env)

| Variable | Description |
|----------|-------------|
| `PORT` | Server port (default: 8000) |
| `HOST` | Server host (default: 0.0.0.0) |
| `ENCRYPTION_KEY` | AES-256 Fernet key for credential encryption |
| `SUPABASE_URL` | Supabase PostgreSQL URL |
| `SUPABASE_KEY` | Supabase publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key |
| `CLERK_SECRET_KEY` | Clerk authentication secret |
| `NEO4J_URI` | Neo4j AuraDB connection URI |
| `NEO4J_USERNAME` | Neo4j username |
| `NEO4J_PASSWORD` | Neo4j password |

### Frontend (.env.local)

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk publishable key |
| `CLERK_SECRET_KEY` | Clerk secret key |
| `NEXT_PUBLIC_API_URL` | Backend API URL (default: http://localhost:8000) |

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/chat/` | GET | List user's chats |
| `/api/chat/create` | POST | Create new chat |
| `/api/chat/{id}/messages` | GET | Get chat messages |
| `/api/chat/{id}/message` | POST | Send message (SSE streaming) |
| `/api/chat/{id}/graph` | GET | Get session knowledge graph |
| `/api/chat/{id}/rename` | PUT | Rename session |
| `/api/chat/{id}/message/{msg_id}/pdf` | GET | Download message as PDF |
| `/api/chat/upload-document` | POST | Upload & parse document |
| `/api/stats/` | GET | Get user statistics |
| `/api/settings/` | GET | Get API key configuration |
| `/api/settings/save` | POST | Save API keys |
| `/api/settings/test` | POST | Test API key |
| `/api/users/init` | POST | Initialize user |
| `/api/users/me` | DELETE | Delete account |
| `/api/health` | GET | Health check |

## Model Routing

The system automatically classifies tasks into categories:

- **summarization** - Condensed responses
- **math_logic** - Mathematical and logical reasoning
- **architecture_coding** - Software architecture and code generation
- **general_creative** - Creative and general purpose tasks

Fallback chains ensure reliability when primary models fail.

## License

MIT