"use client";

/**
 * Whether the transcript panel open now was opened from the list on this
 * page, so closing it can go back one step (the list, where the scholar was)
 * rather than add a new entry. A panel reached by a shared link, or by
 * reloading one, has nothing behind it to go back to, and closes by replacing
 * the address instead. Module state on purpose: it lives exactly as long as
 * the page does, and a reload forgets it, which is the point.
 */
export const transcriptNav = { fromList: false };
