# The Archivyn logo

The logo as vector, in `public/brand/`. Every file is outlined, so it needs no font and looks the same in a browser, an email client that shows SVG, a PDF, Figma or Canva.

Regenerate with `npm run brand:logo` after `pip install fonttools uharfbuzz`. Do this only when the logo changes, and commit what it writes.

## Which file, where

| File | What it is | Use it for | Smallest |
|---|---|---|---|
| `archivyn-lockup.svg` | the mark, the wordmark and the tagline | sign-in screens, splash and empty states, footers, documents, decks, email headers | **96px tall** (the tagline's capitals are 8.5px there) |
| `archivyn-lockup-compact.svg` | the mark and the wordmark | interface chrome: the top bar (34px), sidebars, loaders | 20px tall |
| `archivyn-wordmark.svg` | the word alone | where the mark already appears nearby, or space is wide and short | 12px tall |
| `archivyn-mark.svg` | the A alone | app icons, favicons, avatars for Archivyn, tight squares | 16px tall |

Each file has an `-on-dark` twin for navy or photographic backgrounds. Don't place the light files on dark grounds: the navy half of the A disappears into navy.

Below the full lockup's minimum, use the compact lockup instead of shrinking the full one. A tagline too small to read is just noise.

## In code

```jsx
{/* A plain <img>: next/image has nothing to optimise in an SVG. */}
<img src="/brand/archivyn-lockup-compact.svg" alt="Archivyn" width={748.5} height={225.83} style={{ height: 34, width: "auto" }} />
```

- Set the height in CSS and the width to `auto`. The `width` and `height` attributes are the file's `viewBox`, so the space is reserved before the file loads.
- Use `alt="Archivyn"`. If the logo is a link home, name the link: `aria-label="Archivyn — home"`.

## Clear space and colour

- **Clear space:** keep at least the wordmark's cap height (the height of its "A") empty on every side.
- **Navy `#102A56`:** the wordmark.
- **Red `#D52B3F`:** the tagline.
- **On dark:** the wordmark is `#FFFFFF` and the tagline `#FF7A88`, which is 6.5:1 on `#0B1F44`.
- **The mark:** keeps the gradients of `public/archivyn-logo.svg`.
- **The crossbar** is a cut, not white paint, so the surface shows through it.
- These are the logo's colours. The interface's own tokens (`--ark-navy`, `--ark-red`) are close but separate, so don't recolour one to match the other.

## The type, for designers

| Text | Typeface | Weight | Tracking |
|---|---|---|---|
| Wordmark | Figtree | ExtraBold 800 | −1.5% |
| Tagline | Figtree | SemiBold 600 | +0.6% |

- **Licence:** Figtree is licensed under the SIL Open Font License 1.1 (`fonts/OFL.txt`), which allows commercial use, embedding and use in logos.
- **Getting it:** install it from Google Fonts. Figma has it built in.
- **Where it came from:** the logo was first set in Avenir in Canva. Avenir is commercial and can't ship in these files. Figtree is the open face with the same tells: the round dot on the i, the hooked tail of the y, the flat apex of the A and the open c.
- **Reuse the files, don't retype:** for logo use, take the SVGs (Canva accepts SVG uploads) rather than re-typing "Archivyn". The spacing in the files is tuned.

## Don't

- Re-type the wordmark in a live font.
- Stretch, rotate, outline or add effects.
- Recolour the mark.
- Put the tagline under the full lockup's minimum size.
- Rebuild the lockup by hand from the parts.

# Alyno's mark

Alyno is the scholar directory's AI. Its mark is the **kite in flight**, built only from parts of the A: the peak (navy left, red right) and its reflection with the colours swapped, meeting at the A's crossbar cut, tilted as if flying, with the A's point of light at its tip.

Regenerate with `npm run brand:alyno`. It imports `archivyn_logo.py`, so the gradients, the point of light, the wordmark's face, weight and tracking can't drift from Archivyn's.

## Which file, where

The files are in `public/brand/alyno/`, and the directory app keeps a copy in its own `public/brand/alyno/`.

| File | What it is | Use it for | Size |
|---|---|---|---|
| `alyno-mark.svg` | the kite, full colour | avatars, headers, app icons | 32px and up |
| `alyno-mark-small.svg` | no point of light, thicker cut | favicons, chat avatars, anything small | under 32px |
| `alyno-mark-mono-navy.svg`, `-white`, `-black` | one colour | embossing, stamps, tinted phone icons, single-ink print | any |
| `alyno-lockup.svg` | the kite and the word | introducing Alyno: sign-in, splash, decks, documents | 32px tall, so the kite keeps its point of light |

The colour files have an `-on-dark` twin. As with the A, the navy turns pale on dark grounds, and the point of light turns navy.

## One colour

In one colour the silhouette and the cut carry the mark, as they do for the A. The colour swap is not drawn as a gap: a vertical gap meeting the cut forms a Latin cross.

## Movement

- **Thinking:** while Alyno is working on a reply, the kite rises, settles and rests, about 1.6 seconds per cycle, until the reply starts.
- **At rest:** still. It never moves to decorate, only to show real work.
- **Reduced motion:** still, always, for anyone who asks for less motion.

## The line

Say it once, where Alyno introduces itself:

> A kite flies high, but its string keeps it tied to the ground. Every answer Alyno gives is tied to the scholar's own words.

## Don't

- Use the full mark under 32px. Use `alyno-mark-small.svg`.
- Straighten the kite, flip it, or change the tilt.
- Recolour the facets, or swap the colours back to match the A.
- Animate it at rest, or add glow, shadow or gradient effects.
