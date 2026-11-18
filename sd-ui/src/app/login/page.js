import { redirect } from "next/navigation";

import AuthShell from "@/components/auth/AuthShell";
import LoginForm from "@/components/auth/LoginForm";
import { getServerSession } from "@/lib/auth";
import { BRAND_NAME, CONTACT_EMAIL, PRODUCT_NAME, PUBLIC_SITE_URL } from "@/lib/brand";

export const metadata = {
  title: `Sign in · ${BRAND_NAME} ${PRODUCT_NAME}`,
  description: `Sign in to ${PRODUCT_NAME}`,
};

export default async function LoginPage({ searchParams }) {
  const session = await getServerSession();
  const resolvedSearchParams = await searchParams;
  const nextPath =
    typeof resolvedSearchParams?.next === "string" &&
    resolvedSearchParams.next.startsWith("/") &&
    !resolvedSearchParams.next.startsWith("//")
      ? resolvedSearchParams.next
      : "/";

  if (session?.authenticated) {
    redirect(nextPath);
  }

  /* The public site's researcher sign-in, word for word: a scholar meets the
     same page whichever door they use. */
  return (
    <AuthShell
      title={PRODUCT_NAME}
      description="Sign in with the scholar account your invitation set up."
      footnote={
        <>
          Not a researcher? Learners, families and educators{" "}
          <a href={`${PUBLIC_SITE_URL}/auth/login`}>sign in here</a>.
          <br />
          Forgot your password? Write to {CONTACT_EMAIL}.
        </>
      }
    >
      <LoginForm nextPath={nextPath} />
    </AuthShell>
  );
}
