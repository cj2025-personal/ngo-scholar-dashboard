import Link from "next/link";

import ClaimForm from "@/components/auth/ClaimForm";
import { describeInvite } from "@/lib/invites";

export const metadata = {
  title: "Claim your Archivyn account",
  description: "Set up your scholar account on Archivyn",
};

/**
 * Never cached, and never prerendered.
 *
 * The page's whole content depends on a one-time token whose state changes the
 * moment anyone redeems it. A cached page would show a working password form
 * for an invitation that is already spent.
 */
export const dynamic = "force-dynamic";

export default async function ClaimPage({ params }) {
  const { token } = await params;
  const invite = await describeInvite(token);

  if (!invite?.ok) {
    return (
      <main className="auth-shell">
        <div className="auth-card auth-card--single">
          <h1 className="auth-card__title">This invitation can&rsquo;t be used</h1>
          <p className="auth-card__lede">{invite?.message}</p>

          {/* An expired or spent link is usually someone who already has an
              account, or who needs a new invitation. Both next steps are named,
              because a dead end here means an email to support. */}
          <p className="auth-card__lede">
            {invite?.reason === "already_redeemed" ? (
              <>
                If that was you, <Link href="/login">sign in instead</Link>.
              </>
            ) : (
              <>
                Ask the Archivyn team for a new invitation, or{" "}
                <Link href="/login">sign in</Link> if you already have an account.
              </>
            )}
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="auth-shell">
      {/* Shown before the password field, not after. A person is about to take
          control of a public record about a named individual, and they should
          be able to see WHOSE before they commit — an invitation sent to the
          wrong address should be obvious to the wrong recipient. */}
      <div className="auth-card auth-card--single auth-card--identity">
        <p className="auth-card__eyebrow">Archivyn scholar account</p>
        <h2 className="auth-card__identity-name">{invite.scholarName}</h2>
        {invite.institution ? (
          <p className="auth-card__identity-meta">{invite.institution}</p>
        ) : null}
        <p className="auth-card__lede">
          If this isn&rsquo;t you, don&rsquo;t continue — tell the Archivyn team
          so the invitation can be withdrawn.
        </p>
      </div>

      <ClaimForm token={token} scholarName={invite.scholarName} />
    </main>
  );
}
