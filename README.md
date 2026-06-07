This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev -- -p 3004
```

Open [http://localhost:3004](http://localhost:3004) with your browser to see the result.
The deployed app URL is `https://jobs.tbiyani.com`.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

## Supabase setup

The app uses [`@supabase/ssr`](https://www.npmjs.com/package/@supabase/ssr) on top
of `@supabase/supabase-js` so that the same project works on the server
(Server Components, Route Handlers, Server Actions) and in the browser.

### 1. Required environment variables

Add these to `.env.local` at the repo root (this file is gitignored — never
commit it, and never paste its contents into chat, PRs, or logs):

| Variable                        | Where it is used                                  | Notes                                                              |
| ------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`      | Browser + server client                           | Project URL from the Supabase dashboard. Public.                   |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser + server client                           | `anon` public key. Safe to embed in the client bundle.             |
| `SUPABASE_SERVICE_ROLE_KEY`     | `createServiceRoleClient()` only (server)         | **Secret.** Bypasses RLS. Never expose to the browser or to logs.  |
| `APP_URL`                       | Server-side redirects / email links               | `https://jobs.tbiyani.com` in production.                          |

Find the URL and keys under **Project Settings → API** in your Supabase
dashboard.

### 2. Where the clients live

- `lib/supabase/client.ts` — `createClient()` for Client Components. Uses
  `createBrowserClient` from `@supabase/ssr` and reads the `NEXT_PUBLIC_*`
  vars at call time.
- `lib/supabase/server.ts` — `createClient()` for Server Components, Route
  Handlers, and Server Actions. Uses `createServerClient` with Next.js'
  async `cookies()` API so auth tokens can be refreshed on each request.
  Also exports `createServiceRoleClient()` for trusted server-only code.

Usage:

```ts
// Client Component
"use client";
import { createClient } from "@/lib/supabase/client";
const supabase = createClient();

// Server Component / Route Handler / Server Action
import { createClient } from "@/lib/supabase/server";
const supabase = await createClient();
```

### 3. Verifying the integration

Start the dev server on the project's port and visit the test page:

```bash
npm run dev -- -p 3004
# then open http://localhost:3004/supabase-test
```

`/supabase-test` is a Server Component that:

- reports whether each required env var is **set** or **missing** (it never
  prints the values themselves), and
- calls `supabase.auth.getSession()` to confirm the server client can be
  constructed against your project.

If any variable shows as **missing**, restart the dev server after editing
`.env.local` — Next.js only reads it at process start.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
