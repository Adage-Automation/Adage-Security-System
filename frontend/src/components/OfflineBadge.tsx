// Shown next to a movement's time wherever records are listed, when that
// record's time came from the guard's device (offline-queue sync) instead
// of the server clock — makes docs/decisions.md's bounded-trust behavior
// visible/auditable instead of a silent DB flag nobody can see.
export function OfflineBadge() {
  return (
    <span
      className="offline-badge"
      title="This time was recorded on the guard's device while offline, not when it synced to the server."
    >
      offline
    </span>
  );
}
