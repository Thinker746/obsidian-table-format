import { test } from "node:test";
import assert from "node:assert/strict";
import {
	MarkdownTable,
	cellAt,
	displayWidth,
	expandRange,
	findTable,
	formatTable,
	mergeRange,
	resolveSpans,
	splitCell,
	splitRange,
	splitRow,
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

test("splitRange clears markers of touched regions", () => {
	let t = parse(SAMPLE);
	t = mergeRange(t, { r0: 1, c0: 0, r1: 2, c1: 1 }, "space");
	const out = splitRange(t, { r0: 2, c0: 1, r1: 2, c1: 1 });
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
