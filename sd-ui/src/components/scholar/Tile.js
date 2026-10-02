import Link from "next/link";

/**
 * A number with a picture of itself: the tile the Studio and the Profile both
 * open with. The whole tile is the link to where the number comes from.
 *
 * @param {object} p
 * @param {string} p.label   what is counted, as a short overline
 * @param {string|number} p.value
 * @param {string} [p.unit]  drawn smaller beside the value ("/ 3")
 * @param {string} p.sub     one line saying what the number means
 * @param {string} p.href
 * @param {import("react").ReactNode} [p.children]  the picture: a bar, a ring, a spark
 */
export default function Tile({ label, value, unit = null, sub, href, children, className = "" }) {
  return (
    <Link href={href} className={`dash-tile${className ? ` ${className}` : ""}`}>
      <span className="dash-tile__label">{label}</span>
      <span className="dash-tile__row">
        <span className="dash-tile__value">{value}{unit ? <small>{unit}</small> : null}</span>
        {children}
      </span>
      <span className="dash-tile__sub">{sub}</span>
    </Link>
  );
}
