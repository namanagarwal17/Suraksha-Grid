"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  LogIn,
  LogOut,
  Pencil,
  Loader2,
  CheckCircle2,
  AlertCircle,
  X,
  Trash2,
} from "lucide-react";
import { Card, EmptyState, Skeleton } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScoreBadge } from "@/components/safety/score";
import { getUser, signOut, onAuthStateChange } from "@/lib/services/auth";
import {
  getProfile,
  updateProfile,
  getUserContributions,
  getSavedRoutes,
  deleteSavedRoute,
  type ProfileRow,
  type UserStats,
  type SavedRouteItem,
} from "@/lib/services/profile";
import { cn, timeAgo } from "@/lib/utils";
import type { User } from "@supabase/supabase-js";

const PREFS = [
  "Prefer well-lit roads",
  "Avoid isolated stretches",
  "Alert me when safety changes",
];

export default function ProfilePage() {
  const [on, setOn] = useState<Record<string, boolean>>({
    [PREFS[0]]: true,
    [PREFS[2]]: true,
  });
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [savedRoutes, setSavedRoutes] = useState<SavedRouteItem[]>([]);
  const [stats, setStats] = useState<UserStats>({
    reportsCount: 0,
    storiesCount: 0,
    contributions: [],
  });
  const [loading, setLoading] = useState(true);
  const [signingOut, setSigningOut] = useState(false);
  const router = useRouter();

  // Editing state
  const [isEditing, setIsEditing] = useState(false);
  const [fullNameInput, setFullNameInput] = useState("");
  const [avatarUrlInput, setAvatarUrlInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deletingRouteId, setDeletingRouteId] = useState<string | null>(null);

  const loadUserData = useCallback(async () => {
    setLoading(true);
    try {
      const user = await getUser();
      setAuthUser(user);

      if (user) {
        const [profileRes, statsRes, savedRoutesRes] = await Promise.all([
          getProfile(user.id),
          getUserContributions(user.id),
          getSavedRoutes(user.id),
        ]);

        if (profileRes.data) {
          setProfile(profileRes.data);
          setFullNameInput(profileRes.data.full_name ?? "");
          setAvatarUrlInput(profileRes.data.avatar_url ?? "");
        } else {
          const metaName = (user.user_metadata?.full_name as string) ?? "";
          const metaAvatar = (user.user_metadata?.avatar_url as string) ?? "";
          setFullNameInput(metaName);
          setAvatarUrlInput(metaAvatar);
        }

        setStats(statsRes);
        setSavedRoutes(savedRoutesRes);
      } else {
        setProfile(null);
        setSavedRoutes([]);
        setStats({ reportsCount: 0, storiesCount: 0, contributions: [] });
      }
    } catch {
      setAuthUser(null);
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadUserData();
    let subscription: { unsubscribe: () => void } | null = null;
    void onAuthStateChange((_event, session) => {
      if (session?.user) {
        void loadUserData();
      } else {
        setAuthUser(null);
        setProfile(null);
        setIsEditing(false);
        setStats({ reportsCount: 0, storiesCount: 0, contributions: [] });
      }
    }).then((sub) => {
      subscription = sub.data.subscription;
    });

    return () => {
      subscription?.unsubscribe();
    };
  }, [loadUserData]);

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
      setAuthUser(null);
      setProfile(null);
      setIsEditing(false);
      setStats({ reportsCount: 0, storiesCount: 0, contributions: [] });
      router.refresh();
    } finally {
      setSigningOut(false);
    }
  };

  const handleDeleteRoute = async (e: React.MouseEvent, savedRouteId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDeletingRouteId(savedRouteId);
    try {
      const res = await deleteSavedRoute(savedRouteId);
      if (res.ok) {
        setSavedRoutes((prev) => prev.filter((r) => r.id !== savedRouteId));
      }
    } finally {
      setDeletingRouteId(null);
    }
  };

  const handleStartEditing = () => {
    setFullNameInput(
      profile?.full_name ?? (authUser?.user_metadata?.full_name as string) ?? "",
    );
    setAvatarUrlInput(
      profile?.avatar_url ?? (authUser?.user_metadata?.avatar_url as string) ?? "",
    );
    setSaveSuccess(false);
    setSaveError(null);
    setIsEditing(true);
  };

  const handleCancelEditing = () => {
    setIsEditing(false);
    setSaveError(null);
    setSaveSuccess(false);
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authUser) return;

    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    const { data, error } = await updateProfile(authUser.id, {
      full_name: fullNameInput.trim() || null,
      avatar_url: avatarUrlInput.trim() || null,
    });

    setSaving(false);

    if (error) {
      setSaveError(error);
    } else {
      if (data) {
        setProfile(data);
      } else {
        setProfile((prev) => ({
          id: authUser.id,
          full_name: fullNameInput.trim() || null,
          avatar_url: avatarUrlInput.trim() || null,
          created_at: prev?.created_at ?? authUser.created_at,
          updated_at: new Date().toISOString(),
        }));
      }
      setSaveSuccess(true);
      setTimeout(() => {
        setIsEditing(false);
        setSaveSuccess(false);
      }, 1500);
    }
  };

  const displayName =
    profile?.full_name ||
    (authUser?.user_metadata?.full_name as string | undefined) ||
    (authUser?.email ? authUser.email.split("@")[0] : null) ||
    "Anonymous User";

  const email = authUser?.email ?? "Not signed in";
  const initials =
    displayName
      .split(" ")
      .map((w) => w[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "U";

  return (
    <div className="mx-auto grid max-w-5xl gap-4 p-4 lg:grid-cols-2 lg:p-8">
      {/* Header */}
      <Card className="flex flex-col gap-4 lg:col-span-2">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            {loading ? (
              <Skeleton className="h-16 w-16 shrink-0 rounded-full" />
            ) : authUser ? (
              <div className="relative grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-full bg-brand text-xl font-bold text-white">
                {profile?.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={profile.avatar_url}
                    alt={displayName}
                    className="h-full w-full object-cover"
                    onError={(e) => {
                      e.currentTarget.style.display = "none";
                    }}
                  />
                ) : null}
                <span>{initials}</span>
              </div>
            ) : (
              <span className="grid h-16 w-16 shrink-0 place-items-center rounded-full border border-line bg-surface text-xl font-bold text-muted">
                GS
              </span>
            )}

            <div className="min-w-0 flex-1">
              {loading ? (
                <div className="space-y-1.5">
                  <Skeleton className="h-6 w-36" />
                  <Skeleton className="h-4 w-48" />
                </div>
              ) : (
                <>
                  <h1 className="truncate text-xl font-bold text-ink">
                    {authUser ? displayName : "Guest User"}
                  </h1>
                  <p className="truncate text-sm text-muted">
                    {authUser
                      ? email
                      : "Sign in to sync your profile and reports"}
                  </p>
                  {authUser ? (
                    <span className="mt-1 inline-block rounded-full bg-safer/10 px-2 py-0.5 text-xs font-semibold text-safer">
                      Signed in
                    </span>
                  ) : (
                    <span className="mt-1 inline-block rounded-full bg-surface px-2 py-0.5 text-xs font-medium text-muted">
                      Browsing as guest
                    </span>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4 self-end sm:self-auto">
            <div className="flex gap-6 text-center">
              <div>
                <p className="text-xl font-bold text-ink">
                  {loading ? "…" : stats.reportsCount}
                </p>
                <p className="text-xs text-muted">Reports</p>
              </div>
              <div>
                <p className="text-xl font-bold text-ink">
                  {loading ? "…" : stats.storiesCount}
                </p>
                <p className="text-xs text-muted">Stories</p>
              </div>
            </div>

            {loading ? null : authUser ? (
              <div className="flex items-center gap-2">
                {!isEditing && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleStartEditing}
                  >
                    <Pencil className="mr-1.5 h-3.5 w-3.5" />
                    Edit
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSignOut}
                  disabled={signingOut}
                >
                  {signingOut ? (
                    <>
                      <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                      Signing out…
                    </>
                  ) : (
                    <>
                      <LogOut className="mr-1.5 h-4 w-4" />
                      Sign out
                    </>
                  )}
                </Button>
              </div>
            ) : (
              <Link href="/auth/login">
                <Button size="sm">
                  <LogIn className="mr-1.5 h-4 w-4" />
                  Sign in
                </Button>
              </Link>
            )}
          </div>
        </div>

        {/* Edit Profile Section */}
        {authUser && isEditing && (
          <form
            onSubmit={handleSaveProfile}
            className="mt-2 space-y-3 border-t border-line pt-4"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-ink">Edit Profile</h2>
              <button
                type="button"
                onClick={handleCancelEditing}
                className="flex items-center gap-1 text-xs text-muted hover:text-ink"
              >
                <X className="h-3.5 w-3.5" /> Cancel
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="full_name"
                  className="mb-1 block text-xs font-semibold text-muted"
                >
                  Full name
                </label>
                <input
                  id="full_name"
                  type="text"
                  value={fullNameInput}
                  onChange={(e) => setFullNameInput(e.target.value)}
                  placeholder="Your full name"
                  maxLength={100}
                  className="h-10 w-full rounded-xl border border-line bg-white px-3 text-sm outline-none focus:border-brand"
                />
              </div>

              <div>
                <label
                  htmlFor="avatar_url"
                  className="mb-1 block text-xs font-semibold text-muted"
                >
                  Avatar image URL
                </label>
                <input
                  id="avatar_url"
                  type="url"
                  value={avatarUrlInput}
                  onChange={(e) => setAvatarUrlInput(e.target.value)}
                  placeholder="https://example.com/avatar.jpg"
                  maxLength={300}
                  className="h-10 w-full rounded-xl border border-line bg-white px-3 text-sm outline-none focus:border-brand"
                />
              </div>
            </div>

            {saveSuccess && (
              <div className="flex items-center gap-2 rounded-xl bg-safer/10 p-2.5 text-xs font-semibold text-safer">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                Profile updated successfully.
              </div>
            )}

            {saveError && (
              <div className="flex items-center gap-2 rounded-xl bg-concern/10 p-2.5 text-xs font-semibold text-concern">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {saveError}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleCancelEditing}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={saving}>
                {saving ? (
                  <>
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    Saving…
                  </>
                ) : (
                  "Save changes"
                )}
              </Button>
            </div>
          </form>
        )}
      </Card>

      {/* Saved routes */}
      <Card>
        <h2 className="mb-3 font-bold">Saved routes</h2>
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-11 rounded-xl" />
            <Skeleton className="h-11 rounded-xl" />
          </div>
        ) : !authUser ? (
          <EmptyState
            title="Sign in to save routes"
            hint="Save your frequently used routes for quick navigation."
          />
        ) : savedRoutes.length === 0 ? (
          <EmptyState
            title="No saved routes yet"
            hint="Routes you save during navigation will appear here."
          />
        ) : (
          <div className="space-y-2">
            {savedRoutes.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between rounded-xl bg-surface p-3 text-sm transition hover:bg-brand-soft"
              >
                <Link
                  href={`/navigation?route=${r.routeType}`}
                  className="flex flex-1 items-center justify-between mr-3 text-foreground"
                >
                  <span>
                    <b>{r.label || r.name}</b> · {r.routeType}
                  </span>
                  <ScoreBadge score={r.safetyScore} />
                </Link>
                <button
                  type="button"
                  onClick={(e) => void handleDeleteRoute(e, r.id)}
                  disabled={deletingRouteId === r.id}
                  title="Remove saved route"
                  aria-label="Remove saved route"
                  className="rounded-lg p-1.5 text-muted transition hover:bg-concern/10 hover:text-concern"
                >
                  {deletingRouteId === r.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Preferences */}
      <Card>
        <h2 className="mb-3 font-bold">Preferences</h2>
        <div className="space-y-2">
          {PREFS.map((p) => (
            <button
              key={p}
              type="button"
              role="switch"
              aria-checked={!!on[p]}
              onClick={() => setOn({ ...on, [p]: !on[p] })}
              className="flex w-full items-center justify-between rounded-xl bg-surface p-3 text-left text-sm transition hover:bg-brand-soft/50"
            >
              {p}
              <span
                className={cn(
                  "h-6 w-11 rounded-full p-0.5 transition",
                  on[p] ? "bg-brand" : "bg-line",
                )}
              >
                <span
                  className={cn(
                    "block h-5 w-5 rounded-full bg-white shadow transition-transform",
                    on[p] && "translate-x-5",
                  )}
                />
              </span>
            </button>
          ))}
        </div>
      </Card>

      {/* Contributions */}
      <Card className="lg:col-span-2">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-bold">My contributions</h2>
          {!authUser && !loading && (
            <Link
              href="/auth/signup"
              className="text-sm font-semibold text-brand"
            >
              Sign up to contribute
            </Link>
          )}
        </div>

        {loading ? (
          <div className="grid gap-2 md:grid-cols-2">
            <Skeleton className="h-12 rounded-xl" />
            <Skeleton className="h-12 rounded-xl" />
          </div>
        ) : !authUser ? (
          <EmptyState
            title="No contributions yet"
            hint="Sign in to view your submitted safety reports and street stories."
          />
        ) : stats.contributions.length === 0 ? (
          <EmptyState
            title="No contributions yet"
            hint="You haven't submitted any safety reports or stories yet."
          />
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {stats.contributions.map((c) => {
              const mins = Math.max(
                0,
                Math.round(
                  (Date.now() - new Date(c.createdAt).getTime()) / 60000,
                ),
              );
              return (
                <div
                  key={c.id}
                  className="flex items-center justify-between rounded-xl bg-surface p-3 text-sm"
                >
                  <span className="truncate pr-2 font-medium text-ink">
                    {c.title}
                  </span>
                  <span className="shrink-0 text-xs text-muted">
                    {timeAgo(mins)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}