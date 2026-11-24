import { type NavigationTab } from "./navigation-tab-order";
import { NativeStackScreenOptions } from "../../../native/StackHeader";
import { BoardScreen } from "../../board/BoardScreen";
import { UsageRouteScreen } from "../../usage/UsageRouteScreen";
import { WorkflowsScreen } from "../../workflows/WorkflowsScreen";

function ExtraTabScreen(props: { tab: Extract<NavigationTab, "usage" | "workflows" | "board"> }) {
  switch (props.tab) {
    case "board":
      return <BoardScreen />;
    case "workflows":
      return <WorkflowsScreen />;
    case "usage":
      return <UsageRouteScreen workspace />;
  }
}

export function WorkspaceExtraTab(props: {
  tab: Extract<NavigationTab, "usage" | "workflows" | "board">;
}) {
  return (
    <>
      <NativeStackScreenOptions options={{ headerSearchBarOptions: undefined }} />
      <ExtraTabScreen tab={props.tab} />
    </>
  );
}
