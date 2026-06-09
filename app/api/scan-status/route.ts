import { createClient } from "@/lib/supabase/server";
import { SCAN_RUN_COLUMNS } from "@/app/(app)/jobs/scan-types";

// Always run at request time (reads auth cookies + DB); never cached.
export const dynamic = "force-dynamic";

/**
 * Latest scan_runs row for the signed-in user. The Jobs page polls this every
 * 5s while a scan is running to detect completion. RLS scopes the row to the
 * caller, so no user_id filter is needed here.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ scan: null }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("scan_runs")
    .select(SCAN_RUN_COLUMNS)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return Response.json({ scan: null, error: error.message }, { status: 500 });
  }

  return Response.json({ scan: data ?? null });
}
