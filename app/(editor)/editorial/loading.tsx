import { StaffDashboardSkeleton } from "@/components/ui/staff-dashboard-skeleton";

export default function EditorialLoading() {
  return (
    <StaffDashboardSkeleton
      label="Loading editorial queue"
      width="max-w-5xl"
      tiles={2}
      rows={8}
    />
  );
}
