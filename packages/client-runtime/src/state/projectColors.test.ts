import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  planProjectColorWrites,
  resolveProjectRefsColor,
  resolveThreadProjectColor,
} from "./projectColors.ts";

const LAPTOP = EnvironmentId.make("laptop");
const SERVER = EnvironmentId.make("server");
const APP = ProjectId.make("app");
const DOCS = ProjectId.make("docs");

describe("project colors", () => {
  it("colors a thread with its project's color on its own machine", () => {
    const colors = new Map([[LAPTOP, { [APP]: "violet" as const }]]);
    expect(resolveThreadProjectColor({ environmentId: LAPTOP, projectId: APP }, colors)).toBe(
      "violet",
    );
    expect(resolveThreadProjectColor({ environmentId: SERVER, projectId: APP }, colors)).toBe(null);
    expect(
      resolveProjectRefsColor(
        [
          { environmentId: SERVER, projectId: APP },
          { environmentId: LAPTOP, projectId: APP },
        ],
        colors,
      ),
    ).toBe("violet");
  });

  it("writes the color on every machine of the project and keeps the other projects", () => {
    const colors = new Map([[LAPTOP, { [DOCS]: "teal" as const }]]);
    const writes = planProjectColorWrites({
      projectRefs: [
        { environmentId: LAPTOP, projectId: APP },
        { environmentId: SERVER, projectId: APP },
      ],
      color: "rose",
      colors,
    });
    expect(writes).toEqual([
      { environmentId: LAPTOP, patch: { projectColors: { [DOCS]: "teal", [APP]: "rose" } } },
      { environmentId: SERVER, patch: { projectColors: { [APP]: "rose" } } },
    ]);
  });

  it("removes the color when none is picked", () => {
    const colors = new Map([[LAPTOP, { [APP]: "rose" as const, [DOCS]: "teal" as const }]]);
    expect(
      planProjectColorWrites({
        projectRefs: [{ environmentId: LAPTOP, projectId: APP }],
        color: null,
        colors,
      }),
    ).toEqual([{ environmentId: LAPTOP, patch: { projectColors: { [DOCS]: "teal" } } }]);
  });
});
