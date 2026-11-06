import "server-only";

import crypto from "crypto";

/**
 * A shared impact record, read on the server for the public page
 * (/record/[token]), and its signature checked here: the record's canonical
 * bytes (keys sorted, no whitespace - the same form the API signs, sd-api
 * lib/evidenceLedger canonicalJson) against the deployment's published public
 * key. The check does not ask the API whether its own record is good.
 */
const API_URL = process.env.AUTH_API_URL || process.env.NEXT_PUBLIC_AUTH_API_URL || "http://localhost:4000";

export function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value === undefined ? null : value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
}

/** { valid, reason } for a record and signature against a PEM public key. */
export function checkSignature(record, signature, publicKeyPem) {
  if (!signature || !publicKeyPem) return { valid: false, reason: "It was not signed." };
  try {
    const ok = crypto.verify(null, Buffer.from(canonicalJson(record), "utf8"), crypto.createPublicKey(publicKeyPem), Buffer.from(String(signature), "base64"));
    return ok ? { valid: true, reason: null } : { valid: false, reason: "The signature does not match the record." };
  } catch (error) {
    return { valid: false, reason: `It could not be checked: ${error.message}` };
  }
}

/**
 * The record behind a share link, with whether its signature checks out.
 * { status: "ok", issued, check, keyUrl } | { status: "gone" } | { status: "unavailable", message }
 */
export async function readSharedRecord(token) {
  const keyUrl = `${API_URL}/api/editorial-stories/public/evidence/key`;
  let response;
  try {
    response = await fetch(`${API_URL}/api/impact/shared/${encodeURIComponent(token)}`, { cache: "no-store" });
  } catch {
    return { status: "unavailable", message: "Proj Arch could not be reached just now." };
  }
  if (response.status === 404) return { status: "gone" };
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    return { status: "unavailable", message: body?.error || body?.message || "The record could not be read just now." };
  }
  const issued = await response.json();
  const key = await fetch(keyUrl, { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  const check =
    key?.publicKey && (!issued.record?.key_id || issued.record.key_id === key.keyId)
      ? checkSignature(issued.record, issued.signature, key.publicKey)
      : { valid: false, reason: key ? "It was signed with a key this deployment does not publish." : "The public key could not be read." };
  return { status: "ok", issued, check, keyUrl };
}
