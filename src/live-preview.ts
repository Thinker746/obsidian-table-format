import { EditorView, ViewPlugin } from "@codemirror/view";
import { applyLiveMergedCells } from "./render";
import { CellRange } from "./table";

/**
 * Helpers for the table editor that Obsidian shows in Live Preview
 * (`table.table-editor`). Its rows are the Markdown rows in order (header
 * first, delimiter row omitted) and merged cells are only hidden, never
 * removed, so DOM indices are the same as Markdown cell indices. Selected
 * cells carry `is-selected`.
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

/**
 * Keeps merges visible in the Live Preview table editor. Obsidian re-renders
 * table widgets and cells outside of CodeMirror's update cycle, so the tables
 * are re-processed whenever the DOM below the editor changes. Only childList
 * and text changes are observed; the attribute changes made here do not
 * trigger the observer again.
 */
export function liveMergeExtension(enabled: () => boolean) {
	return ViewPlugin.fromClass(
		class {
			private observer: MutationObserver;
			private frame: number | null = null;

			constructor(private view: EditorView) {
				this.observer = new MutationObserver(() => {
					this.revealEditedCoveredCell();
					this.schedule();
				});
				this.observer.observe(view.contentDOM, { childList: true, subtree: true, characterData: true });
				this.schedule();
			}

			update(): void {
				this.schedule();
			}

			destroy(): void {
				this.observer.disconnect();
				if (this.frame !== null) cancelAnimationFrame(this.frame);
			}

			/**
			 * Keyboard navigation (Tab, arrows) can open a cell editor inside a
			 * hidden cell, where it cannot take focus. Show the plain grid at once
			 * and hand the editor the focus it missed.
			 */
			private revealEditedCoveredCell(): void {
				const editor = this.view.contentDOM.querySelector<HTMLElement>(
					"table.table-editor .table-format-covered .cm-editor",
				);
				const table = editor?.closest("table");
				if (!editor || !table) return;
				applyLiveMergedCells(table, enabled());
				EditorView.findFromDOM(editor)?.focus();
			}

			private schedule(): void {
				if (this.frame !== null) return;
				this.frame = requestAnimationFrame(() => {
					this.frame = null;
					const on = enabled();
					this.view.contentDOM
						.querySelectorAll<HTMLTableElement>("table.table-editor")
						.forEach((table) => applyLiveMergedCells(table, on));
				});
			}
		},
	);
}
