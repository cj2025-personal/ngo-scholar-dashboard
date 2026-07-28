import { requireServerSession } from "@/lib/auth";

export default async function ProtectedLayout({ children }) {
  // Server-side session validation (calls sd-api /api/auth/me). Redirects to
  // /login when there is no valid scholar session.
  await requireServerSession();

  return children;
}
