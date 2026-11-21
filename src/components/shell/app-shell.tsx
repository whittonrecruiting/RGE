import { BrandHeader, BrandMark } from "./brand-logo";
import { SidebarLink } from "./nav-link";
import { NAV_ITEMS } from "./nav-items";
import { PhoneNav } from "./phone-nav";
import { UserMenu } from "./user-menu";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[220px] flex-col border-r border-line bg-surface md:flex">
        <div className="flex h-16 items-center px-5">
          <BrandMark />
        </div>
        <nav aria-label="Primary" className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-2">
          {NAV_ITEMS.map((item) => (
            <SidebarLink key={item.href} item={item} />
          ))}
        </nav>
        <div className="border-t border-line p-3">
          <UserMenu placement="above" />
        </div>
      </aside>

      {/* Phone top bar */}
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-line bg-surface px-4 md:hidden">
        <BrandHeader height={26} />
        <UserMenu placement="below" />
      </header>

      <main className="min-w-0 px-4 py-6 pb-24 md:ml-[220px] md:px-10 md:py-10 md:pb-10">
        {children}
      </main>

      <PhoneNav />
    </div>
  );
}
