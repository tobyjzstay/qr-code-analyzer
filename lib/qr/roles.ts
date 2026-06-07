import type { ModuleRole } from "./types";

// The analyzer groups the fine-grained module roles into the six visible
// categories from Dan Hollick's QR explainer, using his exact colours: finder
// patterns are red, the alignment pattern pink, the timing pattern blue, the
// format information yellow, the message data green, and the error-correction
// codewords purple.
export type CategoryId =
  | "finder"
  | "alignment"
  | "timing"
  | "format"
  | "data"
  | "ec";

export interface Category {
  id: CategoryId;
  label: string;
  description: string;
  /** Colour for dark (set) modules. */
  dark: string;
  /** Pale tint for light (unset) modules, so the zone stays visible. */
  light: string;
}

export const CATEGORIES: Category[] = [
  {
    id: "finder",
    label: "Finder patterns",
    description: "The three corner squares that let a reader locate the code.",
    dark: "#ef4444",
    light: "#fde4e4",
  },
  {
    id: "alignment",
    label: "Alignment pattern",
    description:
      "Lets the reader determine orientation and correct for distortion.",
    dark: "#ec4899",
    light: "#fbdcef",
  },
  {
    id: "timing",
    label: "Timing pattern",
    description: "Determines the width and number of cells in the code.",
    dark: "#3b82f6",
    light: "#d7e6fd",
  },
  {
    id: "format",
    label: "Format info",
    description: "Stores the error-correction level and the mask pattern.",
    dark: "#f5c518",
    light: "#fbeeb4",
  },
  {
    id: "data",
    label: "Data",
    description: "The encoded message — mode, length, your bytes and padding.",
    dark: "#10b981",
    light: "#d4f4e7",
  },
  {
    id: "ec",
    label: "Error correction",
    description: "Reed-Solomon codewords that recover the code if it's damaged.",
    dark: "#a855f7",
    light: "#e9d6fc",
  },
];

const BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));

export function category(id: CategoryId): Category {
  return BY_ID.get(id)!;
}

/** Which legend category each module role belongs to. */
export const ROLE_CATEGORY: Record<ModuleRole, CategoryId> = {
  finder: "finder",
  separator: "finder",
  timing: "timing",
  alignment: "alignment",
  format: "format",
  version: "format",
  darkModule: "format",
  mode: "data",
  count: "data",
  message: "data",
  terminator: "data",
  padding: "data",
  ec: "ec",
  remainder: "data",
};

/** Fill colour for a module, based on its category and dark/light state. */
export function moduleColor(role: ModuleRole, dark: boolean): string {
  const c = category(ROLE_CATEGORY[role]);
  return dark ? c.dark : c.light;
}

/** Fine-grained label + description shown when inspecting a single module. */
export const ROLE_INFO: Record<ModuleRole, { label: string; description: string }> =
  {
    finder: { label: "Finder pattern", description: "Locates the code." },
    separator: {
      label: "Separator",
      description: "Light border isolating a finder pattern.",
    },
    timing: {
      label: "Timing pattern",
      description: "Calibrates the module grid.",
    },
    alignment: {
      label: "Alignment pattern",
      description: "Corrects for perspective distortion.",
    },
    format: {
      label: "Format information",
      description: "Error-correction level + mask pattern.",
    },
    version: {
      label: "Version information",
      description: "The symbol version (v7+).",
    },
    darkModule: {
      label: "Dark module",
      description: "A module that is always dark.",
    },
    mode: {
      label: "Mode indicator",
      description: "Says the data is encoded in byte mode.",
    },
    count: {
      label: "Character count",
      description: "How many bytes of data follow.",
    },
    message: { label: "Message data", description: "A byte of your input." },
    terminator: {
      label: "Terminator / pad bits",
      description: "End marker and zero padding.",
    },
    padding: {
      label: "Pad codeword",
      description: "Filler byte (0xEC / 0x11) using spare capacity.",
    },
    ec: {
      label: "Error-correction codeword",
      description: "Reed-Solomon recovery data.",
    },
    remainder: {
      label: "Remainder bit",
      description: "Leftover bit, not part of a codeword.",
    },
  };
