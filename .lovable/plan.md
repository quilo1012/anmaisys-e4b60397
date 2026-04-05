

# Fix: Protected Route / Session Redirect Bug

## Root cause

Two issues in `AuthContext.tsx` and `ProtectedRoute.tsx`:

1. **Race condition on role loading**: `setLoading(false)` fires immediately in both `onAuthStateChange` (line 58) and `getSession` (line 68), but `fetchUserData` is async and hasn't resolved yet. The `role` is still `null` when `ProtectedRoute` evaluates. While `ProtectedRoute` currently lets `null` role through (line 27), any transient re-render during role fetch can cause flicker or unexpected state.

2. **Session can briefly be null during token refresh**: `onAuthStateChange` can fire with a `null` session during token refresh events, causing `ProtectedRoute` to see `!session` and redirect to `/login`. The code sets `loading(false)` on every auth state change, so there's no "still refreshing" guard.

3. **Missing "unauthorized" state**: When a user has a valid session but wrong role, `ProtectedRoute` redirects them. If the redirect target also doesn't match (or during the role-null window), it can cascade to `/login`.

## Changes

### `src/contexts/AuthContext.tsx`

- Track role loading separately with a `roleLoading` state
- Only set `loading` to `false` after both session AND role data are resolved
- In `fetchUserData`, set `roleLoading = false` on completion (including errors)
- In `onAuthStateChange`, don't clear session/role if the event is `TOKEN_REFRESHED` with a valid session — only clear on explicit `SIGNED_OUT`
- Export a combined `loading` that accounts for role fetch

### `src/components/ProtectedRoute.tsx`

- When `session` exists but `role` is still `null` (role loading), show spinner — don't redirect
- When `session` exists and `role` is loaded but doesn't match `allowedRoles`, show an "Access Denied" message with a link to the user's correct dashboard — don't redirect to `/login`
- Only redirect to `/login` when `session` is truly `null` and loading is complete

## Files modified

| File | Change |
|------|--------|
| `src/contexts/AuthContext.tsx` | Track role loading state; don't set loading=false until role resolves; guard against transient null sessions |
| `src/components/ProtectedRoute.tsx` | Show spinner while role loads; show access-denied instead of login redirect for wrong role |

