import { addIcon } from "obsidian";

// Lucide "table-cells-merge" / "table-cells-split" (ISC license). Obsidian only
// bundles them since 1.7, so they are registered here under our own ids.
// addIcon draws in a 100x100 box, hence the scale from Lucide's 24x24.
const LUCIDE_ATTRS =
	'transform="scale(4.1667)" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"';
const FRAME = '<path d="M3 9h18"/><path d="M3 15h18"/><rect x="3" y="3" width="18" height="18" rx="2"/>';

export const MERGE_ICON = "table-format-merge";
export const SPLIT_ICON = "table-format-split";
// Lucide "grid-2x2": a single cell divided into rows and columns.
export const SPLIT_CELL_ICON = "table-format-split-cell";

export function registerIcons(): void {
	addIcon(MERGE_ICON, `<g ${LUCIDE_ATTRS}><path d="M12 21v-6"/><path d="M12 9V3"/>${FRAME}</g>`);
	addIcon(SPLIT_ICON, `<g ${LUCIDE_ATTRS}><path d="M12 15V9"/>${FRAME}</g>`);
	addIcon(
		SPLIT_CELL_ICON,
		`<g ${LUCIDE_ATTRS}><path d="M12 3v18"/><path d="M3 12h18"/><rect x="3" y="3" width="18" height="18" rx="2"/></g>`,
	);
}
