# Aries AI

A fast, token-efficient streaming AI chatbot featuring a custom **HTML / CSS / JavaScript** web UI backed by **FastAPI** and the official **Groq Python SDK** (`qwen/qwen3.8-27b`).

## Project Structure

```text
.
├── app.py
├── static/
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── requirements.txt
├── .env.example
├── .env
├── .gitignore
└── README.md
```

## Setup

1. Install dependencies:

```bash
pip install -r requirements.txt
```

2. Add your Groq API key to `.env` (see `.env.example`):

```env
GROQ_API_KEY=your_groq_api_key_here
```

## Run

```bash
python3 app.py
```

Open `http://127.0.0.1:7860` in your browser.
