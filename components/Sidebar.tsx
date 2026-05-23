"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useUser, useClerk, SignOutButton, Show, SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";
import { useTheme } from "@/components/ThemeProvider";
import { 
  Home, User, Users, CheckCircle, Palette, RefreshCw, Edit, Scale,
  Shield, Settings, Sun, LogOut, Menu, X, ChevronLeft, ChevronRight, ChartArea
} from "lucide-react";

const navLinks = [
  { name: "Home", href: "/", icon: Home },
  { name: "Profile", href: "/profile", icon: User },
  { name: "Friends", href: "/friends", icon: Users },
  { name: "Completion", href: "/completion", icon: CheckCircle },
  { name: "Stats", href: "/stats", icon: ChartArea },
  { name: "Liveries", href: "/liveries", icon: Palette },
  { name: "Update", href: "/update", icon: RefreshCw },
  { name: "Request Edit", href: "/request-edit", icon: Edit },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { user, isLoaded } = useUser();
  const isStaff = isLoaded && user?.publicMetadata?.is_staff === "true";
  const { openUserProfile } = useClerk();
  const { theme, setTheme } = useTheme();

  // State
  const [isCollapsed, setIsCollapsed] = useState(false); // For Desktop
  const [isMobileOpen, setIsMobileOpen] = useState(false); // For Mobile

  const themeOptions = [
    { key: "bright" as const, label: "Bright", icon: Sun },
    { key: "light" as const, label: "Light", icon: Palette },
    { key: "dark" as const, label: "Dark", icon: Sun },
  ];

  // Close mobile sidebar on route change
  useEffect(() => {
    setIsMobileOpen(false);
  }, [pathname]);

  return (
    <>
      {/* Mobile Backdrop */}
      {isMobileOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 md:hidden" 
          onClick={() => setIsMobileOpen(false)}
        />
      )}

      {/* Sidebar Container */}
      <aside 
        className={`fixed md:relative z-50 h-screen flex flex-col bg-ts-surface border-r border-ts-border-soft transition-all duration-300 ease-in-out ${
          isCollapsed ? "w-[58px]" : "w-[240px]"
        } ${
          isMobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        }`}
      >
        {/* Header/Brand */}
        <div className="flex items-center justify-between p-5 border-b border-ts-border-soft flex-shrink-0 h-[72px]">
          <div className="flex items-center gap-2.5 overflow-hidden">
            <div className="w-8 h-8 flex-shrink-0 bg-ts-accent rounded-lg flex items-center justify-center text-ts-text-inv font-mono font-extrabold text-[16px]">
              TS
            </div>
            {!isCollapsed && <span className="text-[13px] font-bold text-ts-text-1 leading-tight whitespace-nowrap">Transport Statistics</span>}
          </div>
          
          {/* Toggle Buttons */}
          <button onClick={() => setIsCollapsed(!isCollapsed)} className="hidden md:block p-1 text-ts-text-2 text-ts-text-2">
            {isCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          </button>
          <button onClick={() => setIsMobileOpen(false)} className="md:hidden p-1 text-ts-text-2">
            <X size={20} />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto p-2 flex flex-col gap-0.5">
          {navLinks.map((link) => {
            const isActive = pathname === link.href;
            const Icon = link.icon;
            return (
              <Link 
                key={link.name} 
                href={link.href}
                title={isCollapsed ? link.name : ""}
                className={`flex whitespace-nowrap items-center gap-2.5 px-2.5 py-2 rounded-[6px] text-[13.5px] font-medium transition-all duration-150 border border-transparent ${
                  isActive 
                    ? "bg-ts-accent-light text-ts-accent border-ts-accent-border" 
                    : "text-ts-text-2 hover:bg-ts-surface-2 text-ts-text-2 hover:border-ts-border-soft"
                }`}
              >
                <div className="w-[18px] h-[20px] flex-shrink-0 flex items-center justify-center opacity-70 whitespace-nowrap">
                  <Icon size={18} />
                </div>
                {!isCollapsed && link.name}
              </Link>
            );
          })}

          {isStaff && !isCollapsed && (
            <div className="mt-4">
              <p className="text-[9.5px] font-bold uppercase tracking-[0.09em] text-ts-text-3 px-3 py-2">Staff</p>
              <Link href="/admin" className="flex items-center gap-2.5 px-2.5 py-2 rounded-[6px] text-[13.5px] text-ts-text-2 hover:bg-ts-surface-2 text-ts-text-2 transition-all">
                <Shield size={18} /> Admin
              </Link>
            </div>
          )}
        </nav>

        {/* Footer */}
        <div className="p-2 border-t border-ts-border-soft flex-shrink-0">
          <div className="mb-2 rounded-[8px] border border-ts-border-soft bg-ts-surface-2 p-1">
            <div className={`px-2 pb-1 text-[9.5px] font-bold uppercase tracking-[0.09em] text-ts-text-3 ${isCollapsed ? "text-center" : ""}`}>
              {!isCollapsed ? "Theme" : ""}
            </div>
            <div className={`grid gap-1 ${isCollapsed ? "grid-cols-1" : "grid-cols-3"}`}>
              {themeOptions.map(({ key, label, icon: Icon }) => {
                const active = theme === key;
                return (
                  <button
                    key={key}
                    type="button"
                    title={label}
                    onClick={() => setTheme(key)}
                    className={`flex items-center justify-center gap-2 rounded-[6px] px-2 py-2 text-[12px] font-semibold transition-all ${
                      active
                        ? "bg-ts-accent-light text-ts-accent border border-ts-accent-border"
                        : "text-ts-text-2 hover:bg-ts-surface text-ts-text-2 border border-transparent"
                    } ${isCollapsed ? "aspect-square p-0" : ""}`}
                  >
                    <Icon size={16} />
                    {!isCollapsed && label}
                  </button>
                );
              })}
            </div>
          </div>

          <Show when="signed-in">
             <div 
              onClick={() => openUserProfile()}
              className={`flex items-center gap-2.5 p-2 rounded-[6px] bg-ts-surface-2 border border-ts-border-soft cursor-pointer hover:border-ts-accent-border transition-all ${isCollapsed ? "justify-center" : ""}`}
            >
              <div className="pointer-events-none h-7 w-7 flex-shrink-0">
                <UserButton />
              </div>
              {!isCollapsed && (
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-semibold text-ts-text-1 truncate">{user?.fullName || "User"}</p>
                </div>
              )}
            </div>
            <SignOutButton>
              <button className={`flex items-center gap-2.5 px-2.5 py-2 rounded-[6px] text-[13px] text-red-400 hover:bg-red-950/20 hover:text-red-300 w-full transition-all whitespace-nowrap ${isCollapsed ? "justify-center" : ""}`}>
                <LogOut size={18} />
                {!isCollapsed && "Log out"}
              </button>
            </SignOutButton>
          </Show>

          <Show when="signed-out">
              <SignInButton>
                <button className="flex items-center gap-2.5 px-2.5 py-2 rounded-[6px] text-[13px] text-ts-text-2 hover:bg-ts-surface-2 text-ts-text-2 w-full transition-all whitespace-nowrap">
                  Login
                </button>
              </SignInButton>
              <SignUpButton>
                <button className="flex items-center gap-2.5 px-2.5 py-2 rounded-[6px] text-[13px] text-ts-text-2 hover:bg-ts-surface-2 text-ts-text-2 w-full transition-all whitespace-nowrap">
                  Register
                </button>
              </SignUpButton>
          </Show>
          <div className="mt-4">
              <Link href="/legal" className="flex items-center gap-2.5 px-2.5 py-2 rounded-[6px] text-[13.5px] text-ts-text-2 hover:bg-ts-surface-2 text-ts-text-2 transition-all">
                <Scale size={18} /> {!isCollapsed && "Legal, Privacy & Data"}
              </Link>
            </div>
        </div>
      </aside>

      {/* Mobile Hamburger Menu (Only visible when sidebar is closed on mobile) */}
      <button 
        onClick={() => setIsMobileOpen(true)}
        className="md:hidden fixed top-4 left-4 z-30 p-2 bg-ts-surface text-ts-text-1 rounded-md border border-ts-border-soft"
      >
        <Menu size={20} />
      </button>
    </>
  );
}