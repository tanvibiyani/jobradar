import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

/**
 * Supabase client for Server Components, Server Actions, and Route Handlers.
 *
 * Each `getAll` / `setAll` invocation calls `cookies()` again rather than
 * closing over a snapshot. `cookies()` is request-scoped and cached by Next,
 * so re-reading is cheap — but it guarantees we see any cookies the proxy
 * (`lib/supabase/middleware.ts`) wrote on this request before the action body
 * started running.
 *
 * `setAll` is allowed to throw in a Server Component (cookies are read-only
 * there) and we log + ignore. In a Server Action or Route Handler a throw
 * would mean the refreshed access token never made it into cookies, which
 * silently breaks the next `getSession()` and any `.from()` call after it
 * (PostgREST would see the anon key, `auth.uid()` returns NULL, RLS fails).
 * We log loudly so that failure is visible instead of silent.
 */
export async function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in environment.",
    );
  }

  return createServerClient(url, anonKey, {
    cookies: {
      async getAll() {
        const store = await cookies();
        return store.getAll();
      },
      async setAll(cookiesToSet) {
        try {
          const store = await cookies();
          for (const { name, value, options } of cookiesToSet) {
            store.set(name, value, options);
          }
        } catch (err) {
          console.warn(
            "[supabase/server] setAll could not write cookies. " +
              "Expected in a Server Component (the proxy refreshes the session); " +
              "in a Server Action or Route Handler this means the refreshed " +
              "token was lost and the next PostgREST call will fall back to the anon key.",
            err,
          );
        }
      },
    },
  });
}

/**
 * Service-role client. Server-only. Never expose to the browser. Does not
 * read or write auth cookies — it must not, since the service role bypasses
 * RLS by design.
 */
export async function createServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.",
    );
  }

  return createServerClient(url, serviceRoleKey, {
    cookies: {
      getAll() {
        return [];
      },
      setAll() {
        // Service-role client must never write auth cookies.
      },
    },
  });
}
