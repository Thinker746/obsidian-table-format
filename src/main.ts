import {
	App,
	Editor,
	MarkdownFileInfo,
	MarkdownView,
	Menu,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	moment,
} from "obsidian";
import { MERGE_ICON, SPLIT_ICON, registerIcons } from "./icons";
import { selectedRange, tableEditorOf, tableOffset } from "./live-preview";
import { MergeAction, MergeCellsModal } from "./merge-modal";
import { applyMergedCells } from "./render";
import {
	CellRange,
	ContentJoin,
	MarkdownTable,
	canSplit,
	cellAt,
	chOfCell,
	expandRange,
	findTable,
	formatTable,
	lineOfRow,
	mergeBlocker,
	mergeRange,
	normalizeRange,
	resolveSpans,
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
		registerIcons();

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

		// The cell menu of the Live Preview table editor fires no workspace
		// event, so hook the contextmenu event itself in every window.
		this.registerDomEvent(document, "contextmenu", this.onContextMenu, { capture: true });
		this.registerEvent(
			this.app.workspace.on("window-open", (win) =>
				this.registerDomEvent(win.doc, "contextmenu", this.onContextMenu, { capture: true }),
			),
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
	 * Adds merge / split items to the menu Obsidian shows for selected cells in
	 * Live Preview. Obsidian builds that menu with `Menu.forEvent(evt)` while
	 * the event bubbles and shows it in a timeout; this capture listener runs
	 * first, so its timeout runs before the menu is shown and `Menu.forEvent`
	 * returns the same, already filled menu.
	 */
	private onContextMenu = (evt: MouseEvent): void => {
		const tableEl = tableEditorOf(evt.target);
		const cell = evt.target instanceof Element ? evt.target.closest("td, th") : null;
		if (!tableEl || !cell?.classList.contains("is-selected")) return;
		const range = selectedRange(tableEl);
		if (!range) return;

		const ctx = this.widgetTableContext(tableEl);
		if (!ctx) return;
		(evt.view ?? window).setTimeout(() => {
			if (evt.defaultPrevented) this.addCellMenuItems(Menu.forEvent(evt), ctx, range);
		});
	};

	private widgetTableContext(tableEl: HTMLTableElement): TableContext | null {
		const view = this.app.workspace
			.getLeavesOfType("markdown")
			.map((leaf) => leaf.view)
			.find((v): v is MarkdownView => v instanceof MarkdownView && v.containerEl.contains(tableEl));
		const offset = tableOffset(tableEl);
		if (!view || offset === null) return null;

		const editor = view.editor;
		const line = editor.offsetToPos(offset).line;
		// The widget may start on the line before the header row.
		for (const l of [line, line + 1]) {
			const table = findTable((n) => editor.getLine(n), editor.lineCount(), l);
			if (table?.startLine === l && table.rows.length === tableEl.rows.length) {
				return { editor, table, selection: null };
			}
		}
		return null;
	}

	private addCellMenuItems(menu: Menu, ctx: TableContext, range: CellRange): void {
		const zh = moment.locale().startsWith("zh");
		const layout = resolveSpans(ctx.table.rows);
		const rg = expandRange(layout, range);
		const blocker = mergeBlocker(rg);

		menu.addItem((item) =>
			item
				.setSection("table")
				.setIcon(MERGE_ICON)
				.setTitle(zh ? "合并单元格" : "Merge cells")
				.onClick(() => (blocker ? new Notice(blocker) : this.apply(ctx, "merge", rg, false))),
		);
		if (canSplit(layout, rg)) {
			menu.addItem((item) =>
				item
					.setSection("table")
					.setIcon(SPLIT_ICON)
					.setTitle(zh ? "拆分单元格" : "Split cells")
					.onClick(() => this.apply(ctx, "split", rg, false)),
			);
		}
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

	private apply(ctx: TableContext, action: MergeAction, range: CellRange, moveCursor = true): void {
		try {
			const next =
				action === "merge"
					? mergeRange(ctx.table, range, this.settings.contentJoin)
					: splitRange(ctx.table, range);
			this.write(ctx, next, moveCursor ? range : null, this.settings.alignOnEdit);
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
