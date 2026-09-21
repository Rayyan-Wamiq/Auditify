"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, LogOut } from "lucide-react";

import { useAuth } from "./AuthProvider";

// Fallbacks keep the pill readable during the brief window before the auth
// context finishes restoring the session from localStorage. Deliberately
// generic - no real personal data is ever hardcoded in this repo.
const FALLBACK_NAME = "Auditify User";
const FALLBACK_EMAIL = "user@example.com";
const FALLBACK_INITIALS = "AU";

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return FALLBACK_INITIALS;
  const first = parts[0]?.charAt(0) ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1]?.charAt(0) ?? "" : "";
  const result = `${first}${last}`.toUpperCase();
  return result || FALLBACK_INITIALS;
}

export default function ProfileSection() {
  const { user, logout } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const displayName = user?.full_name || FALLBACK_NAME;
  const email = user?.email || FALLBACK_EMAIL;
  const initials = initialsOf(displayName);

  const close = useCallback(() => setIsOpen(false), []);

  const toggle = useCallback(() => setIsOpen((v) => !v), []);

  const handleSignOut = useCallback(() => {
    close();
    // Shared auth-context helper: clears the access/refresh tokens from
    // localStorage, resets session state, and routes to /login
    // (router.replace) in one step.
    logout();
  }, [close, logout]);

  // Dismiss on any pointer interaction outside the pill + menu (mouse and
  // touch). touchstart covers mobile browsers that don't emit mouse events.
  // The pill and menu live inside `ref`, so their own interactions never
  // trigger dismissal and no stopPropagation is needed.
  useEffect(() => {
    function onPointerDown(e: Event) {
      const target = e.target as Node | null;
      if (ref.current && target && !ref.current.contains(target)) setIsOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown, { passive: true });
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, []);

  // Dismiss on Escape so the menu is keyboard-dismissable; the listener is
  // only attached while the menu is open.
  useEffect(() => {
    if (!isOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setIsOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={toggle}
        className="pointer-events-auto flex items-center gap-2.5 rounded-md border border-slate-200 bg-white py-1.5 pl-1.5 pr-3 hover:border-slate-300 transition-colors"
        aria-haspopup="menu"
        aria-expanded={isOpen}
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-600 text-xs font-semibold text-white">
          {initials}
        </span>
        <span className="text-left leading-tight hidden sm:block">
          <span className="block text-sm font-medium text-slate-900">{displayName}</span>
          <span className="block text-[11px] text-slate-500">Enterprise User</span>
        </span>
        <ChevronDown
          size={14}
          className={`text-slate-400 transition-transform ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      {isOpen && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-2 w-56 rounded-md border border-slate-200 bg-white py-1.5 shadow-panel animate-fade-in"
        >
          <div className="border-b border-slate-100 px-3.5 py-2.5">
            <p className="text-sm font-medium text-slate-900">{displayName}</p>
            <p className="text-xs text-slate-500">{email}</p>
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={handleSignOut}
            className="pointer-events-auto flex w-full items-center gap-2.5 px-3.5 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
          >
            <LogOut size={15} /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}
