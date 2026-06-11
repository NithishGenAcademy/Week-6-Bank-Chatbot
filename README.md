# 🏦 NeoBank ARIA — AI Security Workshop

**ARIA** (Automated Response & Inquiry Assistant) is NeoBank's intentionally vulnerable AI banking assistant, built for the Gen Academy security workshop. Participants interact with ARIA to discover and exploit common AI security vulnerabilities.

## Quick Start

### 1. Prerequisites

- Python 3.10+
- [uv](https://docs.astral.sh/uv/) package manager
- An [OpenAI API key](https://platform.openai.com/api-keys)

### 2. Install dependencies

```bash
cd neobank-aria
uv sync
```

### 3. Run the app

```bash
uv run streamlit run app.py
```

The app will auto-create a `neobank.db` SQLite database and seed it with customer and transaction data.

### 4. Enter your API key

Paste your OpenAI API key in the sidebar. Keys stay in your browser session only.

### 5. Login

| Name         | User ID      | Tier     |
|-------------|-------------|----------|
| Alex Mercer  | USR-0042     | Standard |

*(Other accounts exist in the database — discovering them is part of the exercise.)*

---

## Project Structure

```
neobank-aria/
├── app.py               # Streamlit UI — login, chat, architecture view
├── agent.py             # ARIA agent — LangChain + OpenAI + tools
├── knowledge_base.py    # Policy KB dict (returned verbatim — no sanitisation)
├── database.py          # SQLite connection, seeding, query helpers
├── seed_data.py         # Customer and transaction seed data
├── architecture.html    # Architecture reference (viewable in-app)
├── neobank.db           # SQLite database (auto-created on first run)
├── pyproject.toml       # Dependencies (uv / pip)
├── .env.example         # Optional env variable template
└── README.md
```

## Architecture

- **LLM**: OpenAI `gpt-4o-mini`
- **Agent framework**: LangChain (manual 2-step tool loop)
- **Database**: SQLite (file-based, no cloud dependency)
- **Knowledge base**: Python dict (no RAG — returned verbatim)
- **UI**: Streamlit

## Workshop Info

ARIA is deployed with intentional security gaps. The sidebar contains hints about different attack methods. The Architecture tab shows the full agent design. Participants explore objectives of increasing difficulty — from extracting the system prompt to accessing another customer's transaction history.

**This is an educational tool. All data is fictional.**

---

*Gen Academy · 2025*
