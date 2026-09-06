import type { Metadata } from "next";
import { listStoryTakedownRequests } from "@/lib/story/moderation";
import { TakedownQueue, type TakedownRequest } from "./takedown-queue";

export const metadata: Metadata = {
  title: "Takedown requests",
  robots: { index: false, follow: false },
};

// Staff content, always the caller's own current view -- never cached or
// pre-rendered, the same convention /moderation and /editorial already use.
export const dynamic = "force-dynamic";

export default async function TakedownsPage() {
  const requests = (await listStoryTakedownRequests()) as TakedownRequest[];

  return (
    // Same page wrapper as /moderation/reports and the stories queue. Without
    // it this page had NO horizontal padding at all: the heading and the
    // request cards ran flush to both viewport edges, which is what a
    // moderator saw the first time anyone opened it.
    <div className="mx-auto max-w-7xl space-y-4 px-4 py-12 sm:px-6 sm:py-16">
      <div>
        <h1 className="text-2xl font-semibold">Takedown requests</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          A contributor has asked for their published story to be removed. Until
          one of these is approved the story is still live — oldest first,
          because that is the one that has been public longest against its
          author&apos;s wishes.
        </p>
      </div>
      <TakedownQueue requests={requests} />
    </div>
  );
}
