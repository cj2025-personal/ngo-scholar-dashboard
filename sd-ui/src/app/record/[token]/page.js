import ImpactRecordView from "@/components/impact/ImpactRecordView";
import { readSharedRecord } from "@/lib/impactShared";

/**
 * A scholar's impact record, opened from a link they shared. Public: the
 * link is the scholar's to give and to turn off, and its token is what the
 * API checks. The record is read as it stands now, and its signature is
 * checked here against the deployment's published key. Never cached, never
 * indexed.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Impact record · Proj Arch",
  robots: { index: false, follow: false },
};

const day = (iso) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });

export default async function SharedRecordPage({ params }) {
  const { token } = await params;
  const read = await readSharedRecord(token);

  if (read.status !== "ok") {
    return (
      <main className="auth-shell">
        <div className="auth-card auth-card--single">
          <h1 className="auth-card__title">{read.status === "gone" ? "This link is not open" : "The record could not be read"}</h1>
          <p className="auth-card__lede">
            {read.status === "gone" ? "The scholar turned it off, or it never existed. Ask them for a new one." : read.message}
          </p>
        </div>
      </main>
    );
  }

  const { record, signature, keyId } = read.issued;
  return (
    <main className="imp-public">
      <header className="imp-public__head">
        <p className="dash-date">Impact record · Proj Arch</p>
        <h1 className="dash-greet">{record.scholar.name || "A scholar"}</h1>
        <p className={`imp-check ${read.check.valid ? "is-valid" : "is-invalid"}`} role="status">
          {read.check.valid
            ? `Signature checks out: issued by Proj Arch on ${day(record.issued_at)} and not changed since.`
            : `The signature could not be confirmed. ${read.check.reason}`}
        </p>
      </header>
      <div className="dash-card imp-card">
        <ImpactRecordView record={record} />
      </div>
      <details className="imp-verify">
        <summary>Check it yourself</summary>
        <p>
          The record below is signed with Ed25519 over its canonical JSON (keys sorted, no spaces). The public key is published at{" "}
          <a href={read.keyUrl}>{read.keyUrl}</a> (key {keyId}).
        </p>
        <pre className="imp-verify__json">{JSON.stringify({ record, signature, key_id: keyId }, null, 2)}</pre>
      </details>
    </main>
  );
}
