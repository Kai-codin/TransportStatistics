"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useUser, useClerk, SignOutButton, Show, SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";
import { 
  Home, User, Users, CheckCircle, Palette, RefreshCw, Edit, 
  Shield, Settings, Sun, LogOut 
} from "lucide-react";

const navLinks = [
  { name: "Home", href: "/", icon: Home },
  { name: "Profile", href: "/profile", icon: User },
  { name: "Friends", href: "/friends", icon: Users },
  { name: "Completion", href: "/completion", icon: CheckCircle },
  { name: "Liveries", href: "/liveries", icon: Palette },
  { name: "Update", href: "/update", icon: RefreshCw },
  { name: "Request Edit", href: "/request-edit", icon: Edit },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { user, isLoaded } = useUser();
  const isStaff = isLoaded && user?.publicMetadata?.is_staff === "true";
  const { openUserProfile } = useClerk();

  return (
    // .ts-sidebar styles
    <aside className="w-[220px] flex-shrink-0 flex flex-col bg-ts-surface border-r border-ts-border-soft h-screen overflow-hidden z-10">
      
      {/* .ts-sidebar-brand */}
      <div className="flex items-center gap-2.5 p-5 border-b border-ts-border-soft flex-shrink-0">
        <div className="w-8 h-8 bg-ts-accent rounded-lg flex items-center justify-center text-ts-text-inv font-mono font-extrabold text-[16px]">
          TS
        </div>
        <div className="flex flex-col">
          <span className="text-[13px] font-bold text-white leading-tight">Transport Statistics</span>
        </div>
      </div>

      {/* .ts-sidebar-nav */}
      <nav className="flex-1 overflow-y-auto p-2 flex flex-col gap-0.5">
        {navLinks.map((link) => {
          const isActive = pathname === link.href;
          const Icon = link.icon;
          return (
            <Link 
              key={link.name} 
              href={link.href}
              className={`flex items-center gap-2.5 px-2.5 py-2 rounded-[6px] text-[13.5px] font-medium transition-all duration-150 border border-transparent ${
                isActive 
                  ? "bg-ts-accent-light text-ts-accent border-ts-accent-border" 
                  : "text-ts-text-2 hover:bg-ts-surface-2 hover:text-white hover:border-ts-border-soft"
              }`}
            >
              <div className="w-[18px] h-[18px] flex items-center justify-center opacity-70">
                <Icon size={18} />
              </div>
              {link.name}
            </Link>
          );
        })}

        {/* Staff Section */}
        {isStaff && (
          <div className="mt-4">
            <p className="text-[9.5px] font-bold uppercase tracking-[0.09em] text-ts-text-3 px-3 py-2">Staff</p>
            <Link href="/admin" className="flex items-center gap-2.5 px-2.5 py-2 rounded-[6px] text-[13.5px] text-ts-text-2 hover:bg-ts-surface-2 hover:text-white transition-all">
              <Shield size={18} /> Admin
            </Link>
          </div>
        )}
      </nav>

      {/* .ts-sidebar-footer */}
      <div className="p-2 border-t border-ts-border-soft flex-shrink-0 flex flex-col gap-1">
        
        <Show when="signed-out">
          <div className="flex flex-col gap-2 p-2">
            <SignInButton mode="modal">
              <button className="w-full text-left text-sm text-ts-text-2 hover:text-white py-1">Sign In</button>
            </SignInButton>
          </div>
        </Show>

        <Show when="signed-in">
          {/* User Card */}
          <div 
            onClick={() => openUserProfile()}
            className="flex items-center gap-2.5 p-2 rounded-[6px] bg-ts-surface-2 border border-ts-border-soft mb-1 cursor-pointer hover:border-ts-accent-border hover:bg-ts-accent-light transition-all"
          >
            {/* Hide the default UserButton but keep it for the avatar image */}
            <div className="pointer-events-none h-7 w-7">
              <UserButton />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-semibold text-white truncate">{user?.fullName || "User"}</p>
              {isStaff && <p className="text-[10px] text-ts-text-3 uppercase tracking-wide">Staff</p>}
            </div>
          </div>
          
          <button className="flex items-center gap-2.5 px-2.5 py-2 rounded-[6px] text-[13px] text-ts-text-2 hover:bg-ts-surface-2 hover:text-white w-full transition-all">
            <Settings size={18} /> Settings
          </button>
          <button className="flex items-center gap-2.5 px-2.5 py-2 rounded-[6px] text-[13px] text-ts-text-2 hover:bg-ts-surface-2 hover:text-white w-full transition-all">
            <Sun size={18} /> Light mode
          </button>

          <SignOutButton>
            <button className="flex items-center gap-2.5 px-2.5 py-2 rounded-[6px] text-[13px] text-red-400 hover:bg-red-950/20 hover:text-red-300 w-full transition-all">
              <LogOut size={18} /> Log out
            </button>
          </SignOutButton>
        </Show>
      </div>
    </aside>
  );
}