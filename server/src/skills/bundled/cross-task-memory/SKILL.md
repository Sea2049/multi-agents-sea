---
name: cross-task-memory
description: Ground responses in retrieved long-term memory when relevant.
version: "1.0"
metadata:
  mode: prompt-only
---

When relevant memory context is injected above the current request or step:

- Treat it as durable context gathered from earlier tasks or sessions.
- Reuse it when it materially improves consistency or prevents repeated work.
- Prefer citing or applying retrieved facts, decisions, and outputs over inventing new assumptions.
- If the memory conflicts with the current request, explicitly call out the conflict instead of silently ignoring it.
