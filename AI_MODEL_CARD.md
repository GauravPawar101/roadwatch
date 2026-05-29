# RoadWatch AI Model Card

This document describes the AI-assisted features used by RoadWatch and the operational constraints around them.

## Overview

RoadWatch uses AI to help citizens draft complaints, guide RTI requests, summarize escalation paths, and assist authorities with workflow-oriented summaries. The primary AI entry point is the gateway API, which orchestrates prompts and tool calls for role-aware experiences.

## Intended use

- Drafting citizen complaints from plain-language input.
- Suggesting RTI language and escalation summaries.
- Summarizing authority queues, SLA status, and jurisdiction reports.
- Supporting chat-based assistance in the web and mobile experiences.

## Not intended use

- Final legal advice or authoritative compliance decisions.
- Fully automated enforcement actions without human review.
- Decisions that require certainty beyond the available source data.

## Model routing

RoadWatch is designed to work with a primary hosted model and local or self-hosted fallbacks when available.

- Primary: Gemini via the gateway API configuration.
- Fallbacks: Ollama or llama.cpp-compatible endpoints.
- Prompt behavior is controlled through the shared prompt modules under `core/prompts/`.

## Input data

The system may use the following categories of input:

- Complaint text and complaint metadata.
- Road, district, and authority context.
- Public analytics outputs and workflow state.
- User role and locale context where relevant.

Sensitive personal data should be minimized and only included when needed for the request.

## Output expectations

AI responses should be concise, action-oriented, and grounded in the available record. For workflows that return structured data, the output should remain valid JSON or a clearly documented schema.

## Risks and limitations

- AI output can be incomplete or incorrect when source data is missing.
- Summaries may omit nuance from the original complaint or legal text.
- The system should not invent identifiers, dates, or legal obligations.
- Human review is required for actions with operational or legal impact.

## Safety and governance

- Keep prompt instructions in the shared prompt modules rather than in ad hoc call sites.
- Route sensitive actions through the existing role-based workflows.
- Avoid returning secrets, private keys, or internal credentials in AI output.
- Treat AI-generated guidance as assistive, not authoritative.

## Monitoring

Operational monitoring should track:

- Request volume and latency.
- Fallback usage across model providers.
- Error rates by endpoint and prompt type.
- Human override or rejection rates where applicable.

## Related files

- [docs/services/gateway-api/README.md](./docs/services/gateway-api/README.md)
- [core/prompts/system/roadwatch-agent.ts](./core/prompts/system/roadwatch-agent.ts)
- [core/prompts/citizen/complaint-filing.ts](./core/prompts/citizen/complaint-filing.ts)
- [core/prompts/citizen/rti-guidance.ts](./core/prompts/citizen/rti-guidance.ts)
- [core/prompts/authority/sla-analysis.ts](./core/prompts/authority/sla-analysis.ts)
