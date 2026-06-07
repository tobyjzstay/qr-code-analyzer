import type { ModuleRole } from "./types";

export interface RoleStyle {
  /** Colour for dark (set) modules. */
  dark: string;
  /** Colour for light (unset) modules — a pale tint so the zone is visible. */
  light: string;
  /** Short label for the legend. */
  label: string;
  /** One-line explanation of what this part of the symbol does. */
  description: string;
  /** Grouping for the legend. */
  group: "function" | "encoding";
}

// Colours follow Dan Hollick's QR explainer where it shows them: the message
// bytes are mint green and the mode/length header is blue. Error correction
// takes the violet from his "data region" view; the remaining function
// patterns each get a distinct hue so every part of the symbol is legible.
export const ROLE_STYLES: Record<ModuleRole, RoleStyle> = {
  finder: {
    dark: "#0f172a",
    light: "#e2e8f0",
    label: "Finder pattern",
    description:
      "Three corner squares a scanner uses to locate and orient the code.",
    group: "function",
  },
  separator: {
    dark: "#94a3b8",
    light: "#f1f5f9",
    label: "Separator",
    description: "One-module light border isolating each finder pattern.",
    group: "function",
  },
  timing: {
    dark: "#b45309",
    light: "#fde68a",
    label: "Timing pattern",
    description:
      "Alternating row and column that lets a scanner count the module grid.",
    group: "function",
  },
  alignment: {
    dark: "#c2410c",
    light: "#fed7aa",
    label: "Alignment pattern",
    description:
      "Smaller squares (version 2+) that correct for perspective distortion.",
    group: "function",
  },
  format: {
    dark: "#be185d",
    light: "#fbcfe8",
    label: "Format information",
    description:
      "Error-correction level and mask pattern, protected by a BCH code.",
    group: "function",
  },
  version: {
    dark: "#0f766e",
    light: "#99f6e4",
    label: "Version information",
    description: "The symbol version, present only on version 7 and larger.",
    group: "function",
  },
  darkModule: {
    dark: "#111827",
    light: "#111827",
    label: "Dark module",
    description: "A single module that is always dark, next to a finder.",
    group: "function",
  },
  mode: {
    dark: "#4338ca",
    light: "#c7d2fe",
    label: "Mode indicator",
    description: "Four bits saying how the data is encoded (here: byte mode).",
    group: "encoding",
  },
  count: {
    dark: "#1d4ed8",
    light: "#bfdbfe",
    label: "Character count",
    description: "How many characters of data follow the mode indicator.",
    group: "encoding",
  },
  message: {
    dark: "#047857",
    light: "#a7f3d0",
    label: "Message data",
    description: "The actual bytes of your input, one character per 8 bits.",
    group: "encoding",
  },
  terminator: {
    dark: "#475569",
    light: "#e2e8f0",
    label: "Terminator / pad bits",
    description: "End marker plus zero bits filling out to a byte boundary.",
    group: "encoding",
  },
  padding: {
    dark: "#737373",
    light: "#e7e5e4",
    label: "Pad codewords",
    description: "Filler bytes (0xEC / 0x11) that use up any spare capacity.",
    group: "encoding",
  },
  ec: {
    dark: "#7c3aed",
    light: "#ddd6fe",
    label: "Error correction",
    description:
      "Reed-Solomon codewords that let the code be read even if damaged.",
    group: "encoding",
  },
  remainder: {
    dark: "#cbd5e1",
    light: "#f8fafc",
    label: "Remainder bits",
    description: "Leftover bits that don't make up a full codeword.",
    group: "encoding",
  },
};

/** Roles in the order they should appear in the legend. */
export const ROLE_ORDER: ModuleRole[] = [
  "finder",
  "separator",
  "timing",
  "alignment",
  "format",
  "version",
  "darkModule",
  "mode",
  "count",
  "message",
  "terminator",
  "padding",
  "ec",
  "remainder",
];
