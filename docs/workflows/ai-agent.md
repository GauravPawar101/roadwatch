# AI Agent

LangGraph-based conversational agent for citizen guidance, accessible via web and mobile.

## Endpoints

### Server-side (recommended for production)

```
POST /public/agent/chat
Content-Type: application/json

{
  "input": "How do I file a complaint about a pothole?",
  "system": "optional custom system prompt"
}
```

Implemented in `apps/gateway-api` using a LangGraph pipeline.

### Mobile on-device

The mobile app (`@roadwatch/feature-agent`) can call Gemini directly via `GEMINI_API_KEY` in the app env. Restrict this key in production.

## LLM provider chain

The gateway tries providers in order defined by `LLM_FALLBACK_ORDER` (default: `gemini,ollama,llamacpp`):

| Provider | Env vars | Notes |
|----------|----------|-------|
| **Gemini** | `GEMINI_API_KEY`, `GEMINI_MODEL` | Primary; REST API |
| **Ollama** | `OLLAMA_BASE_URL`, `OLLAMA_MODEL` | Local fallback |
| **llama.cpp** | `LLAMACPP_BASE_URL`, `LLAMACPP_MODEL` | OpenAI-compatible server |

If one provider fails, the pipeline automatically tries the next.

## Agent capabilities

- Answer questions about filing complaints
- Explain complaint categories and severity levels
- Guide through the complaint wizard steps
- Provide RTI information
- General road infrastructure knowledge (India context)

## Mobile agent memory

The mobile app stores conversation history in encrypted SQLite (`@roadwatch/storage-sqlite`) for context across sessions. This data stays on-device.

## Prompt testing

```powershell
pnpm test:prompts
```

Runs `tools/prompt-tests/run.ts` — regression tests for agent prompt responses.

## Security

| Concern | Mitigation |
|---------|------------|
| API key in mobile bundle | Restrict by app fingerprint in Google Cloud Console |
| Prompt injection | System prompt boundaries, input sanitization |
| PII in prompts | Agent does not access user PII directly |
| Rate limiting | Gateway rate limits on `/public/agent/chat` |

## Related docs

- [Gateway API](../services/gateway-api.md)
- [Mobile host](../services/mobile-host.md)
- [Environment variables](../getting-started/environment-variables.md)
