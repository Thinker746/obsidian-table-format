import { App, ButtonComponent, Modal, Setting } from "obsidian";
import {
	CellPos,
	CellRange,
	MarkdownTable,
	SpanLayout,
	canSplit,
	expandRange,
	mergeBlocker,
	normalizeRange,
	resolveSpans,
} from "./table";

export type MergeAction = "merge" | "split";

const PREVIEW_LENGTH = 24;

/** Shows the table as a grid where cells are picked by dragging or Shift+click. */
export class MergeCellsModal extends Modal {
	private layout: SpanLayout;
	private anchor: CellPos;
	private focus: CellPos;
	private dragging = false;
	private cellEls: HTMLTableCellElement[] = [];
	private statusEl!: HTMLElement;
	private mergeButton!: ButtonComponent;
	private splitButton!: ButtonComponent;

	constructor(
		app: App,
		private table: MarkdownTable,
		initial: CellRange | null,
		private onSubmit: (action: MergeAction, range: CellRange) => void,
	) {
		super(app);
		this.layout = resolveSpans(table.rows);
		this.anchor = initial ? { row: initial.r0, col: initial.c0 } : { row: 0, col: 0 };
		this.focus = initial ? { row: initial.r1, col: initial.c1 } : { row: 0, col: 0 };
	}

	onOpen(): void {
		this.titleEl.setText("合并单元格");
		this.contentEl.addClass("table-format-modal");
		this.contentEl.createEl("p", {
			cls: "setting-item-description",
			text: "拖动鼠标(或手指)选择单元格，也可以先点一个单元格再按住 Shift 点另一个。",
		});

		const grid = this.contentEl.createDiv("table-format-grid").createEl("table");
		this.table.rows.forEach((row, r) => {
			const tr = grid.createEl("tr", { cls: r === 0 ? "is-header" : undefined });
			row.forEach((value, c) => {
				const role = this.layout.role[r][c];
				if (role === "covered") return;
				const { rowspan, colspan } = this.layout.regionAt[r][c];
				const td = tr.createEl("td", { text: role === "stray" ? "" : preview(value) });
				td.dataset.row = String(r);
				td.dataset.col = String(c);
				if (rowspan > 1) td.rowSpan = rowspan;
				if (colspan > 1) td.colSpan = colspan;
				if (rowspan > 1 || colspan > 1) td.addClass("is-merged");
				this.cellEls.push(td);
			});
		});

		grid.addEventListener("pointerdown", (evt) => {
			const pos = cellFromPoint(evt);
			if (!pos) return;
			evt.preventDefault();
			grid.setPointerCapture(evt.pointerId);
			if (!evt.shiftKey) this.anchor = pos;
			this.focus = pos;
			this.dragging = true;
			this.refresh();
		});
		grid.addEventListener("pointermove", (evt) => {
			if (!this.dragging) return;
			const pos = cellFromPoint(evt);
			if (pos && (pos.row !== this.focus.row || pos.col !== this.focus.col)) {
				this.focus = pos;
				this.refresh();
			}
		});
		const stop = () => (this.dragging = false);
		grid.addEventListener("pointerup", stop);
		grid.addEventListener("pointercancel", stop);

		this.statusEl = this.contentEl.createDiv("table-format-status");

		new Setting(this.contentEl)
			.addButton((b) => {
				this.mergeButton = b
					.setButtonText("合并")
					.setCta()
					.onClick(() => this.submit("merge"));
			})
			.addButton((b) => {
				this.splitButton = b.setButtonText("拆分").onClick(() => this.submit("split"));
			})
			.addButton((b) => b.setButtonText("取消").onClick(() => this.close()));

		this.refresh();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private range(): CellRange {
		return expandRange(this.layout, normalizeRange(this.anchor, this.focus));
	}

	private refresh(): void {
		const rg = this.range();
		for (const td of this.cellEls) {
			const r = Number(td.dataset.row);
			const c = Number(td.dataset.col);
			td.toggleClass("is-selected", r >= rg.r0 && r <= rg.r1 && c >= rg.c0 && c <= rg.c1);
		}
		const blocker = mergeBlocker(rg);
		const size = `已选择 ${rg.r1 - rg.r0 + 1} 行 × ${rg.c1 - rg.c0 + 1} 列`;
		this.statusEl.setText(blocker && !blocker.startsWith("请至少") ? `${size}：${blocker}` : size);
		this.mergeButton.setDisabled(blocker !== null);
		this.splitButton.setDisabled(!canSplit(this.layout, rg));
	}

	private submit(action: MergeAction): void {
		this.close();
		this.onSubmit(action, this.range());
	}
}

function preview(value: string): string {
	const v = value.trim();
	return v.length > PREVIEW_LENGTH ? v.slice(0, PREVIEW_LENGTH) + "…" : v;
}

function cellFromPoint(evt: PointerEvent): CellPos | null {
	const el = evt.view?.document.elementFromPoint(evt.clientX, evt.clientY);
	const td = el?.closest<HTMLElement>("td[data-row]");
	if (!td) return null;
	return { row: Number(td.dataset.row), col: Number(td.dataset.col) };
}
