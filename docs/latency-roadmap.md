# Latency And Smoothness Roadmap

Current build:

- Question generation and scoring run locally in the browser.
- The game does not call the backend during the 60-second sprint.
- Supabase is only called after a run ends and when the leaderboard loads.
- The API routes return a playable offline state when Supabase env vars are missing.

Next paths:

1. Move leaderboard reads to the nearest edge cache with short TTL and stale-while-revalidate.
2. Write attempts through a queue or fire-and-forget endpoint so the result screen never waits on persistence.
3. Precompute daily top lists in Postgres with a materialized view or scheduled function.
4. Add a lightweight local ghost score before global leaderboard data arrives.
5. Keep all game state in a reducer and isolate rendering so timer ticks do not re-render leaderboard/feed panels.
6. Add client-side audio/haptic feedback with user opt-in and preloaded assets.
7. Use Vercel analytics and Supabase query plans to track p95 route latency by region.
8. For multiplayer later, use regional matchmaking, server-authoritative rounds, and delta-only realtime payloads.
