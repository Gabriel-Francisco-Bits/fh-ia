"use strict";

const assert = require("node:assert/strict");
const { test, describe } = require("node:test");
const {
  normalizeLines,
  splitLines,
  parseUnifiedDiff,
  calculateConfidence,
  fuzzyFindBlock,
  validateHunk,
  applyHunks,
  applySurgicalReplacement,
  generateUnifiedDiff,
  createHunkPatch,
} = require("./diffEngine");

describe("diffEngine - Normalización y utilidades", () => {
  test("normalizeLines normaliza CRLF a LF y opcionalmente recorta espacios finales", () => {
    const crlf = "line1\r\nline2  \r\nline3\r";
    const lf = normalizeLines(crlf, false);
    assert.equal(lf, "line1\nline2  \nline3\n");

    const trimmed = normalizeLines(crlf, true);
    assert.equal(trimmed, "line1\nline2\nline3\n");
  });

  test("splitLines divide el texto en un array de líneas normalizadas", () => {
    const text = "a\r\nb\nc";
    assert.deepEqual(splitLines(text), ["a", "b", "c"]);
    assert.deepEqual(splitLines(""), []);
  });
});

describe("diffEngine - Parseo de Unified Diff", () => {
  test("parseUnifiedDiff procesa encabezados de archivo y hunks estándar", () => {
    const diff = `--- a/src/index.js
+++ b/src/index.js
@@ -10,4 +10,5 @@
 context before
-old line
+new line 1
+new line 2
 context after`;

    const parsed = parseUnifiedDiff(diff);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].oldPath, "src/index.js");
    assert.equal(parsed[0].newPath, "src/index.js");
    assert.equal(parsed[0].hunks.length, 1);

    const hunk = parsed[0].hunks[0];
    assert.equal(hunk.oldStart, 10);
    assert.equal(hunk.oldCount, 4);
    assert.equal(hunk.newStart, 10);
    assert.equal(hunk.newCount, 5);
    assert.deepEqual(hunk.oldLines, ["context before", "old line", "context after"]);
    assert.deepEqual(hunk.newLines, ["context before", "new line 1", "new line 2", "context after"]);
  });

  test("parseUnifiedDiff maneja formatos con conteo implícito @@ -1 +1 @@", () => {
    const diff = `@@ -1 +1 @@
-hello
+world`;
    const parsed = parseUnifiedDiff(diff);
    assert.equal(parsed.length, 1);
    const hunk = parsed[0].hunks[0];
    assert.equal(hunk.oldStart, 1);
    assert.equal(hunk.oldCount, 1);
    assert.equal(hunk.newStart, 1);
    assert.equal(hunk.newCount, 1);
  });
});

describe("diffEngine - Fuzzy Matching y Confianza", () => {
  test("calculateConfidence calcula similitud exacta y con ligeras variaciones de indentación", () => {
    const a = ["function test() {", "  return 42;", "}"];
    const b = ["function test() {", "  return 42;", "}"];
    assert.equal(calculateConfidence(a, b), 1.0);

    const c = ["function test() {", "    return 42;", "}"];
    const conf = calculateConfidence(a, c);
    assert.ok(conf > 0.8 && conf < 1.0, `Confidence was ${conf}`);
  });

  test("fuzzyFindBlock encuentra coincidencias desplazadas dentro del rango +/- 3 líneas", () => {
    const lines = [
      "header",
      "import foo from 'bar';",
      "",
      "function calculate(a, b) {",
      "  return a + b;",
      "}",
      "footer",
    ];

    const target = [
      "function calculate(a, b) {",
      "  return a + b;",
      "}",
    ];

    const match = fuzzyFindBlock(lines, target, 1, 5, 0.7);
    assert.ok(match, "Debe encontrar el bloque con fuzzy match");
    assert.equal(match.lineIndex, 3);
    assert.ok(match.confidence >= 0.95, `Confidence was ${match.confidence}`);
  });
});

describe("diffEngine - Validación y Aplicación Atómica de Hunks", () => {
  test("Aplica un hunk simple de reemplazo correctamente", () => {
    const original = "function add(a, b) {\n  return a + b;\n}\n";
    const diff = `--- a/math.js
+++ b/math.js
@@ -1,3 +1,3 @@
 function add(a, b) {
-  return a + b;
+  return Number(a) + Number(b);
 }`;

    const res = applyHunks(original, diff);
    assert.equal(res.success, true);
    assert.equal(res.appliedHunks, 1);
    assert.equal(res.resultText, "function add(a, b) {\n  return Number(a) + Number(b);\n}\n");
  });

  test("Validación atómica estricta: si 1 hunk falla, NINGUNO se aplica (strict: true)", () => {
    const original = [
      "// Section 1",
      "const one = 1;",
      "// Section 2",
      "const two = 2;",
      "// Section 3",
      "const three = 3;",
    ].join("\n");

    const diff = `@@ -1,2 +1,2 @@
 // Section 1
-const one = 1;
+const one = 100;
@@ -5,2 +5,2 @@
 // NonExistent Section
-const nonExistent = 999;
+const nonExistent = 888;`;

    const res = applyHunks(original, diff, { strict: true });
    assert.equal(res.success, false, "La operación debe fallar atómicamente");
    assert.equal(res.appliedHunks, 0);
    assert.equal(res.errors.length, 1);
    assert.equal(res.resultText, normalizeLines(original));
  });

  test("Manejo de múltiples hunks con corrimiento de líneas", () => {
    const original = [
      "line 1",
      "line 2",
      "line 3",
      "line 4",
      "line 5",
      "line 6",
    ].join("\n");

    const diff = `@@ -2,1 +2,3 @@
-line 2
+line 2.1
+line 2.2
+line 2.3
@@ -5,1 +7,2 @@
-line 5
+line 5.1
+line 5.2`;

    const res = applyHunks(original, diff);
    assert.equal(res.success, true);
    assert.equal(res.appliedHunks, 2);

    const expected = [
      "line 1",
      "line 2.1",
      "line 2.2",
      "line 2.3",
      "line 3",
      "line 4",
      "line 5.1",
      "line 5.2",
      "line 6",
    ].join("\n");
    assert.equal(res.resultText, expected);
  });
});

describe("diffEngine - Casos Límite: Código Repetido e Indentación Mixta", () => {
  test("Distingue bloques de código idénticos repetidos usando el contexto de +/- 3 líneas", () => {
    const original = [
      "function first() {",
      "  const val = 10;",
      "  return val;",
      "}",
      "",
      "function second() {",
      "  const val = 10;",
      "  return val;",
      "}",
    ].join("\n");

    const diff = `@@ -6,4 +6,4 @@
 function second() {
-  const val = 10;
+  const val = 20;
   return val;
 }`;

    const res = applyHunks(original, diff);
    assert.equal(res.success, true);
    const expected = [
      "function first() {",
      "  const val = 10;",
      "  return val;",
      "}",
      "",
      "function second() {",
      "  const val = 20;",
      "  return val;",
      "}",
    ].join("\n");
    assert.equal(res.resultText, expected);
  });

  test("Aplica hunks correctamente con indentación mixta (tabs vs espacios)", () => {
    const original = "function test() {\n\tconst x = 1;\n\treturn x;\n}\n";
    const diff = `@@ -1,4 +1,4 @@
 function test() {
-  const x = 1;
+  const x = 99;
   return x;
 }`;

    const res = applyHunks(original, diff, { confidenceThreshold: 0.6 });
    assert.equal(res.success, true);
    assert.ok(res.resultText.includes("99"));
  });
});

describe("diffEngine - Rendimiento en Archivos Grandes (> 10.000 líneas)", () => {
  test("Aplica parches en archivo de 12.000 líneas en menos de 50ms", () => {
    const lines = [];
    for (let i = 1; i <= 12000; i++) {
      lines.push(`// Line ${i}: const val_${i} = ${i};`);
    }
    const bigFile = lines.join("\n");

    const diff = `@@ -10,3 +10,3 @@
 // Line 10: const val_10 = 10;
-// Line 11: const val_11 = 11;
+// Line 11: const val_11 = 11000;
 // Line 12: const val_12 = 12;
@@ -6000,3 +6000,3 @@
 // Line 6000: const val_6000 = 6000;
-// Line 6001: const val_6001 = 6001;
+// Line 6001: const val_6001 = 6001000;
 // Line 6002: const val_6002 = 6002;
@@ -11990,3 +11990,3 @@
 // Line 11990: const val_11990 = 11990;
-// Line 11991: const val_11991 = 11991;
+// Line 11991: const val_11991 = 11991000;
 // Line 11992: const val_11992 = 11992;`;

    const startTime = process.hrtime.bigint();
    const res = applyHunks(bigFile, diff, { strict: true });
    const endTime = process.hrtime.bigint();
    const durationMs = Number(endTime - startTime) / 1e6;

    assert.equal(res.success, true);
    assert.equal(res.appliedHunks, 3);
    assert.ok(res.resultText.includes("11000"));
    assert.ok(res.resultText.includes("6001000"));
    assert.ok(res.resultText.includes("11991000"));
    assert.ok(durationMs < 50, `Se esperaba < 50ms pero tardó ${durationMs.toFixed(2)}ms`);
  });
});

describe("diffEngine - Sustitución Quirúrgica y Generación", () => {
  test("applySurgicalReplacement reemplaza coincidencia exacta única o múltiple", () => {
    const text = "const a = 1;\nconst b = 2;\nconst c = 1;\n";
    const single = applySurgicalReplacement(text, "const b = 2;", "const b = 20;", false);
    assert.equal(single.success, true);
    assert.equal(single.matchesCount, 1);
    assert.equal(single.resultText, "const a = 1;\nconst b = 20;\nconst c = 1;\n");

    const multi = applySurgicalReplacement(text, "const a = 1;", "const a = 10;", false);
    assert.equal(multi.success, true);

    const dupError = applySurgicalReplacement(text, "1", "99", false);
    assert.equal(dupError.success, false);
    assert.ok(dupError.error.includes("multiple"));
  });

  test("generateUnifiedDiff genera un parche válido reproducible", () => {
    const oldText = "line A\nline B\nline C\n";
    const newText = "line A\nline B modified\nline C\nline D\n";

    const diff = generateUnifiedDiff("test.txt", oldText, newText);
    assert.ok(diff.includes("--- a/test.txt"));
    assert.ok(diff.includes("+++ b/test.txt"));
    assert.ok(diff.includes("@@ -1,4 +1,5 @@"));

    const applied = applyHunks(oldText, diff);
    assert.equal(applied.success, true);
    assert.equal(applied.resultText, normalizeLines(newText));
  });
});
