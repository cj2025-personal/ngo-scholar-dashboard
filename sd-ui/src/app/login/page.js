import { redirect } from "next/navigation";

import LoginForm from "@/components/auth/LoginForm";
import { getServerSession } from "@/lib/auth";

export const metadata = {
  title: "Scholar Login",
  description: "Sign in to the Scholar Dashboard",
};

export default async function LoginPage({ searchParams }) {
  const session = await getServerSession();
  const resolvedSearchParams = await searchParams;
  const nextPath =
    typeof resolvedSearchParams?.next === "string" &&
    resolvedSearchParams.next.startsWith("/")
      ? resolvedSearchParams.next
      : "/";

  if (session?.authenticated) {
    redirect(nextPath);
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="auth-copy">
          <span className="auth-kicker">Archivyn</span>
          <h1>Scholar sign in</h1>
          <p>
            Use your scholar credentials to access the dashboard. Authentication
            is handled through a secure cookie-backed session.
          </p>
        </div>

        <LoginForm nextPath={nextPath} />
      </section>
    </main>
  );
}
