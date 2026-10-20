import { App, Editor, MarkdownFileInfo, MarkdownView, Notice, Plugin, PluginSettingTab, Setting } from "obsidian";
import { MergeAction, MergeCellsModal } from "./merge-modal";
import { applyMergedCells } from "./render";
import {
	CellRange,
	ContentJoin,
	MarkdownTable,
	cellAt,
	chOfCell,
	findTable,
	formatTable,
	lineOfRow,
	mergeRange,
	normalizeRange,
	splitRange,
} from "./table";

interface TableFormatSettings {
	contentJoin: ContentJoin;
	alignOnEdit: boolean;
}

const DEFAULT_SETTINGS: TableFormatSettings = {
	contentJoin: "space",
	alignOnEdit: true,
};

interface TableContext {
	editor: Editor;
	table: MarkdownTable;
	/** The cells covered by the editor selection, or null if it is on the delimiter row. */
	selection: CellRange | null;
}

export default class TableFormatPlugin extends Plugin {
	settings: TableFormatSettings = DEFAULT_SETTINGS;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.registerMarkdownPostProcessor((el) => {
			el.querySelectorAll("table").forEach(applyMergedCells);
		});

		this.addCommand({
			id: "merge-selected-cells",
			name: "合并选中的单元格",
			editorCheckCallback: (checking, editor, info) => {
				const ctx = this.tableContext(editor, info);
				if (!ctx) return false;
				if (!checking) this.mergeFromSelection(ctx);
				return true;
			},
		});

		this.addCommand({
			id: "open-merge-panel",
			name: "打开单元格合并面板",
			editorCheckCallback: (checking, editor, info) => {
				const ctx = this.tableContext(editor, info);
				if (!ctx) return false;
				if (!checking) this.openPanel(ctx);
				return true;
			},
		});

		this.addCommand({
			id: "split-cells",
			name: "拆分单元格(取消合并)",
			editorCheckCallback: (checking, editor, info) => {
				const ctx = this.tableContext(editor, info);
				if (!ctx?.selection) return false;
				if (!checking) this.apply(ctx, "split", ctx.selection);
				return true;
			},
		});

		this.addCommand({
			id: "format-table",
			name: "对齐表格列宽",
			editorCheckCallback: (checking, editor, info) => {
				const ctx = this.tableContext(editor, info);
				if (!ctx) return false;
				if (!checking) this.write(ctx, ctx.table, null, true);
				return true;
			},
		});

		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu, editor, info) => {
				const ctx = this.tableContext(editor, info);
				if (!ctx) return;
				menu.addItem((item) =>
					item
						.setTitle("合并单元格…")
						.setIcon("table")
						.onClick(() => this.openPanel(ctx)),
				);
			}),
		);

		this.addSettingTab(new TableFormatSettingTab(this.app, this));
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/**
	 * Locates the table under the cursor. In Live Preview a command may receive
	 * the editor of a single table cell, so positions are read from the note's
	 * main editor instead.
	 */
	private tableContext(editor: Editor, info: MarkdownView | MarkdownFileInfo): TableContext | null {
		const main = info instanceof MarkdownView ? info.editor : editor;
		const sel = main.listSelections()[0];
		if (!sel) return null;
		const table = findTable((l) => main.getLine(l), main.lineCount(), sel.head.line);
		if (!table) return null;

		const a = cellAt(table, sel.anchor.line, sel.anchor.ch, main.getLine(sel.anchor.line));
		const h = cellAt(table, sel.head.line, sel.head.ch, main.getLine(sel.head.line));
		const one = a ?? h;
		const selection = a && h ? normalizeRange(a, h) : one ? normalizeRange(one, one) : null;
		return { editor: main, table, selection };
	}

	private mergeFromSelection(ctx: TableContext): void {
		const sel = ctx.selection;
		if (sel && (sel.r0 !== sel.r1 || sel.c0 !== sel.c1)) this.apply(ctx, "merge", sel);
		else this.openPanel(ctx);
	}

	private openPanel(ctx: TableContext): void {
		new MergeCellsModal(this.app, ctx.table, ctx.selection, (action, range) =>
			this.apply(ctx, action, range),
		).open();
	}

	private apply(ctx: TableContext, action: MergeAction, range: CellRange): void {
		try {
			const next =
				action === "merge"
					? mergeRange(ctx.table, range, this.settings.contentJoin)
					: splitRange(ctx.table, range);
			this.write(ctx, next, range, this.settings.alignOnEdit);
		} catch (e) {
			new Notice(e instanceof Error ? e.message : String(e));
		}
	}

	private write(ctx: TableContext, next: MarkdownTable, range: CellRange | null, align: boolean): void {
		const { editor, table } = ctx;
		// Re-read the table: the document may have changed while the panel was open.
		const current = findTable((l) => editor.getLine(l), editor.lineCount(), table.startLine);
		if (!current || current.endLine !== table.endLine || JSON.stringify(current.rows) !== JSON.stringify(table.rows)) {
			new Notice("表格内容已变化，请重新操作");
			return;
		}

		editor.replaceRange(
			formatTable(next, align).join("\n"),
			{ line: table.startLine, ch: 0 },
			{ line: table.endLine, ch: editor.getLine(table.endLine).length },
		);
		if (range) {
			const line = lineOfRow(next, range.r0);
			editor.setCursor({ line, ch: chOfCell(editor.getLine(line), range.c0) });
		}
	}
}

class TableFormatSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: TableFormatPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("合并时的内容处理")
			.setDesc("被合并的单元格里已有文字时，如何放进合并后的单元格。")
			.addDropdown((d) =>
				d
					.addOption("space", "用空格拼接")
					.addOption("br", "换行拼接(<br>)")
					.addOption("first", "只保留左上角单元格")
					.setValue(this.plugin.settings.contentJoin)
					.onChange(async (v) => {
						this.plugin.settings.contentJoin = v as ContentJoin;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("合并后对齐列宽")
			.setDesc("合并或拆分后自动补齐空格，让源码里的表格列对齐(中文按两个字符宽度计算)。")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.alignOnEdit).onChange(async (v) => {
					this.plugin.settings.alignOnEdit = v;
					await this.plugin.saveSettings();
				}),
			);
	}
}
