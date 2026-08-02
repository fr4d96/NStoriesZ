# WHV Compass NZ

A public platform for detailed, written first-person stories from Working Holiday Visa travellers
in New Zealand. See [docs/product-spec.md](docs/product-spec.md) for what this is and isn't.

Start with [CLAUDE.md](CLAUDE.md) — product context, engineering rules, commands, and the
Definition of Done — and [docs/implementation-status.md](docs/implementation-status.md) for what's
actually built versus planned.

## Getting started

```bash
cp .env.example .env.local   # fill in a Supabase development project's values
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

See [docs/architecture.md](docs/architecture.md) for the full application, auth, and database
workflow, including the local-vs-hosted Supabase development setup.
