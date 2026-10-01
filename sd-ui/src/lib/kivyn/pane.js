/**
 * Whether Kivyn's pane beside a story is open, as this browser last left it.
 *
 * The pane opens by default on a wide screen: the editor beside Kivyn is the
 * page as it is meant to look. A scholar who closes it has said they want
 * the page to themselves, and that is remembered until they open it again.
 * A cookie rather than local storage, so the server renders the page the way
 * it was left and the pane never opens on arrival only to slide shut.
 * Not a secret, so readable by the page; a year, then the default again.
 */

export const KIVYN_PANE_COOKIE = "kivyn_pane";
const YEAR_SECONDS = 60 * 60 * 24 * 365;

/** On the server: whether the scholar closed the pane last time. */
export function paneClosedIn(cookieStore) {
  return cookieStore?.get(KIVYN_PANE_COOKIE)?.value === "closed";
}

/** In the browser: remember the pane open or closed. */
export function rememberPane(open) {
  try {
    document.cookie = `${KIVYN_PANE_COOKIE}=${open ? "open" : "closed"}; path=/; max-age=${YEAR_SECONDS}; samesite=lax`;
  } catch {
    /* No cookies here: the pane simply opens by default next time. */
  }
}
