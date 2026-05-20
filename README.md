# SwiftMath Sprint

A single-player 60-second mental math sprint inspired by fast brain-training games. The active round is fully local for low latency; Supabase stores completed attempts and powers the leaderboard.

Production: https://matiks-sprint.vercel.app

## Getting Started

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Supabase

Create a Supabase project, then set these values in `.env.local` and Vercel:

```bash
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
```

Apply `supabase/migrations/20260520064849_create_sprint_attempts.sql` in the Supabase SQL editor or with the Supabase CLI.

With no Supabase env vars, the sprint remains playable and the API returns an offline leaderboard state.

## Vercel

`vercel.json` marks this as a Next.js project. The Supabase client is initialized lazily, so production builds do not require Supabase credentials at build time.

## Scripts

```bash
npm run dev
npm run lint
npm run typecheck
npm run build
```

## Notes

- `docs/latency-roadmap.md` lists future paths for lower latency and smoother UX.
- `docs/founder-email-draft.md` contains the unsent Matiks outreach draft and public contact notes.
