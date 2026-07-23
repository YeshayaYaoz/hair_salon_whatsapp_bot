import { redirect } from "next/navigation";

// /dashboard has no view of its own — send it to the default landing page. Without this, anything
// that navigates to "/dashboard" (onboarding completion, some guards) hits a 404 since only the
// nested routes (/dashboard/analytics, /dashboard/whatsapp, …) have pages.
export default function DashboardIndex() {
  redirect("/dashboard/analytics");
}
