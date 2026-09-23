// Composition only — "where and how", never "what" (that's each
// *.trim.ts file's job, never this one's). Group order and each group's
// control order are exactly this array's order: nothing here is resolved
// by sorting metadata at render time.
import { defineTrimConfig } from "@theharborproject/trim/react";
import { CustomContrast } from "./renderers/custom-contrast";

export default defineTrimConfig({
  layout: "sections",
  groups: [
    {
      id: "vision",
      label: "Vision",
      controls: [
        "theme", // bare id -> resolves to "theme.value", Trim's default segmented renderer
        { id: "contrast", component: CustomContrast }, // custom renderer override
        "animations", // is_unique: false — attached again below, in "motion"
      ],
    },
    {
      id: "motion",
      label: "Motion",
      controls: [
        "animations", // the SAME control, attached a second time — same binding, always in sync
      ],
    },
  ],
});
