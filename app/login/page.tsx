import Link from "next/link";
import { LoginForm } from "./login-form";

type SearchParams = Promise<{ next?: string }>;

export default async function LoginPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { next } = await searchParams;
  const safeNext = next && next.startsWith("/") ? next : "/dashboard";

  return (
    <main className="mx-auto flex max-w-sm flex-1 flex-col justify-center px-6 py-16 font-sans">
      <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        Welcome back to jobradar.
      </p>

      <div className="mt-8">
        <LoginForm next={safeNext} />
      </div>

      <p className="mt-6 text-sm text-zinc-600 dark:text-zinc-400">
        Don&apos;t have an account?{" "}
        <Link href="/signup" className="font-medium underline">
          Create one
        </Link>
        .
      </p>
    </main>
  );
}
