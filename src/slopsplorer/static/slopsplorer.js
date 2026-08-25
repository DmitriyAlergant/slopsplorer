const state = {
  snapshot: null,
  foldersByPath: new Map(),
  filesByPath: new Map(),
  expandedFolderPaths: new Set([""]),
  excludedFolderPaths: new Set(),
  excludedDirectFileFolderPaths: new Set(),
  selectedTreeItem: { kind: "folder", folderPath: "" },
  largestFilesSortMetric: "tokens",
  defaultProjectTokens: 0,
};

const elements = {
  rootSummary: document.querySelector("#rootSummary"),
  summaryCards: document.querySelector("#summaryCards"),
  pathSearch: document.querySelector("#pathSearch"),
  sourceTree: document.querySelector("#sourceTree"),
  folderDetail: document.querySelector("#folderDetail"),
  hotspotTable: document.querySelector("#hotspotTable"),
  largestFilesSort: document.querySelector("#largestFilesSort"),
  minimumTokens: document.querySelector("#minimumTokens"),
  showGenerated: document.querySelector("#showGenerated"),
  visibleTreeTotal: document.querySelector("#visibleTreeTotal"),
  sourceDialog: document.querySelector("#sourceDialog"),
  sourceDialogPath: document.querySelector("#sourceDialogPath"),
  sourcePreview: document.querySelector("#sourcePreview"),
};

const numberFormatter = new Intl.NumberFormat();

/** Load the immutable startup snapshot and render every explorer surface. */
async function initializeSlopsplorer() {
  const response = await fetch("/api/snapshot");
  if (!response.ok) throw new Error(`Slopsplorer snapshot request failed: ${response.status}`);
  state.snapshot = await response.json();
  state.foldersByPath = new Map(state.snapshot.folders.map((folder) => [folder.path, folder]));
  state.filesByPath = new Map(state.snapshot.files.map((file) => [file.path, file]));
  state.defaultProjectTokens = sumMetric(
    state.snapshot.files.filter((file) => !file.generated),
    "tokens",
  );
  elements.rootSummary.textContent = `${state.snapshot.rootPath} · ${state.snapshot.tokenizer}`;
  renderSlopsplorer();
}

/** Render summary, hierarchy, folder detail, and largest-file ranking. */
function renderSlopsplorer() {
  renderSummaryCards();
  renderSourceTree();
  renderFolderDetail();
  renderLargestFilesTable();
}

function selectedFileKinds() {
  return new Set(
    [...document.querySelectorAll("[data-kind]:checked")].map((input) => input.dataset.kind),
  );
}

/** Apply file-kind and generated-file visibility before tree-scope exclusions. */
function categoryVisibleSourceFiles() {
  const fileKinds = selectedFileKinds();
  const showGenerated = elements.showGenerated.checked;
  const query = elements.pathSearch.value.trim().toLowerCase();
  return state.snapshot.files.filter(
    (file) =>
      (file.generated ? showGenerated : fileKinds.has(file.file_kind)) &&
      (!query || file.path.toLowerCase().includes(query)),
  );
}

/** Apply folder and direct-file-group exclusions to the category-visible source set. */
function visibleSourceFiles() {
  return categoryVisibleSourceFiles().filter((file) => !isSourceFileExcluded(file));
}

function isSourceFileExcluded(file) {
  if (state.excludedDirectFileFolderPaths.has(file.parent_path)) return true;
  return [...state.excludedFolderPaths].some(
    (folderPath) => !folderPath || file.path.startsWith(`${folderPath}/`),
  );
}

function renderSummaryCards() {
  const files = visibleSourceFiles();
  const cards = [
    [numberFormatter.format(state.defaultProjectTokens), "full project tokens"],
    [numberFormatter.format(sumMetric(files, "tokens")), "selected tokens"],
    [numberFormatter.format(files.length), "selected files"],
    [numberFormatter.format(sumMetric(files, "lines")), "selected lines"],
  ];
  elements.summaryCards.innerHTML = cards
    .map(([value, label]) => `<div class="summary-card"><strong>${value}</strong><span>${escapeHtml(label)}</span></div>`)
    .join("");
}

/** Render folders recursively from explicit child_paths, with independent scope checkboxes. */
function renderSourceTree() {
  const categoryFiles = categoryVisibleSourceFiles();
  const categoryPaths = new Set(categoryFiles.map((file) => file.path));
  const visiblePaths = new Set(visibleSourceFiles().map((file) => file.path));
  const queryActive = elements.pathSearch.value.trim().length > 0;
  const rows = [];
  appendFolderTreeRows("", 0, categoryPaths, visiblePaths, queryActive, rows);
  elements.sourceTree.innerHTML = rows.join("") || '<div class="empty-state">No files match the selected categories or search</div>';
  applyFolderCheckboxStates();
  elements.visibleTreeTotal.textContent = `${numberFormatter.format(sumMetric(visibleSourceFiles(), "tokens"))} tok`;
}

function appendFolderTreeRows(folderPath, depth, categoryPaths, visiblePaths, queryActive, rows) {
  const folder = state.foldersByPath.get(folderPath);
  if (!folder) return;
  const categoryFolderFiles = filesBelowFolder(folderPath).filter((file) => categoryPaths.has(file.path));
  if (!categoryFolderFiles.length) return;
  const visibleFolderFiles = categoryFolderFiles.filter((file) => visiblePaths.has(file.path));
  const childFolders = folder.child_paths
    .map((childPath) => state.foldersByPath.get(childPath))
    .filter((child) => filesBelowFolder(child.path).some((file) => categoryPaths.has(file.path)));
  const categoryDirectFiles = folder.direct_file_paths
    .map((filePath) => state.filesByPath.get(filePath))
    .filter((file) => file && categoryPaths.has(file.path));
  const visibleDirectFiles = categoryDirectFiles.filter((file) => visiblePaths.has(file.path));
  const expanded = queryActive || state.expandedFolderPaths.has(folderPath);
  const checkboxState = folderInclusionState(folderPath);
  const selected = state.selectedTreeItem.kind === "folder" && state.selectedTreeItem.folderPath === folderPath;
  rows.push(`
    <div class="tree-row ${selected ? "is-selected" : ""} ${checkboxState.checked ? "" : "is-excluded"}" style="padding-left:${depth * 14}px">
      <button class="tree-disclosure" type="button" ${childFolders.length || categoryDirectFiles.length ? `data-toggle-folder="${escapeAttribute(folderPath)}" aria-expanded="${expanded}"` : "disabled"}>${childFolders.length || categoryDirectFiles.length ? (expanded ? "▾" : "▸") : "·"}</button>
      <input class="tree-inclusion" type="checkbox" data-folder-inclusion="${escapeAttribute(folderPath)}" ${checkboxState.checked ? "checked" : ""} ${checkboxState.disabled ? "disabled" : ""} aria-label="Include ${escapeAttribute(folder.name)} subtree" />
      <button class="tree-label" type="button" data-select-folder="${escapeAttribute(folderPath)}">${escapeHtml(folder.name)}</button>
      <span class="tree-total">${numberFormatter.format(sumMetric(visibleFolderFiles, "tokens"))}</span>
    </div>
  `);
  if (!expanded) return;
  if (categoryDirectFiles.length) {
    const directFilesSelected = state.selectedTreeItem.kind === "files" && state.selectedTreeItem.folderPath === folderPath;
    const directFilesExcluded = isFolderOrAncestorExcluded(folderPath) || state.excludedDirectFileFolderPaths.has(folderPath);
    rows.push(`
      <div class="tree-row tree-files-row ${directFilesSelected ? "is-selected" : ""} ${directFilesExcluded ? "is-excluded" : ""}" style="padding-left:${(depth + 1) * 14}px">
        <button class="tree-disclosure" type="button" disabled>·</button>
        <input class="tree-inclusion" type="checkbox" data-direct-files-inclusion="${escapeAttribute(folderPath)}" ${directFilesExcluded ? "" : "checked"} ${isFolderOrAncestorExcluded(folderPath) ? "disabled" : ""} aria-label="Include files directly inside ${escapeAttribute(folder.name)}" />
        <button class="tree-label" type="button" data-select-files="${escapeAttribute(folderPath)}">(files)</button>
        <span class="tree-total">${numberFormatter.format(sumMetric(visibleDirectFiles, "tokens"))}</span>
      </div>
    `);
  }
  childFolders.forEach((child) => appendFolderTreeRows(child.path, depth + 1, categoryPaths, visiblePaths, queryActive, rows));
}

function folderInclusionState(folderPath) {
  const inheritedExclusion = isFolderOrAncestorExcluded(folderPath);
  const hasNestedExclusion = !inheritedExclusion && hasExclusionWithinFolder(folderPath);
  return {
    checked: !inheritedExclusion,
    indeterminate: hasNestedExclusion,
    disabled: inheritedExclusion && !state.excludedFolderPaths.has(folderPath),
  };
}

function applyFolderCheckboxStates() {
  document.querySelectorAll("[data-folder-inclusion]").forEach((checkbox) => {
    checkbox.indeterminate = folderInclusionState(checkbox.dataset.folderInclusion).indeterminate;
  });
}

function isFolderOrAncestorExcluded(folderPath) {
  return [...state.excludedFolderPaths].some(
    (excludedPath) => !excludedPath || folderPath === excludedPath || folderPath.startsWith(`${excludedPath}/`),
  );
}

function hasExclusionWithinFolder(folderPath) {
  const prefix = folderPath ? `${folderPath}/` : "";
  return (
    [...state.excludedFolderPaths].some((excludedPath) => excludedPath !== folderPath && excludedPath.startsWith(prefix)) ||
    [...state.excludedDirectFileFolderPaths].some(
      (excludedPath) => excludedPath === folderPath || excludedPath.startsWith(prefix),
    )
  );
}

function renderFolderDetail() {
  const folder = state.foldersByPath.get(state.selectedTreeItem.folderPath) || state.foldersByPath.get("");
  const visiblePaths = new Set(visibleSourceFiles().map((file) => file.path));
  const directFilesOnly = state.selectedTreeItem.kind === "files";
  const files = directFilesOnly
    ? folder.direct_file_paths.map((path) => state.filesByPath.get(path)).filter((file) => file && visiblePaths.has(file.path))
    : filesBelowFolder(folder.path).filter((file) => visiblePaths.has(file.path));
  const childFolders = directFilesOnly
    ? []
    : folder.child_paths
        .map((path) => state.foldersByPath.get(path))
        .map((child) => ({ child, files: filesBelowFolder(child.path).filter((file) => visiblePaths.has(file.path)) }))
        .filter(({ files: childFiles }) => childFiles.length)
        .sort((left, right) => sumMetric(right.files, "tokens") - sumMetric(left.files, "tokens"));
  const directFiles = folder.direct_file_paths
    .map((path) => state.filesByPath.get(path))
    .filter((file) => file && visiblePaths.has(file.path))
    .sort((left, right) => right.tokens - left.tokens);
  const projectTokens = state.defaultProjectTokens;
  const folderCardEntries = childFolders.length > 6
    ? [
        ...childFolders.slice(0, 5).map(({ child, files: childFiles }) => ({
          name: child.name,
          folderPath: child.path,
          files: childFiles,
          aggregate: false,
        })),
        {
          name: `Other folders (${childFolders.length - 5})`,
          folderPath: null,
          files: childFolders.slice(5).flatMap(({ files: childFiles }) => childFiles),
          aggregate: true,
        },
      ]
    : childFolders.map(({ child, files: childFiles }) => ({
        name: child.name,
        folderPath: child.path,
        files: childFiles,
        aggregate: false,
      }));
  const folderCards = folderCardEntries
    .map((entry) => renderFolderWorkloadCard(entry, projectTokens))
    .join("");
  const displayName = directFilesOnly ? "(files)" : folder.name;
  const displayPath = `${folder.path || state.snapshot.rootName}${directFilesOnly ? "/(files)" : ""}`;
  elements.folderDetail.innerHTML = `
    <div class="folder-header">
      <div><div class="breadcrumb">${escapeHtml(displayPath)}</div><h3>${escapeHtml(displayName)}</h3><p class="root-summary">${numberFormatter.format(sumMetric(files, "tokens"))} tokens · ${files.length} files · ${numberFormatter.format(sumMetric(files, "lines"))} lines</p></div>
      <div class="folder-share" title="Share of the default project token baseline">${projectTokens ? ((sumMetric(files, "tokens") / projectTokens) * 100).toFixed(1) : "0.0"}%</div>
    </div>
    ${folderCards ? `<div class="folder-cards">${folderCards}</div>` : ""}
    <div class="table-caption">${directFiles.length} files directly inside this folder</div>
    ${renderFileMetricsTable(directFiles)}
  `;
}

function renderLargestFilesTable() {
  const minimumTokens = Number(elements.minimumTokens.value) || 0;
  const files = visibleSourceFiles()
    .filter((file) => file.tokens >= minimumTokens)
    .sort(
      (left, right) =>
        right[state.largestFilesSortMetric] - left[state.largestFilesSortMetric] ||
        right.tokens - left.tokens ||
        left.path.localeCompare(right.path),
    );
  elements.hotspotTable.innerHTML = renderFileMetricsTable(files, 100);
}

function renderFileMetricsTable(files, limit = Number.POSITIVE_INFINITY) {
  if (!files.length) return '<div class="empty-state">No files match the active categories, source-tree scope, search, and minimum-token filter</div>';
  const rows = files.slice(0, limit).map((file) => `
    <tr>
      <td><span class="kind-chip flavor-${fileFlavor(file)}">${fileFlavor(file)}</span></td>
      <td><button class="file-button" type="button" data-source-path="${escapeAttribute(file.path)}">${escapeHtml(file.path)}</button></td>
      <td>${numberFormatter.format(file.tokens)}</td><td>${numberFormatter.format(file.lines)}</td><td>${file.functions}</td><td>${file.branches}</td>
    </tr>
  `).join("");
  return `<div class="table-scroll"><table><thead><tr><th>Flavor</th><th>File</th><th>Tokens</th><th>Lines</th><th>Functions</th><th>Branches</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderFolderWorkloadCard(entry, projectTokens) {
  const tokens = sumMetric(entry.files, "tokens");
  const projectShare = projectTokens ? (tokens / projectTokens) * 100 : 0;
  const content = `<strong>${escapeHtml(entry.name)}</strong><small>${numberFormatter.format(tokens)} tokens · ${entry.files.length} files · ${projectShare.toFixed(1)}% project</small>${renderFlavorWorkloadBar(entry.files, projectTokens)}`;
  if (entry.aggregate) {
    return `<div class="folder-card folder-card--aggregate" aria-label="Combined workload of remaining folders">${content}</div>`;
  }
  return `<button class="folder-card" type="button" data-select-folder="${escapeAttribute(entry.folderPath)}">${content}</button>`;
}

function renderFlavorWorkloadBar(files, projectTokens) {
  const flavorOrder = ["code", "test", "text", "i18n", "data", "other", "generated"];
  const flavorTokens = new Map();
  files.forEach((file) => {
    const flavor = fileFlavor(file);
    flavorTokens.set(flavor, (flavorTokens.get(flavor) || 0) + file.tokens);
  });
  const segments = flavorOrder
    .filter((flavor) => flavorTokens.has(flavor))
    .map((flavor) => {
      const tokens = flavorTokens.get(flavor);
      const width = projectTokens ? (tokens / projectTokens) * 100 : 0;
      return `<span class="workload-segment flavor-bg-${flavor}" style="width:${width}%" title="${escapeAttribute(flavor)}: ${numberFormatter.format(tokens)} tokens"></span>`;
    })
    .join("");
  return `<div class="weight-bar" aria-label="Project token share stacked by flavor">${segments}</div>`;
}

function fileFlavor(file) {
  return file.generated ? "generated" : file.file_kind;
}

function filesBelowFolder(folderPath) {
  if (!folderPath) return state.snapshot.files;
  const prefix = `${folderPath}/`;
  return state.snapshot.files.filter((file) => file.path.startsWith(prefix));
}

async function openSourcePreview(sourcePath) {
  elements.sourceDialogPath.textContent = sourcePath;
  elements.sourcePreview.className = "";
  elements.sourcePreview.removeAttribute("data-highlighted");
  elements.sourcePreview.textContent = "Loading source preview...";
  elements.sourceDialog.showModal();
  const response = await fetch(`/api/source?path=${encodeURIComponent(sourcePath)}`);
  if (!response.ok) {
    elements.sourcePreview.textContent = `Source preview request failed: ${response.status}`;
    return;
  }
  const preview = await response.json();
  elements.sourcePreview.textContent = `${preview.content}${preview.truncated ? `\n\n[Preview truncated at 512 KiB of ${numberFormatter.format(preview.totalBytes)} bytes]` : ""}`;
  const highlightLanguage = highlightLanguageForPath(sourcePath);
  if (highlightLanguage) elements.sourcePreview.classList.add(`language-${highlightLanguage}`);
  window.hljs.highlightElement(elements.sourcePreview);
}

function highlightLanguageForPath(sourcePath) {
  const extension = sourcePath.split(".").pop().toLowerCase();
  return {
    c: "c", cc: "cpp", cpp: "cpp", css: "css", go: "go", h: "c", hpp: "cpp",
    html: "html", java: "java", js: "javascript", json: "json", jsx: "javascript",
    kt: "kotlin", lua: "lua", md: "markdown", php: "php", py: "python", rb: "ruby",
    rs: "rust", sh: "bash", sql: "sql", swift: "swift", toml: "ini", ts: "typescript",
    tsx: "typescript", xml: "xml", yaml: "yaml", yml: "yaml", zsh: "bash",
  }[extension];
}

function selectSourceTreeItem(kind, folderPath) {
  state.selectedTreeItem = { kind, folderPath };
  for (let parent = folderPath; parent; parent = state.foldersByPath.get(parent)?.parent_path || "") {
    state.expandedFolderPaths.add(parent);
  }
  state.expandedFolderPaths.add("");
  renderSourceTree();
  renderFolderDetail();
}

function toggleFolderInclusion(folderPath) {
  const checkboxState = folderInclusionState(folderPath);
  if (checkboxState.indeterminate || state.excludedFolderPaths.has(folderPath)) {
    clearFolderExclusions(folderPath);
  } else if (!checkboxState.disabled) {
    state.excludedFolderPaths.add(folderPath);
    removeNestedFolderExclusions(folderPath);
  }
  renderSlopsplorer();
}

function clearFolderExclusions(folderPath) {
  const prefix = folderPath ? `${folderPath}/` : "";
  state.excludedFolderPaths = new Set(
    [...state.excludedFolderPaths].filter((excludedPath) => excludedPath !== folderPath && !excludedPath.startsWith(prefix)),
  );
  state.excludedDirectFileFolderPaths = new Set(
    [...state.excludedDirectFileFolderPaths].filter((excludedPath) => excludedPath !== folderPath && !excludedPath.startsWith(prefix)),
  );
}

function removeNestedFolderExclusions(folderPath) {
  const prefix = folderPath ? `${folderPath}/` : "";
  state.excludedFolderPaths = new Set(
    [...state.excludedFolderPaths].filter((excludedPath) => excludedPath === folderPath || !excludedPath.startsWith(prefix)),
  );
  state.excludedDirectFileFolderPaths = new Set(
    [...state.excludedDirectFileFolderPaths].filter((excludedPath) => !excludedPath.startsWith(prefix) && excludedPath !== folderPath),
  );
}

function toggleDirectFilesInclusion(folderPath) {
  if (state.excludedDirectFileFolderPaths.has(folderPath)) {
    state.excludedDirectFileFolderPaths.delete(folderPath);
  } else {
    state.excludedDirectFileFolderPaths.add(folderPath);
  }
  renderSlopsplorer();
}

function sumMetric(items, metric) {
  return items.reduce((total, item) => total + item[metric], 0);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

document.addEventListener("click", (event) => {
  if (event.target.matches("[data-folder-inclusion]")) {
    event.preventDefault();
    toggleFolderInclusion(event.target.dataset.folderInclusion);
    return;
  }
  if (event.target.matches("[data-direct-files-inclusion]")) {
    event.preventDefault();
    toggleDirectFilesInclusion(event.target.dataset.directFilesInclusion);
    return;
  }
  const toggle = event.target.closest("[data-toggle-folder]");
  if (toggle) {
    const folderPath = toggle.dataset.toggleFolder;
    state.expandedFolderPaths.has(folderPath) ? state.expandedFolderPaths.delete(folderPath) : state.expandedFolderPaths.add(folderPath);
    renderSourceTree();
    return;
  }
  const folder = event.target.closest("[data-select-folder]");
  if (folder) {
    selectSourceTreeItem("folder", folder.dataset.selectFolder);
    return;
  }
  const files = event.target.closest("[data-select-files]");
  if (files) {
    selectSourceTreeItem("files", files.dataset.selectFiles);
    return;
  }
  const source = event.target.closest("[data-source-path]");
  if (source) openSourcePreview(source.dataset.sourcePath);
});

elements.pathSearch.addEventListener("input", renderSlopsplorer);
elements.largestFilesSort.addEventListener("input", (event) => {
  state.largestFilesSortMetric = event.target.value;
  renderLargestFilesTable();
});
elements.minimumTokens.addEventListener("input", renderLargestFilesTable);
elements.showGenerated.addEventListener("change", renderSlopsplorer);
document.querySelectorAll("[data-kind]").forEach((input) => input.addEventListener("change", renderSlopsplorer));
document.querySelector("#collapseTree").addEventListener("click", () => { state.expandedFolderPaths = new Set([""]); renderSourceTree(); });
document.querySelector("#expandTree").addEventListener("click", () => { state.expandedFolderPaths = new Set(state.snapshot.folders.map((folder) => folder.path)); renderSourceTree(); });
document.querySelector("#closeSourceDialog").addEventListener("click", () => elements.sourceDialog.close());

initializeSlopsplorer().catch((error) => {
  elements.rootSummary.textContent = error instanceof Error ? error.message : String(error);
});
