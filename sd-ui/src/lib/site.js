export function getSiteUrl() {
  const value =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.SITE_URL ||
    "http://localhost:3003";

  return value.replace(/\/+$/, "");
}
