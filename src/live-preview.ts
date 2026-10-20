import { EditorView } from "@codemirror/view";
import { CellRange } from "./table";

/**
 * Helpers for the table editor that Obsidian shows in Live Preview
 * (`table.table-editor`). Its rows are the Markdown rows in order (header
 * first, delimiter row omitted) and it never uses colspan, so DOM indices are
 * the same as Markdown cell indices. Selected cells carry `is-selected`.
 */

export function tableEditorOf(target: EventTarget | null): HTMLTableElement | null {
	if (!(target instanceof Element)) return null;
	return target.closest<HTMLTableElement>("table.table-editor");
}

/** Bounds of the selected cells, or null when fewer than two are selected. */
export function selectedRange(table: HTMLTableElement): CellRange | null {
	let r0 = Infinity;
	let c0 = Infinity;
	let r1 = -1;
	let c1 = -1;
	let count = 0;
	Array.from(table.rows).forEach((tr, r) =>
		Array.from(tr.cells).forEach((cell, c) => {
			if (!cell.classList.contains("is-selected")) return;
			count++;
			r0 = Math.min(r0, r);
			c0 = Math.min(c0, c);
			r1 = Math.max(r1, r);
			c1 = Math.max(c1, c);
		}),
	);
	return count >= 2 ? { r0, c0, r1, c1 } : null;
}

/** Document offset where the table widget starts, or null if it is not in an editor. */
export function tableOffset(table: HTMLTableElement): number | null {
	const root = table.closest<HTMLElement>(".cm-editor");
	const view = root && EditorView.findFromDOM(root);
	if (!view) return null;
	try {
		return view.posAtDOM(table);
	} catch {
		return null;
	}
}
