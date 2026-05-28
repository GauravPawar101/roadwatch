**Service: authority-portal**

Summary
- Language/runtime: React + Vite (TypeScript where applicable).
- Purpose: web UI for authorities to view reports, maps, and analytics.

Why these choices
- **React + Vite**: fast dev feedback with HMR, large UI ecosystem (Leaflet, Recharts). Aligns with frontend tooling in repository.

Pros
- Rapid UX iteration and broad developer availability.

Cons / Tradeoffs
- Web UI complexity increases with richer interactions; testing and accessibility require dedicated effort.

Files of interest
- `apps/authority-portal/package.json` — lists React, Leaflet, Recharts.

Recommendation / Alternatives
- For highly interactive mapping use-cases, consider specialized mapping backends or vector tile services to offload client work.

Tradeoffs summary: React + Vite chosen for DX and speed, trading complexity when scaling client responsibilities.
