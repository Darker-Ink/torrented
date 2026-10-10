import { Popover, PopoverButton, PopoverPanel } from "@headlessui/react";
import { Bars3Icon, MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import clsx from "clsx";
import { useEffect, useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { useInstance, useUser } from "@/features/auth/hooks/useSession";
import { can, PERM } from "@/lib/permissions";
import Logo from "./Logo";
import UserMenu from "./UserMenu";

const useScrolled = () => {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return scrolled;
};

const Navbar = () => {
  const scrolled = useScrolled();
  const user = useUser();
  const { data: instance } = useInstance();
  const navigate = useNavigate();

  const links = [
    { to: "/", label: "Home", show: true },
    { to: "/shows", label: "Shows", show: true },
    { to: "/movies", label: "Movies", show: true },
    { to: "/my-list", label: "My List", show: true },
    { to: "/discover", label: "Discover", show: can(user, PERM.REQUEST) || can(user, PERM.ADD_MEDIA) },
    { to: "/requests", label: "Requests", show: can(user, PERM.REQUEST) || can(user, PERM.MANAGE_REQUESTS) },
  ].filter((l) => l.show);

  return (
    <header
      className={clsx(
        "fixed inset-x-0 top-0 z-40 transition-colors duration-300",
        scrolled ? "bg-bg/95 shadow-lg shadow-black/30 backdrop-blur" : "bg-gradient-to-b from-black/70 to-transparent",
      )}
    >
      <nav className="flex h-16 items-center gap-6 px-4 sm:px-10">
        <Popover className="relative lg:hidden">
          <PopoverButton className="-ml-1 rounded-md p-1.5 text-fg hover:bg-white/10" aria-label="Menu">
            <Bars3Icon className="size-6" />
          </PopoverButton>
          <PopoverPanel
            transition
            anchor="bottom start"
            className="z-50 mt-2 w-56 rounded-lg border border-line bg-surface p-2 shadow-xl transition data-[closed]:opacity-0"
          >
            {({ close }) => (
              <div className="flex flex-col">
                {links.map((l) => (
                  <NavLink
                    key={l.to}
                    to={l.to}
                    end={l.to === "/"}
                    onClick={() => close()}
                    className={({ isActive }) =>
                      clsx("rounded-md px-3 py-2 text-sm", isActive ? "bg-white/10 font-semibold" : "text-muted hover:bg-white/5 hover:text-fg")
                    }
                  >
                    {l.label}
                  </NavLink>
                ))}
              </div>
            )}
          </PopoverPanel>
        </Popover>

        <Link to="/" className="flex items-center gap-2">
          <Logo />
          <span className="hidden text-lg font-black tracking-tight sm:block">{instance?.name ?? "torrented"}</span>
        </Link>

        <div className="hidden items-center gap-5 lg:flex">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.to === "/"}
              className={({ isActive }) =>
                clsx("text-sm transition-colors", isActive ? "font-semibold text-fg" : "text-fg/70 hover:text-fg")
              }
            >
              {l.label}
            </NavLink>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => navigate("/search")}
            className="rounded-full p-2 text-fg/90 transition hover:bg-white/10 hover:text-fg"
            aria-label="Search"
          >
            <MagnifyingGlassIcon className="size-5" />
          </button>
          {user && <UserMenu user={user} />}
        </div>
      </nav>
    </header>
  );
};

export default Navbar;
