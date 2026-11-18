import Link from "next/link";

import AuthShell from "@/components/auth/AuthShell";
import ClaimForm from "@/components/auth/ClaimForm";
import { BRAND_NAME, CONTACT_EMAIL, PRODUCT_NAME } from "@/lib/brand";
import { describeInvite } from "@/lib/invites";

export const metadata = {
  title: `Claim your ${BRAND_NAME} account`,
  description: `Set up your scholar account on ${BRAND_NAME}`,
};

/**
 * Never cached, and never prerendered.
 *
 * The page's whole content depends on a one-time token whose state changes the
 * moment anyone redeems it. A cached page would show a working password form
 * for an invitation that is already spent.
 */
export const dynamic = "force-dynamic";

const footnote = <>Questions about this invitation? Write to {CONTACT_EMAIL}.</>;

export default async function ClaimPage({ params }) {
  const { token } = await params;
  const invite = await describeInvite(token);

  if (!invite?.ok) {
    return (
      <AuthShell title="This invitation can’t be used" description={invite?.message} footnote={footnote}>
        {/* An expired or spent link is usually someone who already has an
            account, or who needs a new invitation. Both next steps are named,
            because a dead end here means an email to support. */}
        <p className="authshell-switch">
          {invite?.reason === "already_redeemed" ? (
            <>
              If that was you, <Link href="/login">sign in instead</Link>.
            </>
          ) : (
            <>
              Ask the {BRAND_NAME} team for a new invitation, or <Link href="/login">sign in</Link> if you already
              have an account.
            </>
          )}
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      eyebrow={`${PRODUCT_NAME} invitation`}
      title="Set your password"
      description="Check the profile below is yours, then choose the password you’ll sign in with."
      footnote={footnote}
    >
      {/* Shown before the password field, not after. A person is about to take
          control of a public record about a named individual, and they should
          be able to see WHOSE before they commit — an invitation sent to the
          wrong address should be obvious to the wrong recipient. */}
      <div className="authshell-identity">
        <span className="authshell-identity-label">{BRAND_NAME} scholar account</span>
        <h2 className="authshell-identity-name">{invite.scholarName}</h2>
        {invite.institution ? <p className="authshell-identity-meta">{invite.institution}</p> : null}
        <p className="authshell-identity-note">
          If this isn&rsquo;t you, don&rsquo;t continue — tell the {BRAND_NAME} team so the invitation can be
          withdrawn.
        </p>
      </div>

      <ClaimForm token={token} />
    </AuthShell>
  );
}
