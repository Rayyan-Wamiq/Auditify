"use client";

import React, { useState } from "react";
import Image from "next/image";
import { Eye, EyeOff, Shield } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function LoginPage() {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  // The branding artwork lives at /public/branding-left.png. While that file
  // is not yet committed, onError flips this flag and a minimal gradient
  // fallback renders instead of a broken image. Once the asset exists this
  // fallback becomes dead code and can be removed.
  const [brandImageOk, setBrandImageOk] = useState(true);
  const { login, signup, user, accessToken, isLoading } = useAuth();
  const router = useRouter();

  // Redirect authenticated users to dashboard
  useEffect(() => {
    if (!isLoading && accessToken && user) {
      router.replace("/");
    }
  }, [isLoading, accessToken, user, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setError("");

    if (!email || !password) {
      setError("Email and password are required.");
      return;
    }

    if (isSignUp && password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setIsSubmitting(true);
    try {
      if (isSignUp) {
        await signup(email.trim(), password, fullName.trim() || undefined);
      } else {
        await login(email.trim(), password);
      }
    } catch (err: any) {
      const msg = err?.message ?? "Something went wrong. Please try again.";
      setError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="flex min-h-[640px] w-full max-w-5xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
        {/* Left Panel - full-bleed branding artwork */}
        <div className="relative w-1/2 min-w-[280px] overflow-hidden bg-gradient-to-br from-slate-900 via-slate-900 to-emerald-950">
          {brandImageOk ? (
            <Image
              src="/branding-left.png"
              alt="Auditify AI Assistant - AI-Powered Technical Audits and Compliance Engine. Review. Remediate. Comply."
              fill
              priority
              sizes="(max-width: 1024px) 50vw, 512px"
              className="h-full w-full object-cover"
              onError={() => setBrandImageOk(false)}
            />
          ) : (
            // Temporary fallback until /public/branding-left.png is committed.
            // Delete this block once the asset exists.
            <div className="flex h-full flex-col items-center justify-center p-12 text-center">
              <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/10">
                <Shield className="h-8 w-8 text-emerald-400" />
              </div>
              <h1 className="text-2xl font-bold text-white">
                Auditify <span className="text-emerald-400">AI Assistant</span>
              </h1>
              <p className="mt-2 text-sm text-slate-300">Review. Remediate. Comply.</p>
            </div>
          )}
        </div>

        {/* Right Panel */}
        <div className="flex w-1/2 min-w-[280px] flex-col justify-center p-12">
          <div className="mb-6">
            <h2 className="text-2xl font-bold text-slate-900">
              {isSignUp ? "Create your account" : "Welcome Back"}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {isSignUp
                ? "Join Auditify to start auditing"
                : "Sign in to continue to Auditify"}
            </p>
          </div>

          {error && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {isSignUp && (
              <div>
                <label htmlFor="fullName" className="block text-sm font-medium text-slate-700">
                  Full Name
                </label>
                <input
                  id="fullName"
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="mt-1 block w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 focus:outline-none"
                  placeholder="Jane Doe"
                />
              </div>
            )}
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-slate-700">
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 focus:outline-none"
                placeholder="you@company.com"
              />
            </div>
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-slate-700">
                Password
              </label>
              <div className="relative mt-1">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete={isSignUp ? "new-password" : "current-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="block w-full rounded-lg border border-slate-300 px-4 py-2.5 pr-10 text-sm text-slate-900 placeholder-slate-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 focus:outline-none"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label="Toggle password visibility"
                  aria-pressed={showPassword}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 transition-colors hover:text-slate-600"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 focus:ring-2 focus:ring-emerald-500/30 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? "Processing..." : isSignUp ? "Sign Up" : "Sign In"}
            </button>
          </form>

          <div className="mt-6 text-center text-sm text-slate-500">
            {isSignUp ? "Already have an account?" : "Don't have an account?"}{" "}
            <button
              type="button"
              onClick={() => {
                setIsSignUp(!isSignUp);
                setError("");
              }}
              className="font-medium text-emerald-600 hover:text-emerald-700 hover:underline"
            >
              {isSignUp ? "Sign In" : "Sign Up free"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

