import { createFileRoute } from "@tanstack/react-router";

import { ThreadBoardPage, type ThreadBoardSearch } from "../components/board/ThreadBoardPage";

export const Route = createFileRoute("/_chat/board")({
  validateSearch: (raw: Record<string, unknown>): ThreadBoardSearch =>
    typeof raw.project === "string" && raw.project ? { project: raw.project.slice(0, 512) } : {},
  component: ThreadBoardPage,
});
