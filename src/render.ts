import { resolveSpans } from "./table";

const PROCESSED = "data-table-format";

function cellsOf(table: HTMLTableElement): HTMLTableCellElement[][] {
	const rows = Array.from(table.querySelectorAll<HTMLTableRowElement>(":scope > thead > tr, :scope > tbody > tr"));
	return rows.map((tr) =>
		Array.from(tr.children).filter(
			(el): el is HTMLTableCellElement => el.tagName === "TD" || el.tagName === "TH",
		),
	);
}

/** Turns `<` / `^` marker cells of a rendered table into colspan / rowspan. */
export function applyMergedCells(table: HTMLTableElement): void {
	if (table.hasAttribute(PROCESSED)) return;
	table.setAttribute(PROCESSED, "");

	const cells = cellsOf(table);
	const layout = resolveSpans(cells.map((row) => row.map((cell) => cell.textContent ?? "")));

	const toRemove: HTMLTableCellElement[] = [];
	cells.forEach((row, r) =>
		row.forEach((cell, c) => {
			const role = layout.role[r][c];
			if (role === "covered") {
				toRemove.push(cell);
			} else if (role === "stray") {
				cell.textContent = "";
			} else {
				const { rowspan, colspan } = layout.regionAt[r][c];
				if (colspan > 1) cell.colSpan = colspan;
				if (rowspan > 1) cell.rowSpan = rowspan;
				if (colspan > 1 || rowspan > 1) cell.classList.add("table-format-merged");
			}
		}),
	);
	toRemove.forEach((cell) => cell.remove());
}
