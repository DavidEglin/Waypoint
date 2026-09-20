# Waypoint

One study folder per assessment. See `waypoint-build-brief.md` for the plan and decisions.

Status: **M2 (add and read)** on top of M1 (skeleton).
- M1: sign-in, sessions, admin users, encrypted Canvas/Claude connections, Night Study theme, Settings.
- M2: add a notification from Canvas or by uploading a photo / PDF / Word file; Waypoint reads it with Claude (your own key) into an assessment with parts and due dates, weighting, AI-use rules and topics, and shows it for checking. Editing and confirming (M3) is not built yet.

## Layout
- `shared/` API types and validation (zod), used by both sides
- `server/` Fastify + SQLite (better-sqlite3), argon2id passwords, AES-256-GCM for stored credentials
- `client/` React + Vite

Requires Node 22+.

## Develop
```sh
npm install
export ENCRYPTION_KEY=$(openssl rand -base64 32)   # keep it: losing it makes saved keys unreadable
export ALLOWED_HOST=localhost:5173 COOKIE_SECURE=false DATA_DIR=./data
export ADMIN_USERNAME=you ADMIN_PASSWORD='a-temporary-password-12+'
npm run dev:server        # terminal 1, port 3000
npm run dev:client        # terminal 2, open http://localhost:5173
```
The first admin is created on first start and must change the password at first sign-in.

## Test and build
```sh
npm test            # server tests (auth, admin, encryption, host lock, connections)
npm run typecheck
npm run build
```

## Run the build
Model and time zone are set with `CLAUDE_MODEL` (default `claude-opus-5`) and `TIMEZONE` (default `Australia/Sydney`).

`CLIENT_DIR=client/dist npm start` serves the API and the built client on `PORT`. See `.env.example` for every setting.
The app only answers to the exact `ALLOWED_HOST` and serves plain HTTP; HTTPS and the tunnel are yours to configure. There is no Docker or deploy script in this repo.
