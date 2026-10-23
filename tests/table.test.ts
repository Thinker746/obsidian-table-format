import { test } from "node:test";
import assert from "node:assert/strict";
import {
	MarkdownTable,
	canUnsplit,
	cellAt,
	displayWidth,
	expandRange,
	findTable,
	formatTable,
	mergeRange,
	resolveSpans,
	splitCell,
	unmergeRange,
	splitRow,
	unsplitRange,
} from "../src/table";

function parse(md: string, lineNo = 0): MarkdownTable {
	const lines = md.split("\n");
	const t = findTable((l) => lines[l], lines.length, lineNo);
	assert.ok(t, "table not found");
	return t;
}

const SAMPLE = [
	"| A | B | C |",
	"| --- | :-: | --: |",
	"| 1 | 2 | 3 |",
	"| 4 | 5 | 6 |",
	"| 7 | 8 | 9 |",
].join("\n");

test("splitRow handles optional outer pipes and escaped pipes", () => {
	assert.deepEqual(splitRow("| a | b |"), ["a", "b"]);
	assert.deepEqual(splitRow("a | b"), ["a", "b"]);
	assert.deepEqual(splitRow("| [[note\\|alias]] | x |"), ["[[note\\|alias]]", "x"]);
	assert.deepEqual(splitRow("| a |  |"), ["a", ""]);
});

test("findTable locates the table from any row and rejects the line above it", () => {
	const md = "intro | not a table\n\n" + SAMPLE + "\n\nafter";
	const lines = md.split("\n");
	const t = findTable((l) => lines[l], lines.length, 5);
	assert.ok(t);
	assert.equal(t.startLine, 2);
	assert.equal(t.endLine, 6);
	assert.deepEqual(t.aligns, [null, "center", "right"]);
	assert.equal(findTable((l) => lines[l], lines.length, 0), null);
	assert.equal(findTable((l) => lines[l], lines.length, 8), null);
});

test("cellAt maps positions to cells and skips the delimiter row", () => {
	const t = parse(SAMPLE);
	const line = "| 1 | 2 | 3 |";
	assert.deepEqual(cellAt(t, 2, 2, line), { row: 1, col: 0 });
	assert.deepEqual(cellAt(t, 2, 6, line), { row: 1, col: 1 });
	assert.deepEqual(cellAt(t, 2, line.length, line), { row: 1, col: 2 });
	assert.equal(cellAt(t, 1, 3, "| --- | :-: | --: |"), null);
});

test("mergeRange writes ^ in the first column and < elsewhere", () => {
	const t = parse(SAMPLE);
	const out = mergeRange(t, { r0: 1, c0: 0, r1: 2, c1: 1 }, "space");
	assert.deepEqual(out.rows.slice(1), [
		["1 2 4 5", "<", "3"],
		["^", "<", "6"],
		["7", "8", "9"],
	]);
	assert.deepEqual(t.rows[1], ["1", "2", "3"], "input must not be mutated");
});

test("content join modes", () => {
	const t = parse(SAMPLE);
	const rg = { r0: 1, c0: 0, r1: 1, c1: 1 };
	assert.equal(mergeRange(t, rg, "br").rows[1][0], "1<br>2");
	assert.equal(mergeRange(t, rg, "first").rows[1][0], "1");
});

test("header can span columns but not rows", () => {
	const t = parse(SAMPLE);
	assert.deepEqual(mergeRange(t, { r0: 0, c0: 0, r1: 0, c1: 2 }, "space").rows[0], ["A B C", "<", "<"]);
	assert.throws(() => mergeRange(t, { r0: 0, c0: 0, r1: 1, c1: 0 }, "space"), /表头/);
	assert.throws(() => mergeRange(t, { r0: 1, c0: 1, r1: 1, c1: 1 }, "space"), /两个/);
});

test("resolveSpans computes rowspan / colspan", () => {
	const layout = resolveSpans([
		["H1", "<", "H3"],
		["a", "<", "b"],
		["^", "<", "^"],
		["c", "d", "e"],
	]);
	assert.deepEqual(layout.regionAt[0][0], { row: 0, col: 0, rowspan: 1, colspan: 2 });
	assert.deepEqual(layout.regionAt[2][1], { row: 1, col: 0, rowspan: 2, colspan: 2 });
	assert.deepEqual(layout.regionAt[1][2], { row: 1, col: 2, rowspan: 2, colspan: 1 });
	assert.equal(layout.role[2][0], "covered");
	assert.equal(layout.role[3][1], "anchor");
});

test("markers that cannot merge are literal or stray", () => {
	const layout = resolveSpans([
		["<", "H"],
		["^", "x"],
		["a", "<"],
		["b", "^"],
	]);
	assert.equal(layout.role[0][0], "anchor", "`<` in the first column is literal");
	assert.equal(layout.role[1][0], "anchor", "`^` cannot reach into the header");
	// (3,1) points up into the 1x2 region of row 2, which cannot grow to an L shape.
	assert.equal(layout.role[3][1], "stray");
});

test("expandRange grows to include touched merges, merging over merges works", () => {
	let t = parse(SAMPLE);
	t = mergeRange(t, { r0: 1, c0: 0, r1: 2, c1: 0 }, "space");
	const layout = resolveSpans(t.rows);
	assert.deepEqual(expandRange(layout, { r0: 2, c0: 0, r1: 2, c1: 1 }), { r0: 1, c0: 0, r1: 2, c1: 1 });

	t = mergeRange(t, { r0: 2, c0: 0, r1: 2, c1: 1 }, "space");
	assert.deepEqual(t.rows.slice(1, 3), [
		["1 4 2 5", "<", "3"],
		["^", "<", "6"],
	]);
});

test("unmergeRange clears markers of touched regions", () => {
	let t = parse(SAMPLE);
	t = mergeRange(t, { r0: 1, c0: 0, r1: 2, c1: 1 }, "space");
	const out = unmergeRange(t, { r0: 2, c0: 1, r1: 2, c1: 1 });
	assert.deepEqual(out.rows.slice(1, 3), [
		["1 2 4 5", "", "3"],
		["", "", "6"],
	]);
});

test("splitCell into columns inserts columns the other rows span", () => {
	const t = parse(SAMPLE);
	const out = splitCell(t, { row: 2, col: 1 }, 1, 3);
	assert.deepEqual(out.aligns, [null, "center", "center", "center", "right"]);
	assert.deepEqual(out.rows, [
		["A", "B", "<", "<", "C"],
		["1", "2", "<", "<", "3"],
		["4", "5", "", "", "6"],
		["7", "8", "<", "<", "9"],
	]);
	const layout = resolveSpans(out.rows);
	assert.deepEqual(layout.regionAt[0][1], { row: 0, col: 1, rowspan: 1, colspan: 3 });
	assert.equal(out.endLine, t.endLine);
});

test("splitCell into rows inserts rows the other columns span", () => {
	const t = parse(SAMPLE);
	const out = splitCell(t, { row: 1, col: 2 }, 2, 1);
	assert.deepEqual(out.rows.slice(1), [
		["1", "2", "3"],
		["^", "^", ""],
		["4", "5", "6"],
		["7", "8", "9"],
	]);
	assert.equal(out.endLine, t.endLine + 1);
	assert.deepEqual(resolveSpans(out.rows).regionAt[2][0], { row: 1, col: 0, rowspan: 2, colspan: 1 });
});

test("splitCell into rows and columns keeps existing merges intact", () => {
	let t = parse(SAMPLE);
	t = mergeRange(t, { r0: 1, c0: 1, r1: 1, c1: 2 }, "space");
	const out = splitCell(t, { row: 2, col: 0 }, 2, 2);
	assert.deepEqual(out.rows, [
		["A", "<", "B", "C"],
		["1", "<", "2 3", "<"],
		["4", "", "5", "6"],
		["", "", "^", "^"],
		["7", "<", "8", "9"],
	]);
	const layout = resolveSpans(out.rows);
	assert.deepEqual(layout.regionAt[1][2], { row: 1, col: 2, rowspan: 1, colspan: 2 });
	assert.deepEqual(layout.regionAt[3][3], { row: 2, col: 3, rowspan: 2, colspan: 1 });
	assert.equal(layout.role[3][0], "anchor");
});

test("splitCell redistributes a merged cell without inserting when it is large enough", () => {
	let t = parse(SAMPLE);
	t = mergeRange(t, { r0: 1, c0: 0, r1: 3, c1: 2 }, "first");
	const out = splitCell(t, { row: 2, col: 1 }, 2, 3);
	assert.deepEqual(out.rows.slice(1), [
		["1", "", ""],
		["^", "^", "^"],
		["", "", ""],
	]);
	assert.equal(out.aligns.length, 3);
});

test("splitCell validates its input", () => {
	const t = parse(SAMPLE);
	assert.deepEqual(splitCell(t, { row: 0, col: 0 }, 1, 2).rows[0], ["A", "", "B", "C"]);
	assert.throws(() => splitCell(t, { row: 0, col: 0 }, 2, 1), /表头/);
	assert.throws(() => splitCell(t, { row: 1, col: 0 }, 1, 1), /两个/);
	assert.throws(() => splitCell(t, { row: 1, col: 0 }, 0, 2), /正整数/);
	assert.throws(() => splitCell(t, { row: 1, col: 0 }, 1, 21), /20/);
});

test("unsplitRange restores the table from before splitCell", () => {
	const t = parse(SAMPLE);
	const merged = mergeRange(t, { r0: 1, c0: 1, r1: 1, c1: 2 }, "space");
	const cases: [MarkdownTable, number, number, number, number, { r0: number; c0: number; r1: number; c1: number }][] = [
		[t, 2, 1, 1, 3, { r0: 2, c0: 1, r1: 2, c1: 3 }],
		[t, 1, 2, 2, 1, { r0: 1, c0: 2, r1: 2, c1: 2 }],
		[t, 0, 0, 1, 2, { r0: 0, c0: 0, r1: 0, c1: 1 }],
		[merged, 2, 0, 2, 2, { r0: 2, c0: 0, r1: 3, c1: 1 }],
		[t, 3, 2, 3, 4, { r0: 3, c0: 2, r1: 5, c1: 5 }],
	];
	for (const [table, row, col, rows, cols, block] of cases) {
		const split = splitCell(table, { row, col }, rows, cols);
		assert.ok(canUnsplit(split, block));
		const back = unsplitRange(split, block, "space");
		assert.deepEqual(back.rows, table.rows);
		assert.deepEqual(back.aligns, table.aligns);
		assert.equal(back.endLine, table.endLine);
	}
});

test("unsplitRange joins typed content and can undo part of a split", () => {
	const split = splitCell(parse(SAMPLE), { row: 2, col: 1 }, 1, 3);
	split.rows[2][2] = "x";
	assert.equal(unsplitRange(split, { r0: 2, c0: 1, r1: 2, c1: 3 }, "space").rows[2][1], "5 x");

	const partial = unsplitRange(split, { r0: 2, c0: 2, r1: 2, c1: 3 }, "space");
	assert.deepEqual(partial.rows, [
		["A", "B", "<", "C"],
		["1", "2", "<", "3"],
		["4", "5", "x", "6"],
		["7", "8", "<", "9"],
	]);
});

test("canUnsplit is false when merging would not remove rows or columns", () => {
	const t = parse(SAMPLE);
	assert.equal(canUnsplit(t, { r0: 1, c0: 0, r1: 2, c1: 1 }), false);
	assert.equal(canUnsplit(t, { r0: 0, c0: 0, r1: 1, c1: 0 }), false, "header cannot merge with the body");
	const big = mergeRange(t, { r0: 1, c0: 0, r1: 2, c1: 2 }, "first");
	assert.equal(canUnsplit(splitCell(big, { row: 1, col: 0 }, 1, 3), { r0: 1, c0: 0, r1: 2, c1: 2 }), false);
});

test("formatTable aligns columns with CJK width and keeps alignment markers", () => {
	assert.equal(displayWidth("中文ab"), 6);
	const t = parse("| 名称 | n |\n|:--|--:|\n| 苹果手机 | 12 |");
	assert.deepEqual(formatTable(t), [
		"| 名称     |   n |",
		"| :------- | --: |",
		"| 苹果手机 |  12 |",
	]);
	assert.deepEqual(formatTable(t, false), ["| 名称 | n |", "| :-- | --: |", "| 苹果手机 | 12 |"]);
});
