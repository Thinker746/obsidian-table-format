/**
 * Pure Markdown-table logic: parsing, merge layout, merge / split edits and
 * formatting. Nothing in here depends on Obsidian, so it can be unit tested.
 *
 * Merge syntax (compatible with plain Markdown):
 *   - a cell containing only `<` is merged into the cell on its left
 *   - a cell containing only `^` is merged into the cell above it
 * Merging a rectangle keeps the content in its top-left cell and writes `^`
 * into the rest of its first column and `<` into every other cell.
 */

export type Align = "left" | "center" | "right" | null;

export const MERGE_LEFT = "<";
export const MERGE_UP = "^";

export interface MarkdownTable {
	/** Line of the header row in the document. */
	startLine: number;
	/** Last line of the table in the document (inclusive). */
	endLine: number;
	/** Leading whitespace of the header row, kept when the table is rewritten. */
	indent: string;
	aligns: Align[];
	/** rows[0] is the header row, rows[1..] are the body rows. */
	rows: string[][];
}

export interface CellPos {
	row: number;
	col: number;
}

/** Inclusive, normalized (r0 <= r1, c0 <= c1) rectangle of cells. */
export interface CellRange {
	r0: number;
	c0: number;
	r1: number;
	c1: number;
}

export interface MergeRegion {
	row: number;
	col: number;
	rowspan: number;
	colspan: number;
}

/**
 * - anchor:  the visible cell of a region (possibly 1x1)
 * - covered: hidden inside another cell's region
 * - stray:   a `<` / `^` marker that points at a region it cannot extend
 *            (non-rectangular shape); rendered as an empty cell
 */
export type CellRole = "anchor" | "covered" | "stray";

export interface SpanLayout {
	rows: number;
	cols: number;
	role: CellRole[][];
	/** The region each cell belongs to (strays get their own 1x1 region). */
	regionAt: MergeRegion[][];
}

export type ContentJoin = "space" | "br" | "first";

// ---------------------------------------------------------------------------
// Parsing

/** Indices of the `|` characters that are not escaped with a backslash. */
function pipePositions(line: string): number[] {
	const out: number[] = [];
	for (let i = 0; i < line.length; i++) {
		if (line[i] === "\\") {
			i++;
			continue;
		}
		if (line[i] === "|") out.push(i);
	}
	return out;
}

function hasLeadingPipe(line: string): boolean {
	return line.trimStart().startsWith("|");
}

export function splitRow(line: string): string[] {
	const pipes = pipePositions(line);
	const bounds = [-1, ...pipes, line.length];
	const cells: string[] = [];
	for (let k = 0; k + 1 < bounds.length; k++) {
		cells.push(line.slice(bounds[k] + 1, bounds[k + 1]).trim());
	}
	const trimmedEnd = line.trimEnd().length;
	const trailing = pipes.length > 0 && pipes[pipes.length - 1] === trimmedEnd - 1;
	if (hasLeadingPipe(line)) cells.shift();
	if (trailing && cells.length > 0) cells.pop();
	return cells;
}

function isTableLine(line: string): boolean {
	return line.trim() !== "" && pipePositions(line).length > 0;
}

function parseAligns(cells: string[]): Align[] | null {
	if (cells.length === 0) return null;
	const aligns: Align[] = [];
	for (const raw of cells) {
		const cell = raw.replace(/\s+/g, "");
		if (!/^:?-+:?$/.test(cell)) return null;
		const left = cell.startsWith(":");
		const right = cell.endsWith(":");
		aligns.push(left && right ? "center" : right ? "right" : left ? "left" : null);
	}
	return aligns;
}

/** Finds the table that contains `lineNo`, or null if the line is not part of one. */
export function findTable(
	getLine: (line: number) => string,
	lineCount: number,
	lineNo: number,
): MarkdownTable | null {
	if (lineNo < 0 || lineNo >= lineCount || !isTableLine(getLine(lineNo))) return null;

	let start = lineNo;
	while (start > 0 && isTableLine(getLine(start - 1))) start--;
	let end = lineNo;
	while (end < lineCount - 1 && isTableLine(getLine(end + 1))) end++;

	for (let i = start + 1; i <= end; i++) {
		const aligns = parseAligns(splitRow(getLine(i)));
		const header = splitRow(getLine(i - 1));
		if (!aligns || aligns.length !== header.length) continue;
		if (lineNo < i - 1) return null;

		const rows = [header];
		for (let l = i + 1; l <= end; l++) rows.push(splitRow(getLine(l)));
		const cols = Math.max(aligns.length, ...rows.map((r) => r.length));
		for (const r of rows) while (r.length < cols) r.push("");
		while (aligns.length < cols) aligns.push(null);

		const headerLine = getLine(i - 1);
		return {
			startLine: i - 1,
			endLine: end,
			indent: headerLine.slice(0, headerLine.length - headerLine.trimStart().length),
			aligns,
			rows,
		};
	}
	return null;
}

/** Maps a document position to a table cell; null on the delimiter row or outside. */
export function cellAt(table: MarkdownTable, line: number, ch: number, lineText: string): CellPos | null {
	if (line < table.startLine || line > table.endLine || line === table.startLine + 1) return null;
	const row = line === table.startLine ? 0 : line - table.startLine - 1;
	let col = pipePositions(lineText).filter((p) => p < ch).length;
	if (hasLeadingPipe(lineText)) col -= 1;
	col = Math.min(Math.max(col, 0), table.aligns.length - 1);
	return { row, col };
}

// ---------------------------------------------------------------------------
// Merge layout

/**
 * Resolves `<` / `^` markers into merge regions. Row 0 is the header: it can
 * span columns but never rows, because HTML cannot span thead and tbody.
 */
export function resolveSpans(rows: string[][]): SpanLayout {
	const nRows = rows.length;
	const nCols = Math.max(0, ...rows.map((r) => r.length));
	const text = (r: number, c: number) => (rows[r][c] ?? "").trim();

	const owner: CellPos[][] = [];
	for (let r = 0; r < nRows; r++) {
		owner.push([]);
		for (let c = 0; c < nCols; c++) {
			const v = text(r, c);
			if (v === MERGE_LEFT && c > 0) owner[r].push(owner[r][c - 1]);
			else if (v === MERGE_UP && r > 1) owner[r].push(owner[r - 1][c]);
			else owner[r].push({ row: r, col: c });
		}
	}

	const role: CellRole[][] = owner.map((row) => row.map(() => "stray" as CellRole));
	const regionAt: MergeRegion[][] = owner.map((row, r) =>
		row.map((_, c) => ({ row: r, col: c, rowspan: 1, colspan: 1 })),
	);

	for (let r = 0; r < nRows; r++) {
		for (let c = 0; c < nCols; c++) {
			const anchor = owner[r][c];
			if (anchor.row !== r || anchor.col !== c) continue;

			let colspan = 1;
			while (c + colspan < nCols && owner[r][c + colspan] === anchor) colspan++;
			let rowspan = 1;
			while (
				r + rowspan < nRows &&
				owner[r + rowspan].slice(c, c + colspan).every((o) => o === anchor)
			) {
				rowspan++;
			}

			const region = { row: r, col: c, rowspan, colspan };
			for (let rr = r; rr < r + rowspan; rr++) {
				for (let cc = c; cc < c + colspan; cc++) {
					role[rr][cc] = rr === r && cc === c ? "anchor" : "covered";
					regionAt[rr][cc] = region;
				}
			}
		}
	}

	return { rows: nRows, cols: nCols, role, regionAt };
}

export function normalizeRange(a: CellPos, b: CellPos): CellRange {
	return {
		r0: Math.min(a.row, b.row),
		c0: Math.min(a.col, b.col),
		r1: Math.max(a.row, b.row),
		c1: Math.max(a.col, b.col),
	};
}

/** Grows a range until it fully contains every merged region it touches. */
export function expandRange(layout: SpanLayout, range: CellRange): CellRange {
	const rg = { ...range };
	let changed = true;
	while (changed) {
		changed = false;
		for (let r = rg.r0; r <= rg.r1; r++) {
			for (let c = rg.c0; c <= rg.c1; c++) {
				const reg = layout.regionAt[r][c];
				const r1 = reg.row + reg.rowspan - 1;
				const c1 = reg.col + reg.colspan - 1;
				if (reg.row < rg.r0 || reg.col < rg.c0 || r1 > rg.r1 || c1 > rg.c1) {
					rg.r0 = Math.min(rg.r0, reg.row);
					rg.c0 = Math.min(rg.c0, reg.col);
					rg.r1 = Math.max(rg.r1, r1);
					rg.c1 = Math.max(rg.c1, c1);
					changed = true;
				}
			}
		}
	}
	return rg;
}

/** Why a range cannot be merged, or null when it can. */
export function mergeBlocker(range: CellRange): string | null {
	if (range.r0 === range.r1 && range.c0 === range.c1) return "请至少选择两个单元格";
	if (range.r0 === 0 && range.r1 > 0) return "表头行不能与正文行纵向合并";
	return null;
}

export function canSplit(layout: SpanLayout, range: CellRange): boolean {
	for (let r = range.r0; r <= range.r1; r++) {
		for (let c = range.c0; c <= range.c1; c++) {
			const reg = layout.regionAt[r][c];
			if (reg.rowspan > 1 || reg.colspan > 1 || layout.role[r][c] === "stray") return true;
		}
	}
	return false;
}

// ---------------------------------------------------------------------------
// Edits (return a new table, never mutate the input)

function cloneTable(t: MarkdownTable): MarkdownTable {
	return { ...t, aligns: [...t.aligns], rows: t.rows.map((r) => [...r]) };
}

/**
 * Merges the cells in `range` (expanded to cover existing merges) into one.
 * Non-empty contents are joined into the top-left cell.
 */
export function mergeRange(t: MarkdownTable, range: CellRange, join: ContentJoin): MarkdownTable {
	const layout = resolveSpans(t.rows);
	const rg = expandRange(layout, range);
	const blocker = mergeBlocker(rg);
	if (blocker) throw new Error(blocker);

	const contents: string[] = [];
	for (let r = rg.r0; r <= rg.r1; r++) {
		for (let c = rg.c0; c <= rg.c1; c++) {
			const v = t.rows[r][c].trim();
			if (layout.role[r][c] === "anchor" && v !== "") contents.push(v);
		}
	}
	const merged =
		join === "first" ? contents[0] ?? "" : contents.join(join === "br" ? "<br>" : " ");

	const out = cloneTable(t);
	for (let r = rg.r0; r <= rg.r1; r++) {
		for (let c = rg.c0; c <= rg.c1; c++) {
			if (r === rg.r0 && c === rg.c0) out.rows[r][c] = merged;
			else if (c === rg.c0) out.rows[r][c] = MERGE_UP;
			else out.rows[r][c] = MERGE_LEFT;
		}
	}
	return out;
}

/** Splits every merged region touched by `range` back into single cells. */
export function splitRange(t: MarkdownTable, range: CellRange): MarkdownTable {
	const layout = resolveSpans(t.rows);
	const out = cloneTable(t);
	for (let r = range.r0; r <= range.r1; r++) {
		for (let c = range.c0; c <= range.c1; c++) {
			if (layout.role[r][c] === "stray") out.rows[r][c] = "";
			const reg = layout.regionAt[r][c];
			for (let rr = reg.row; rr < reg.row + reg.rowspan; rr++) {
				for (let cc = reg.col; cc < reg.col + reg.colspan; cc++) {
					if (rr !== reg.row || cc !== reg.col) out.rows[rr][cc] = "";
				}
			}
		}
	}
	return out;
}

// ---------------------------------------------------------------------------
// Formatting

function isZeroWidth(cp: number): boolean {
	return (
		(cp >= 0x0300 && cp <= 0x036f) ||
		(cp >= 0x200b && cp <= 0x200f) ||
		(cp >= 0x20d0 && cp <= 0x20ff) ||
		(cp >= 0xfe00 && cp <= 0xfe0f)
	);
}

function isWide(cp: number): boolean {
	return (
		(cp >= 0x1100 && cp <= 0x115f) ||
		(cp >= 0x2e80 && cp <= 0x303e) ||
		(cp >= 0x3041 && cp <= 0x33ff) ||
		(cp >= 0x3400 && cp <= 0x4dbf) ||
		(cp >= 0x4e00 && cp <= 0x9fff) ||
		(cp >= 0xa000 && cp <= 0xa4cf) ||
		(cp >= 0xac00 && cp <= 0xd7a3) ||
		(cp >= 0xf900 && cp <= 0xfaff) ||
		(cp >= 0xfe30 && cp <= 0xfe4f) ||
		(cp >= 0xff00 && cp <= 0xff60) ||
		(cp >= 0xffe0 && cp <= 0xffe6) ||
		(cp >= 0x1f300 && cp <= 0x1f64f) ||
		(cp >= 0x1f900 && cp <= 0x1f9ff) ||
		(cp >= 0x20000 && cp <= 0x3fffd)
	);
}

/** Monospace display width: CJK and full-width characters count as 2. */
export function displayWidth(s: string): number {
	let w = 0;
	for (const ch of s) {
		const cp = ch.codePointAt(0) as number;
		if (!isZeroWidth(cp)) w += isWide(cp) ? 2 : 1;
	}
	return w;
}

function padCell(s: string, width: number, align: Align): string {
	const gap = width - displayWidth(s);
	if (gap <= 0) return s;
	if (align === "right") return " ".repeat(gap) + s;
	if (align === "center") {
		const left = Math.floor(gap / 2);
		return " ".repeat(left) + s + " ".repeat(gap - left);
	}
	return s + " ".repeat(gap);
}

function delimiterCell(width: number, align: Align): string {
	if (align === "center") return ":" + "-".repeat(width - 2) + ":";
	if (align === "left") return ":" + "-".repeat(width - 1);
	if (align === "right") return "-".repeat(width - 1) + ":";
	return "-".repeat(width);
}

/** Serializes a table; with `align` the columns are padded to equal width. */
export function formatTable(t: MarkdownTable, align = true): string[] {
	const cols = t.aligns.length;
	const widths: number[] = [];
	for (let c = 0; c < cols; c++) {
		widths.push(align ? Math.max(3, ...t.rows.map((r) => displayWidth(r[c] ?? ""))) : 3);
	}
	const row = (cells: string[]) =>
		t.indent +
		"| " +
		widths.map((w, c) => (align ? padCell(cells[c] ?? "", w, t.aligns[c]) : cells[c] ?? "")).join(" | ") +
		" |";
	const delimiter = t.indent + "| " + widths.map((w, c) => delimiterCell(w, t.aligns[c])).join(" | ") + " |";
	return [row(t.rows[0]), delimiter, ...t.rows.slice(1).map(row)];
}

/** Document line of a table row (row 0 is the header, the delimiter is skipped). */
export function lineOfRow(t: MarkdownTable, row: number): number {
	return row === 0 ? t.startLine : t.startLine + row + 1;
}

/** Character offset of the start of a cell's content in a formatted row line. */
export function chOfCell(lineText: string, col: number): number {
	const pipes = pipePositions(lineText);
	const pipe = pipes[hasLeadingPipe(lineText) ? col : col - 1];
	return pipe === undefined ? 0 : Math.min(pipe + 2, lineText.length);
}
