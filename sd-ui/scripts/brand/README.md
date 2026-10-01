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
