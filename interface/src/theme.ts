/**
 * Minimal A2UI theme — just enough for Column / Row / Text / Card / our QuizCard.
 * Lifted from the personalized_learning sample's theme.ts.
 */

import { v0_8 } from "@a2ui/lit";

export const theme: v0_8.Types.Theme = {
  additionalStyles: {},
  components: {
    AudioPlayer: {},
    Button: {
      "layout-pt-2": true,
      "layout-pb-2": true,
      "layout-pl-3": true,
      "layout-pr-3": true,
      "border-br-12": true,
      "border-bw-0": true,
      "color-bgc-p30": true,
    },
    Card: { "border-br-9": true, "layout-p-4": true, "color-bgc-n100": true },
    CheckBox: { element: {}, label: {}, container: {} },
    Column: { "layout-g-2": true },
    DateTimeInput: { container: {}, label: {}, element: {} },
    Divider: {},
    Image: {
      all: { "border-br-5": true, "layout-w-100": true },
      avatar: {}, header: {}, icon: {},
      largeFeature: {}, mediumFeature: {}, smallFeature: {},
    },
    Icon: {},
    List: { "layout-g-4": true, "layout-p-2": true },
    Modal: { backdrop: {}, element: {} },
    MultipleChoice: { container: {}, label: {}, element: {} },
    Row: { "layout-g-4": true },
    Slider: { container: {}, label: {}, element: {} },
    Tabs: { container: {}, controls: { all: {}, selected: {} }, element: {} },
    Text: {
      all: { "layout-w-100": true },
      h1: { "typography-f-sf": true, "typography-w-400": true, "layout-m-0": true, "typography-sz-hs": true },
      h2: { "typography-f-sf": true, "typography-w-400": true, "layout-m-0": true, "typography-sz-tl": true },
      h3: { "typography-f-sf": true, "typography-w-400": true, "layout-m-0": true, "typography-sz-tl": true },
      h4: { "typography-f-sf": true, "typography-w-400": true, "layout-m-0": true, "typography-sz-bl": true },
      h5: { "typography-f-sf": true, "typography-w-400": true, "layout-m-0": true, "typography-sz-bm": true },
      body: {}, caption: {},
    },
    TextField: { container: {}, label: {}, element: {} },
    Video: { "border-br-5": true },
  },
  elements: {
    a: {}, audio: {}, body: {}, button: {},
    h1: {}, h2: {}, h3: {}, h4: {}, h5: {},
    iframe: {}, input: {}, p: {}, pre: {}, textarea: {}, video: {},
  },
  markdown: {
    p: [], h1: [], h2: [], h3: [], h4: [], h5: [],
    ul: [], ol: [], li: [], a: [], strong: [], em: [],
  },
};
