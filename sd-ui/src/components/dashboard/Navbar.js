import Image from "next/image";
import Link from "next/link";

import LogoutButton from "@/components/auth/LogoutButton";

export default function Navbar({ navItems, activeHref }) {
  return (
    <nav className="topbar">
      <div className="brand-cluster">
        <Link href="/" className="company-brand">
          <Image
            src="/archivyn-logo.svg"
            alt="Archivyn logo"
            width={36}
            height={36}
            className="company-logo"
            priority
          />
          <span className="company-wordmark">Archivyn</span>
        </Link>

        <div className="brand-block">
          <span className="brand-kicker">Scholar Dashboard</span>
          <h1>Scholar media dashboard</h1>
        </div>
      </div>

      <div className="nav-cluster">
        <div className="nav-links">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={
                item.href === activeHref ? "nav-link is-active" : "nav-link"
              }
            >
              {item.label}
            </Link>
          ))}
        </div>

        <LogoutButton />
      </div>
    </nav>
  );
}
