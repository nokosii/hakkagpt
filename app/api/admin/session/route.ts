import {
  adminStatus,
  clearAdminCookie,
  createAdminCookie,
  isAdminRequest,
  verifyAdminPassword,
} from "@/lib/admin-auth";

export const runtime = "edge";

export async function GET(request: Request) {
  return Response.json({
    authenticated: await isAdminRequest(request),
    configured: adminStatus().configured,
  });
}

export async function POST(request: Request) {
  if (!adminStatus().configured) {
    return Response.json({ error: "請先在 Render 設定 ADMIN 秘密環境變數" }, { status: 503 });
  }
  const body = (await request.json().catch(() => ({}))) as { password?: string };
  if (!(await verifyAdminPassword(String(body.password || "")))) {
    return Response.json({ error: "管理者密碼不正確" }, { status: 401 });
  }
  return Response.json(
    { authenticated: true },
    { headers: { "Set-Cookie": await createAdminCookie(request) } },
  );
}

export async function DELETE(request: Request) {
  return Response.json(
    { authenticated: false },
    { headers: { "Set-Cookie": clearAdminCookie(request) } },
  );
}
