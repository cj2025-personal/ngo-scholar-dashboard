/**
 * Learning circles, from the browser: the scholar's own, through this
 * studio's API (/api/circles), which asks the learner app where they live.
 * Every call answers { ok, data, error }.
 */
const AUTH_API_URL = process.env.NEXT_PUBLIC_AUTH_API_URL || "http://localhost:4000";
const UNREACHABLE = "Proj Arch could not be reached. Check your connection and try again.";

async function request(path, init = {}) {
  let response;
  try {
    response = await fetch(`${AUTH_API_URL}${path}`, {
      credentials: "include",
      cache: "no-store",
      ...init,
      headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.headers || {}) },
    });
  } catch {
    return { ok: false, data: null, error: UNREACHABLE };
  }
  let data = null;
  try {
    data = await response.json();
  } catch {
    /* An error with no JSON body is still an error. */
  }
  if (!response.ok) return { ok: false, data: null, error: data?.error || data?.message || `Request failed (${response.status}).` };
  return { ok: true, data, error: null };
}

/** The reading ages a circle can be for, as the studio names them. */
export const CIRCLE_BANDS = [
  { value: "ages_8_11", label: "Ages 8–11" },
  { value: "ages_12_14", label: "Ages 12–14" },
  { value: "ages_15_18", label: "Ages 15–18" },
  { value: "adults", label: "Adults" },
];
export const bandLabel = (value) => CIRCLE_BANDS.find((b) => b.value === value)?.label ?? value;

/** What a finding from the text check means, in the scholar's words. */
export const FINDING_WORDS = {
  contact_outside: "asks learners to contact you or someone outside Proj Arch",
  personal_information: "asks learners for something about themselves",
  promotion: "sells, advertises or asks for money",
  too_mature: "is too mature for the youngest readers",
  unkind: "could hurt or shut out a group of people",
  misleading: "says the circle is something it is not",
  unclear: "young readers could not tell what it is about",
};

export const listCircles = () => request("/api/circles");
export const getCircle = (id) => request(`/api/circles/${encodeURIComponent(id)}`);
export const createCircle = (input) => request("/api/circles", { method: "POST", body: JSON.stringify(input) });
export const updateCircle = (id, input) => request(`/api/circles/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) });
export const archiveCircle = (id, archived) => request(`/api/circles/${encodeURIComponent(id)}/archive`, { method: "POST", body: JSON.stringify({ archived }) });
export const changeCircleCode = (id, change) => request(`/api/circles/${encodeURIComponent(id)}/code`, { method: "POST", body: JSON.stringify(change) });

/** The scholar's published stories, the ones a circle may feature. */
export async function listPublishedStories() {
  const result = await request("/api/editorial-stories?status=published&limit=100");
  if (!result.ok) return result;
  const stories = (result.data?.stories || []).filter((s) => s.status === "published").map((s) => ({ id: s.id, title: s.title || "Untitled story" }));
  return { ok: true, data: stories, error: null };
}
