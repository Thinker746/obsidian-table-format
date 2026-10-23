import { App, ButtonComponent, Modal, Setting } from "obsidian";
import { CellPos, MAX_SPLIT, MarkdownTable, MergeRegion, resolveSpans, splitCellBlocker } from "./table";

/** Asks how many rows and columns a cell should be split into. */
export class SplitCellModal extends Modal {
	private region: MergeRegion;
	private rows: number;
	private cols: number;
	private statusEl!: HTMLElement;
	private splitButton!: ButtonComponent;

	constructor(
		app: App,
		table: MarkdownTable,
		private cell: CellPos,
		private onSubmit: (rows: number, cols: number) => void,
	) {
		super(app);
		this.region = resolveSpans(table.rows).regionAt[cell.row][cell.col];
		const { rowspan, colspan } = this.region;
		this.rows = rowspan;
		this.cols = rowspan === 1 && colspan === 1 ? 2 : colspan;
	}

	onOpen(): void {
		this.titleEl.setText("分裂单元格");
		const { rowspan, colspan } = this.region;
		this.contentEl.createEl("p", {
			cls: "setting-item-description",
			text:
				(rowspan > 1 || colspan > 1 ? `这是一个 ${rowspan} 行 × ${colspan} 列的合并单元格。` : "") +
				"行数或列数不够时，会在表格中插入新行或新列，同一行、同一列的其他单元格自动合并，看起来不变。",
		});

		this.numberSetting("行数", this.rows, this.cell.row === 0, (v) => (this.rows = v));
		this.numberSetting("列数", this.cols, false, (v) => (this.cols = v));
		this.statusEl = this.contentEl.createDiv("table-format-status");

		new Setting(this.contentEl)
			.addButton((b) => {
				this.splitButton = b
					.setButtonText("分裂")
					.setCta()
					.onClick(() => this.submit());
			})
			.addButton((b) => b.setButtonText("取消").onClick(() => this.close()));

		this.scope.register([], "Enter", (evt) => {
			evt.preventDefault();
			this.submit();
			return false;
		});
		this.refresh();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private numberSetting(name: string, value: number, disabled: boolean, onChange: (v: number) => void): void {
		new Setting(this.contentEl).setName(name).addText((text) => {
			text.inputEl.type = "number";
			text.inputEl.min = "1";
			text.inputEl.max = String(MAX_SPLIT);
			text
				.setValue(String(value))
				.setDisabled(disabled)
				.onChange((v) => {
					onChange(v.trim() === "" ? NaN : Number(v));
					this.refresh();
				});
		});
	}

	private refresh(): void {
		const blocker = splitCellBlocker(this.cell, this.rows, this.cols);
		this.splitButton.setDisabled(blocker !== null);
		if (blocker) {
			this.statusEl.setText(blocker);
			return;
		}
		const addRows = Math.max(0, this.rows - this.region.rowspan);
		const addCols = Math.max(0, this.cols - this.region.colspan);
		const inserts = [addRows ? `${addRows} 行` : "", addCols ? `${addCols} 列` : ""].filter(Boolean);
		this.statusEl.setText(
			`分成 ${this.rows} 行 × ${this.cols} 列` + (inserts.length ? `，将插入 ${inserts.join("、")}` : ""),
		);
	}

	private submit(): void {
		if (splitCellBlocker(this.cell, this.rows, this.cols)) return;
		this.close();
		this.onSubmit(this.rows, this.cols);
	}
}
