import { SpanLayout, resolveSpans } from "./table";

const PROCESSED = "data-table-format";
const MERGED = "table-format-merged";
const COVERED = "table-format-covered";

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
				if (colspan > 1 || rowspan > 1) cell.classList.add(MERGED);
			}
		}),
	);
	toRemove.forEach((cell) => cell.remove());
}

/** Text of a Live Preview cell; while a cell is edited its editor holds the current text. */
function liveCellText(cell: HTMLTableCellElement): string {
	const editing = cell.querySelector(".cm-content");
	if (editing) return editing.textContent ?? "";
	return cell.querySelector(".table-cell-wrapper")?.textContent ?? cell.textContent ?? "";
}

function setSpan(cell: HTMLTableCellElement, colspan: number, rowspan: number): void {
	if (cell.colSpan !== colspan) cell.colSpan = colspan;
	if (cell.rowSpan !== rowspan) cell.rowSpan = rowspan;
}

/**
 * Where a hidden cell would sit in the plain grid: its column edges come from
 * a visible single-column cell in the same column, its row edges from a
 * visible single-row cell in the same row, else the merged cell is divided
 * evenly.
 */
function slotRect(cells: HTMLTableCellElement[][], layout: SpanLayout, r: number, c: number): DOMRect {
	const reg = layout.regionAt[r][c];
	const merged = cells[reg.row][reg.col].getBoundingClientRect();
	const single = (rr: number, cc: number, key: "colspan" | "rowspan") =>
		layout.role[rr][cc] === "anchor" && layout.regionAt[rr][cc][key] === 1;

	const inColumn = cells.findIndex((_, rr) => single(rr, c, "colspan"));
	let left = merged.left + (merged.width / reg.colspan) * (c - reg.col);
	let right = left + merged.width / reg.colspan;
	if (inColumn >= 0) ({ left, right } = cells[inColumn][c].getBoundingClientRect());

	const inRow = cells[r].findIndex((_, cc) => single(r, cc, "rowspan"));
	let top = merged.top + (merged.height / reg.rowspan) * (r - reg.row);
	let bottom = top + merged.height / reg.rowspan;
	if (inRow >= 0) ({ top, bottom } = cells[r][inRow].getBoundingClientRect());

	return new DOMRect(left, top, right - left, bottom - top);
}

/**
 * Shows merges in Obsidian's Live Preview table editor. Unlike reading view
 * the cells stay in the DOM (the table editor keeps references to them), so
 * covered cells are only hidden. Can be re-run at any time; with `enabled`
 * false, or while a hidden cell is being edited, the plain grid is restored.
 *
 * The table editor finds cells by their client rects (drag selection, size
 * locking while editing) and stops searching at the first cell that is
 * farther away, so a hidden cell's zero rect would cut the search short.
 * Hidden cells therefore report the rect of their slot in the grid.
 */
export function applyLiveMergedCells(table: HTMLTableElement, enabled: boolean): void {
	const cells = cellsOf(table);
	const layout = resolveSpans(cells.map((row) => row.map(liveCellText)));
	const editingCovered = cells.some((row, r) =>
		row.some((cell, c) => layout.role[r][c] === "covered" && cell.querySelector(".cm-editor")),
	);
	const merge = enabled && !editingCovered;

	cells.forEach((row, r) =>
		row.forEach((cell, c) => {
			const role = layout.role[r][c];
			const { rowspan, colspan } = layout.regionAt[r][c];
			const anchor = merge && role === "anchor";
			setSpan(cell, anchor ? colspan : 1, anchor ? rowspan : 1);
			cell.classList.toggle(MERGED, anchor && (colspan > 1 || rowspan > 1));
			const covered = merge && role === "covered";
			cell.classList.toggle(COVERED, covered);
			if (covered) {
				Object.defineProperty(cell, "getBoundingClientRect", {
					configurable: true,
					value: () => slotRect(cells, layout, r, c),
				});
			} else if (Object.prototype.hasOwnProperty.call(cell, "getBoundingClientRect")) {
				delete (cell as { getBoundingClientRect?: unknown }).getBoundingClientRect;
			}
		}),
	);
}
