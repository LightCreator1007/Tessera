// Old "my jobs" route; your jobs are the Yours scope of the jobs list.
import { redirect } from "next/navigation";

export default function Page() {
  redirect("/jobs?scope=yours");
}
