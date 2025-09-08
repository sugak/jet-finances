# Jet Finances (MVP Skeleton)

## Dev

1. `cp .env.example .env` and fill Supabase keys.
2. `npm i`
3. `npm run dev`

Open http://localhost:3000

## Security & Notes

- Helmet (CSP), CSRF (cookie), Rate limiting included.
- Supabase Admin client is server-only; do NOT expose SERVICE_ROLE to the browser.
- Pages are static stubs; wire Supabase when schema is ready.
