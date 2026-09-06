import { StaffDashboardSkeleton } from "@/components/ui/staff-dashboard-skeleton";

export default function ReadinessLoading() {
  return <StaffDashboardSkeleton label="Loading readiness checks" rows={8} />;
}
