import { Popover, PopoverButton, PopoverPanel } from "@headlessui/react";
import { Bars3Icon, MagnifyingGlassIcon } from "@heroicons/react/20/solid";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { useEffect, useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { useInstance, useUser } from "@/features/auth/hooks/useSession";
import { api } from "@/lib/api";
import { can, PERM } from "@/lib/permissions";
import type { MediaRequest } from "@/lib/types";
import Logo from "./Logo";
import UserMenu from "./UserMenu";

const useScrolled = () => {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return scrolled;
};

const usePendingRequests = (enabled: boolean) =>
  useQuery({
    queryKey: ["requests", "all", "pending"],
    queryFn: () => api.get<MediaRequest[]>("/requests?scope=all&status=pending"),
    enabled,
    refetchInterval: 60_000,
    select: (d) => d.length,
  });

const Navbar = () => {
  const scrolled = useScrolled();
  const user = useUser();
  const { data: instance } = useInstance();
  const navigate = useNavigate();
  const manager = can(user, PERM.MANAGE_REQUESTS);
  const { data: pending } = usePendingRequests(manager);

  // "/" jumps to search from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey) return;
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) return;
      e.preventDefault();
      navigate("/search");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  const links = [
    { to: "/", label: "Home", show: true },
    { to: "/shows", label: "Shows", show: true },
    { to: "/movies", label: "Movies", show: true },
    { to: "/my-list", label: "My List", show: true },
    { to: "/discover", label: "Discover", show: can(user, PERM.REQUEST) || can(user, PERM.ADD_MEDIA) },
    {
      to: "/requests",
      label: "Requests",
      show: can(user, PERM.REQUEST) || manager,
      count: manager ? pending : undefined,
    },
  ].filter((l) => l.show);

  return (
    <header
      className={clsx(
        "fixed inset-x-0 top-0 z-40 border-b transition-[background-color,border-color,backdrop-filter] duration-300",
        scrolled
          ? "border-white/[0.06] bg-bg/75 backdrop-blur-xl backdrop-saturate-150"
          : "border-transparent bg-gradient-to-b from-black/60 via-black/25 to-transparent",
      )}
    >
      <nav className="flex h-16 items-center gap-8 px-4 sm:px-10">
        <div className="flex items-center gap-1">
          <Popover className="relative lg:hidden">
            <PopoverButton className="-ml-2 rounded-lg p-2 text-fg/80 hover:bg-white/10 hover:text-fg" aria-label="Menu">
              <Bars3Icon className="size-5" />
            </PopoverButton>
            <PopoverPanel
              transition
              anchor="bottom start"
              className="z-50 mt-2 w-60 rounded-xl border border-white/10 bg-surface/95 p-1.5 shadow-2xl shadow-black/60 backdrop-blur-xl transition data-[closed]:-translate-y-1 data-[closed]:opacity-0"
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
                        clsx(
                          "flex items-center justify-between rounded-lg px-3 py-2 text-sm",
                          isActive ? "bg-white/10 font-semibold text-fg" : "text-fg/70 hover:bg-white/5 hover:text-fg",
                        )
                      }
                    >
                      {l.label}
                      {!!l.count && <span className="rounded-full bg-primary px-1.5 text-[11px] font-bold text-on-primary">{l.count}</span>}
                    </NavLink>
                  ))}
                </div>
              )}
            </PopoverPanel>
          </Popover>

          <Link to="/" className="flex items-center gap-2 rounded-lg py-1 pr-1">
            <Logo className="size-7" />
            <span className="text-[19px] leading-none font-extrabold tracking-[-0.03em]">
              {instance?.name ?? "torrented"}
            </span>
          </Link>
        </div>

        <div className="hidden items-center gap-1 lg:flex">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.to === "/"}
              className={({ isActive }) =>
                clsx(
                  "relative flex items-center gap-1.5 rounded-lg px-3 py-2 text-[14px] font-medium transition-colors",
                  isActive ? "text-fg" : "text-fg/60 hover:text-fg",
                )
              }
            >
              {({ isActive }) => (
                <>
                  {l.label}
                  {!!l.count && (
                    <span className="grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-bold text-on-primary">
                      {l.count}
                    </span>
                  )}
                  <span
                    className={clsx(
                      "absolute inset-x-3 -bottom-[13px] h-0.5 rounded-full bg-primary transition-opacity",
                      isActive ? "opacity-100" : "opacity-0",
                    )}
                  />
                </>
              )}
            </NavLink>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-3">
          <button
            onClick={() => navigate("/search")}
            className="group hidden h-9 w-60 items-center gap-2 rounded-full bg-white/[0.07] pr-2 pl-3.5 text-sm text-fg/50 ring-1 ring-white/10 backdrop-blur transition hover:bg-white/[0.1] hover:text-fg/70 md:flex"
          >
            <MagnifyingGlassIcon className="size-4" />
            <span className="flex-1 text-left">Search titles</span>
            <kbd className="rounded-md bg-white/10 px-1.5 py-0.5 font-sans text-[11px] text-fg/60">/</kbd>
          </button>
          <button
            onClick={() => navigate("/search")}
            className="rounded-full p-2 text-fg/80 transition hover:bg-white/10 hover:text-fg md:hidden"
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
