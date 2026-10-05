import { BottomSheet } from "../ui";
import { NavGroupList, groupsForRole } from "./NavGroupList";

/**
 * The "More" destination.
 *
 * Every entry is a real, routed screen. Nothing here is a placeholder, which is
 * the whole point: a More sheet that lists aspirational features teaches users
 * that the app lies.
 *
 * Shares `NavGroupList` with the sidebar drawer so the two cannot list different
 * destinations, and closes on navigation because a sheet left open over a new
 * page is a dead end.
 */
export function MoreSheet({
  open,
  onClose,
  activeRole,
}: {
  open: boolean;
  onClose: () => void;
  activeRole?: string | null;
}) {
  return (
    <BottomSheet open={open} onClose={onClose} title="More" description="Everything else in the app">
      <div className="space-y-5 pb-2">
        <NavGroupList groups={groupsForRole(activeRole)} onNavigate={onClose} variant="sheet" />
      </div>
    </BottomSheet>
  );
}