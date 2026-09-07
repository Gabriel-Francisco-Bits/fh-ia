/**
 * diffEngine.js — Motor de Edición Quirúrgica de Código y Parches Unificados
 *
 * Características:
 * - Parseo y generación estándar de Unified Diffs (@@ -start,count +start,count @@).
 * - Validación atómica estricta: si falla 1 solo hunk, ninguno se aplica.
 * - Normalización transparente CRLF / LF y espacios en blanco al final de línea.
 * - Coincidencia exacta + Fuzzy Matching con contexto adyacente (+/- 3 líneas) y cálculo de confianza.
 * - Sustitución quirúrgica de bloques atómicos (targetContent -> replacementContent).
 * - Alto rendimiento en archivos grandes (> 10.000 líneas).
 */

/**
 * Normaliza los saltos de línea a LF (\n) y opcionalmente limpia espacios al final de cada línea.
 * @param {string} text
 * @param {boolean} [trimTrailing=false]
 * @returns {string}
 */
function normalizeLines(text, trimTrailing = false) {
  if (typeof text !== "string") return "";
  let norm = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (trimTrailing) {
    norm = norm
      .split("\n")
      .map((l) => l.trimEnd())
      .join("\n");
  }
  return norm;
}

/**
 * Divide un texto en líneas preservando la estructura sin saltos de línea al final de cada elemento.
 * @param {string} text
 * @returns {string[]}
 */
function splitLines(text) {
  if (!text) return [];
  const norm = normalizeLines(text);
  return norm.split("\n");
}

/**
 * @typedef {Object} DiffHunk
 * @property {number} oldStart
 * @property {number} oldCount
 * @property {number} newStart
 * @property {number} newCount
 * @property {string[]} lines
 * @property {string[]} oldLines
 * @property {string[]} newLines
 * @property {string} header
 */

/**
 * @typedef {Object} ParsedFileDiff
 * @property {string} oldPath
 * @property {string} newPath
 * @property {DiffHunk[]} hunks
 */

/**
 * Parsea un texto de Unified Diff estándar en una estructura de objetos DiffHunk.
 * @param {string} diffText
 * @returns {ParsedFileDiff[]}
 */
function parseUnifiedDiff(diffText) {
  if (!diffText || typeof diffText !== "string") return [];
  const lines = normalizeLines(diffText).split("\n");
  const files = [];
  let currentFile = null;
  let currentHunk = null;

  const HUNK_REGEX = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@(?:.*)$/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith("--- ")) {
      const oldPath = line.slice(4).trim().replace(/^[ab]\//, "");
      currentFile = { oldPath, newPath: "", hunks: [] };
      files.push(currentFile);
      currentHunk = null;
      continue;
    }

    if (line.startsWith("+++ ")) {
      if (!currentFile) {
        currentFile = { oldPath: "", newPath: "", hunks: [] };
        files.push(currentFile);
      }
      currentFile.newPath = line.slice(4).trim().replace(/^[ab]\//, "");
      continue;
    }

    const hunkMatch = line.match(HUNK_REGEX);
    if (hunkMatch) {
      if (!currentFile) {
        currentFile = { oldPath: "unknown", newPath: "unknown", hunks: [] };
        files.push(currentFile);
      }
      const oldStart = parseInt(hunkMatch[1], 10);
      const oldCount = hunkMatch[2] !== undefined ? parseInt(hunkMatch[2], 10) : 1;
      const newStart = parseInt(hunkMatch[3], 10);
      const newCount = hunkMatch[4] !== undefined ? parseInt(hunkMatch[4], 10) : 1;

      currentHunk = {
        oldStart,
        oldCount,
        newStart,
        newCount,
        lines: [],
        oldLines: [],
        newLines: [],
        header: line,
      };
      currentFile.hunks.push(currentHunk);
      continue;
    }

    if (currentHunk) {
      if (line.startsWith(" ") || line.startsWith("+") || line.startsWith("-")) {
        const prefix = line[0];
        const content = line.slice(1);
        currentHunk.lines.push(line);
        if (prefix === " " || prefix === "-") {
          currentHunk.oldLines.push(content);
        }
        if (prefix === " " || prefix === "+") {
          currentHunk.newLines.push(content);
        }
      } else if (
        line === "" &&
        (currentHunk.oldLines.length < currentHunk.oldCount || currentHunk.newLines.length < currentHunk.newCount)
      ) {
        // Línea en blanco legítima dentro del cuerpo del hunk
        currentHunk.lines.push(" ");
        currentHunk.oldLines.push("");
        currentHunk.newLines.push("");
      } else if (line.startsWith("\\ No newline at end of file")) {
        // Marcador estándar de fin de archivo sin salto
        currentHunk.lines.push(line);
      }
    }
  }

  return files;
}

/**
 * Calcula la distancia de similitud entre dos líneas normalizadas (0.0 a 1.0).
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function lineSimilarity(a, b) {
  if (a === b) return 1.0;
  const aTrim = a.trim();
  const bTrim = b.trim();
  if (aTrim === bTrim) return 0.95;
  if (!aTrim && !bTrim) return 1.0;
  if (!aTrim || !bTrim) return 0.0;

  const lenMax = Math.max(aTrim.length, bTrim.length);
  if (lenMax === 0) return 1.0;

  let common = 0;
  const minLen = Math.min(aTrim.length, bTrim.length);
  for (let i = 0; i < minLen; i++) {
    if (aTrim[i] === bTrim[i]) common++;
  }
  return common / lenMax;
}

/**
 * Realiza coincidencia difusa (Fuzzy Matching) de un bloque de líneas en el archivo original.
 * @param {string[]} targetLines Líneas del archivo original
 * @param {string[]} hunkOldLines Líneas esperadas (contexto + eliminadas)
 * @param {number} expectedStart Línea estimada 1-indexed
 * @param {number} [searchWindow=100] Ventana máxima de búsqueda alrededor de expectedStart
 * @returns {{ matchIndex: number, confidence: number } | null}
 */
function fuzzyFindHunkLocation(targetLines, hunkOldLines, expectedStart, searchWindow = 100) {
  if (!hunkOldLines.length) return { matchIndex: expectedStart - 1, confidence: 1.0 };
  const n = targetLines.length;
  const m = hunkOldLines.length;
  if (m > n) return null;

  const startIdx = Math.max(0, expectedStart - 1);

  // 1. Intento rápido: Coincidencia exacta en la posición esperada
  if (startIdx + m <= n) {
    let exact = true;
    for (let j = 0; j < m; j++) {
      if (targetLines[startIdx + j] !== hunkOldLines[j]) {
        exact = false;
        break;
      }
    }
    if (exact) {
      return { matchIndex: startIdx, confidence: 1.0 };
    }
  }

  // 2. Coincidencia exacta ignorando espacios al final
  if (startIdx + m <= n) {
    let exactTrimmed = true;
    for (let j = 0; j < m; j++) {
      if (targetLines[startIdx + j].trimEnd() !== hunkOldLines[j].trimEnd()) {
        exactTrimmed = false;
        break;
      }
    }
    if (exactTrimmed) {
      return { matchIndex: startIdx, confidence: 0.98 };
    }
  }

  // 3. Búsqueda en una ventana alrededor de expectedStart
  let bestIndex = -1;
  let bestScore = 0;

  const minSearch = Math.max(0, startIdx - searchWindow);
  const maxSearch = Math.min(n - m, startIdx + searchWindow);

  for (let i = minSearch; i <= maxSearch; i++) {
    let totalScore = 0;
    for (let j = 0; j < m; j++) {
      const sim = lineSimilarity(targetLines[i + j], hunkOldLines[j]);
      totalScore += sim;
      if (totalScore + (m - 1 - j) < bestScore * m) break;
    }
    const avgScore = totalScore / m;

    const distance = Math.abs(i - startIdx);
    const distancePenalty = Math.min(0.05, (distance / searchWindow) * 0.05);
    const finalConfidence = Math.max(0, avgScore - distancePenalty);

    if (finalConfidence > bestScore) {
      bestScore = finalConfidence;
      bestIndex = i;
    }
  }

  // 4. Búsqueda global si la ventana no arrojó buena coincidencia
  if (bestScore < 0.85) {
    for (let i = 0; i <= n - m; i++) {
      if (i >= minSearch && i <= maxSearch) continue;
      let exactGlobal = true;
      for (let j = 0; j < m; j++) {
        if (targetLines[i + j].trimEnd() !== hunkOldLines[j].trimEnd()) {
          exactGlobal = false;
          break;
        }
      }
      if (exactGlobal) {
        return { matchIndex: i, confidence: 0.95 };
      }
    }
  }

  if (bestIndex >= 0 && bestScore >= 0.75) {
    return { matchIndex: bestIndex, confidence: bestScore };
  }

  return null;
}

/**
 * Aplica un conjunto de hunks a un texto de forma ESTRICTAMENTE ATÓMICA.
 * Si alguno de los hunks no se puede ubicar con suficiente confianza, aborta la operación completa
 * sin alterar el texto.
 *
 * @param {string} originalText
 * @param {DiffHunk[]} hunks
 * @param {Object} [options={}]
 * @param {number} [options.confidenceThreshold=0.75]
 * @returns {{ success: boolean, result?: string, error?: string, hunksApplied?: number, totalHunks?: number, details?: any[] }}
 */
function applyHunksAtomic(originalText, hunks, options = {}) {
  const threshold = options.confidenceThreshold ?? 0.75;
  const isCrlf = originalText.includes("\r\n");
  const normalizedOriginal = normalizeLines(originalText);
  const fileLines = normalizedOriginal === "" ? [] : normalizedOriginal.split("\n");

  if (!hunks || hunks.length === 0) {
    return {
      success: true,
      result: originalText,
      hunksApplied: 0,
      totalHunks: 0,
    };
  }

  // FASE 1: Validación Atómica y Localización de todos los hunks
  const locations = [];
  let lineOffset = 0;

  for (let hIdx = 0; hIdx < hunks.length; hIdx++) {
    const hunk = hunks[hIdx];
    const expectedStart = hunk.oldStart + lineOffset;
    const match = fuzzyFindHunkLocation(fileLines, hunk.oldLines, expectedStart);

    if (!match || match.confidence < threshold) {
      return {
        success: false,
        error: `Validación atómica fallida en hunk ${hIdx + 1}/${hunks.length} (${hunk.header}): coincidencia insuficiente (confianza: ${match ? (match.confidence * 100).toFixed(1) + "%" : "0%"}). Ningún cambio aplicado.`,
        hunksApplied: 0,
        totalHunks: hunks.length,
      };
    }

    // Verificar colisión o superposición con el hunk previo
    if (locations.length > 0) {
      const prev = locations[locations.length - 1];
      const prevEnd = prev.matchIndex + prev.hunk.oldLines.length;
      if (match.matchIndex < prevEnd) {
        return {
          success: false,
          error: `Validación atómica fallida: Hunk ${hIdx + 1} se superpone con el hunk anterior en línea ${match.matchIndex + 1}.`,
          hunksApplied: 0,
          totalHunks: hunks.length,
        };
      }
    }

    locations.push({
      hunkIndex: hIdx,
      hunk,
      matchIndex: match.matchIndex,
      confidence: match.confidence,
    });

    lineOffset += hunk.newLines.length - hunk.oldLines.length;
  }

  // FASE 2: Aplicación segura en orden inverso para preservar índices
  const resultLines = [...fileLines];
  for (let i = locations.length - 1; i >= 0; i--) {
    const loc = locations[i];
    const deleteCount = loc.hunk.oldLines.length;
    resultLines.splice(loc.matchIndex, deleteCount, ...loc.hunk.newLines);
  }

  let finalOutput = resultLines.join(isCrlf ? "\r\n" : "\n");
  if (originalText.endsWith("\n") && !finalOutput.endsWith("\n")) {
    finalOutput += isCrlf ? "\r\n" : "\n";
  }

  return {
    success: true,
    result: finalOutput,
    hunksApplied: hunks.length,
    totalHunks: hunks.length,
    details: locations.map((l) => ({
      hunk: l.hunkIndex + 1,
      line: l.matchIndex + 1,
      confidence: l.confidence,
    })),
  };
}

/**
 * Aplica un Unified Diff completo en formato string a un texto original.
 * @param {string} originalText
 * @param {string} diffText
 * @param {Object} [options={}]
 * @returns {{ success: boolean, result?: string, error?: string, hunksApplied?: number, totalHunks?: number }}
 */
function applyUnifiedDiff(originalText, diffText, options = {}) {
  const parsedFiles = parseUnifiedDiff(diffText);
  if (!parsedFiles.length || !parsedFiles[0].hunks.length) {
    return {
      success: false,
      error: "No se encontraron bloques diff (hunks) válidos en el contenido proporcionado.",
      hunksApplied: 0,
      totalHunks: 0,
    };
  }

  return applyHunksAtomic(originalText, parsedFiles[0].hunks, options);
}

/**
 * Aplica una edición quirúrgica de bloque (targetContent -> replacementContent) con validación estricta.
 * @param {string} originalText
 * @param {string} targetContent
 * @param {string} replacementContent
 * @param {Object} [options={}]
 * @returns {{ success: boolean, result?: string, error?: string, confidence?: number }}
 */
function applySurgicalBlock(originalText, targetContent, replacementContent, options = {}) {
  if (typeof originalText !== "string" || typeof targetContent !== "string") {
    return { success: false, error: "Parámetros inválidos para edición quirúrgica." };
  }

  const isCrlf = originalText.includes("\r\n");
  const normOriginal = normalizeLines(originalText);
  const normTarget = normalizeLines(targetContent);
  const normReplace = normalizeLines(replacementContent || "");

  // 1. Coincidencia exacta única
  const firstIdx = normOriginal.indexOf(normTarget);
  if (firstIdx !== -1) {
    const secondIdx = normOriginal.indexOf(normTarget, firstIdx + 1);
    if (secondIdx === -1 || options.allowMultiple) {
      const updated = options.allowMultiple
        ? normOriginal.split(normTarget).join(normReplace)
        : normOriginal.slice(0, firstIdx) + normReplace + normOriginal.slice(firstIdx + normTarget.length);

      return {
        success: true,
        result: isCrlf ? updated.replace(/\n/g, "\r\n") : updated,
        confidence: 1.0,
      };
    }
  }

  // 2. Coincidencia por líneas con tolerancia de indentación y espacios
  const origLines = normOriginal.split("\n");
  const targetLines = normTarget.split("\n");
  const replaceLines = normReplace.split("\n");

  const match = fuzzyFindHunkLocation(origLines, targetLines, 1, origLines.length);
  if (!match || match.confidence < (options.confidenceThreshold ?? 0.75)) {
    return {
      success: false,
      error: `No se encontró coincidencia confiable para el bloque a modificar (confianza: ${match ? (match.confidence * 100).toFixed(1) + "%" : "0%"}). Se cancela la operación atómica.`,
      confidence: match ? match.confidence : 0,
    };
  }

  origLines.splice(match.matchIndex, targetLines.length, ...replaceLines);
  const updated = origLines.join(isCrlf ? "\r\n" : "\n");
  return {
    success: true,
    result: updated,
    confidence: match.confidence,
  };
}

/**
 * Genera un Unified Diff estándar (LCS) entre dos textos.
 * @param {string} filePath
 * @param {string} original
 * @param {string} modified
 * @param {number} [contextLines=3]
 * @returns {string}
 */
function generateUnifiedDiff(filePath, original, modified, contextLines = 3) {
  const normA = normalizeLines(original);
  const normB = normalizeLines(modified);

  const a = normA === "" ? [] : normA.split("\n");
  const b = normB === "" ? [] : normB.split("\n");

  if (normA === normB) {
    return "";
  }

  const n = a.length;
  const m = b.length;

  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const edits = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      edits.push({ type: "equal", aLine: i + 1, bLine: j + 1, text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      edits.push({ type: "del", aLine: i + 1, bLine: j + 1, text: a[i] });
      i++;
    } else {
      edits.push({ type: "add", aLine: i + 1, bLine: j + 1, text: b[j] });
      j++;
    }
  }
  while (i < n) {
    edits.push({ type: "del", aLine: i + 1, bLine: j + 1, text: a[i++] });
  }
  while (j < m) {
    edits.push({ type: "add", aLine: i + 1, bLine: j + 1, text: b[j++] });
  }

  const hunkGroups = [];

  for (let idx = 0; idx < edits.length; idx++) {
    const edit = edits[idx];
    if (edit.type !== "equal") {
      const start = Math.max(0, idx - contextLines);
      const end = Math.min(edits.length - 1, idx + contextLines);

      if (hunkGroups.length > 0 && start <= hunkGroups[hunkGroups.length - 1].end + contextLines) {
        hunkGroups[hunkGroups.length - 1].end = end;
      } else {
        hunkGroups.push({ start, end });
      }
    }
  }

  if (!hunkGroups.length) return "";

  const header = [`--- a/${filePath}`, `+++ b/${filePath}`];
  const hunkStrings = [];

  for (const group of hunkGroups) {
    const slice = edits.slice(group.start, group.end + 1);
    let oldStart = 0;
    let oldCount = 0;
    let newStart = 0;
    let newCount = 0;
    const hunkBody = [];

    for (const item of slice) {
      if (item.type === "equal") {
        if (oldStart === 0) oldStart = item.aLine;
        if (newStart === 0) newStart = item.bLine;
        oldCount++;
        newCount++;
        hunkBody.push(` ${item.text}`);
      } else if (item.type === "del") {
        if (oldStart === 0) oldStart = item.aLine;
        oldCount++;
        hunkBody.push(`-${item.text}`);
      } else if (item.type === "add") {
        if (newStart === 0) newStart = item.bLine;
        newCount++;
        hunkBody.push(`+${item.text}`);
      }
    }

    if (oldStart === 0) oldStart = 1;
    if (newStart === 0) newStart = 1;

    hunkStrings.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@\n${hunkBody.join("\n")}`);
  }

  return `${header.join("\n")}\n${hunkStrings.join("\n")}`;
}

/**
 * Calcula la confianza / similitud entre dos listas de líneas (0.0 a 1.0).
 * @param {string[]} linesA
 * @param {string[]} linesB
 * @returns {number}
 */
function calculateConfidence(linesA, linesB) {
  if (!Array.isArray(linesA) || !Array.isArray(linesB)) return 0;
  if (linesA.length === 0 && linesB.length === 0) return 1.0;
  if (linesA.length === 0 || linesB.length === 0) return 0.0;
  const maxLen = Math.max(linesA.length, linesB.length);
  let totalScore = 0;
  const minLen = Math.min(linesA.length, linesB.length);
  for (let i = 0; i < minLen; i++) {
    totalScore += lineSimilarity(linesA[i], linesB[i]);
  }
  return totalScore / maxLen;
}

/**
 * Encuentra un bloque en targetLines con fuzzy matching y retorna matchIndex y confianza.
 */
function fuzzyFindBlock(targetLines, hunkOldLines, expectedStart = 1, searchWindow = 100, threshold = 0.7) {
  const res = fuzzyFindHunkLocation(targetLines, hunkOldLines, expectedStart, searchWindow);
  if (!res || res.confidence < threshold) return null;
  return { lineIndex: res.matchIndex, confidence: res.confidence };
}

/**
 * Valida un hunk contra las líneas de destino.
 */
function validateHunk(targetLines, hunk, expectedStart = 1, threshold = 0.7) {
  const lines = Array.isArray(targetLines) ? targetLines : splitLines(targetLines);
  const match = fuzzyFindHunkLocation(lines, hunk.oldLines, expectedStart);
  return {
    valid: !!match && match.confidence >= threshold,
    matchIndex: match ? match.matchIndex : -1,
    confidence: match ? match.confidence : 0,
  };
}

/**
 * Aplica hunks (texto diff o array de hunks) con validación atómica estricta y resultado detallado.
 */
function applyHunks(originalText, diffOrHunks, options = {}) {
  let res;
  if (typeof diffOrHunks === "string") {
    res = applyUnifiedDiff(originalText, diffOrHunks, options);
  } else if (Array.isArray(diffOrHunks)) {
    res = applyHunksAtomic(originalText, diffOrHunks, options);
  } else {
    return {
      success: false,
      error: "Formato de hunks inválido",
      appliedHunks: 0,
      totalHunks: 0,
      resultText: originalText,
      errors: ["Formato de hunks inválido"],
    };
  }

  return {
    success: res.success,
    result: res.result,
    resultText: res.result !== undefined ? res.result : normalizeLines(originalText),
    appliedHunks: res.hunksApplied ?? 0,
    totalHunks: res.totalHunks ?? 0,
    errors: res.error ? [res.error] : [],
    details: res.details,
  };
}

/**
 * Sustitución quirúrgica de bloques con detección de duplicados si allowMultiple es false.
 */
function applySurgicalReplacement(originalText, targetContent, replacementContent, allowMultiple = false, options = {}) {
  const normOriginal = normalizeLines(originalText);
  const normTarget = normalizeLines(targetContent);
  const firstIdx = normOriginal.indexOf(normTarget);
  if (firstIdx !== -1 && !allowMultiple) {
    const secondIdx = normOriginal.indexOf(normTarget, firstIdx + 1);
    if (secondIdx !== -1) {
      return {
        success: false,
        error: "Found multiple occurrences of targetContent",
        matchesCount: 2,
        resultText: originalText,
      };
    }
  }

  const res = applySurgicalBlock(originalText, targetContent, replacementContent, { ...options, allowMultiple });
  return {
    success: res.success,
    resultText: res.result !== undefined ? res.result : originalText,
    error: res.error,
    matchesCount: res.success ? (allowMultiple ? normOriginal.split(normTarget).length - 1 : 1) : 0,
    confidence: res.confidence,
  };
}

/**
 * Genera un parche de un solo hunk para previsualización o aplicación aislada.
 */
function createHunkPatch(filePath, hunk) {
  const header = [`--- a/${filePath}`, `+++ b/${filePath}`];
  const hunkLines = [hunk.header || `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`];
  if (hunk.lines && hunk.lines.length) {
    for (const line of hunk.lines) {
      hunkLines.push(line);
    }
  }
  return `${header.join("\n")}\n${hunkLines.join("\n")}\n`;
}

module.exports = {
  normalizeLines,
  splitLines,
  parseUnifiedDiff,
  lineSimilarity,
  calculateConfidence,
  fuzzyFindHunkLocation,
  fuzzyFindBlock,
  validateHunk,
  applyHunksAtomic,
  applyUnifiedDiff,
  applyHunks,
  applySurgicalBlock,
  applySurgicalReplacement,
  generateUnifiedDiff,
  createHunkPatch,
};
