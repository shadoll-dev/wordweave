(function () {
  const LANG_KEY = "wordweave-lang";
  const LEVEL_KEY = "wordweave-level";
  const CATEGORY_MODE_KEY = "wordweave-categorymode";
  const CATEGORY_MODES = ["random", "select"];
  const LANGUAGE_NAMES = { en: "English", uk: "Українська" };
  const SUPPORTED_LANGS = Object.keys(LANGUAGE_NAMES);
  // Sorted alphabetically by the English display label — the menu no longer lists categories
  // directly (see categoryMode below), but this order still drives the top-level list in the
  // category-select modal, so keep it alphabetical. Every category is a pure grouping node with
  // named subcategories holding the actual words (see words.*.json) — a category never holds
  // words directly. "animals" absorbed babyanimals/cetaceans/mammals; "food" absorbed
  // cheeses/fruit (cheese and fruit are foods, not their own top-level categories).
  const CATEGORIES = [
    "animals", "clothing", "colors", "countries",
    "fitness", "food", "globalcities", "gymnastics", "islands",
    "jobs", "languages", "money", "music", "nativity",
    "onomatopoeia", "plants", "playingcards", "royalfamily", "space", "sports",
    "stationery", "vehicles", "weather",
  ];
  const LEVELS = ["easy", "moderate", "hard"];
  // Grid size is derived per puzzle from how many letters its chosen word-set actually contributes
  // (see buildPuzzle's TARGET_FILL), then clamped into this level's [minSize, maxSize] band — that
  // keeps density roughly constant (and the puzzle from going huge-and-sparse) even though word-sets
  // vary in size. wordCount is a cap, not a guarantee: a smaller set just yields fewer words.
  // maxCrossings caps how many words are allowed to share a single cell — easy grids stay simple
  // (two words crossing at most), harder ones allow denser, more tangled overlaps.
  const LEVEL_CONFIG = {
    easy: { minSize: 7, maxSize: 9, wordCount: 8, maxCrossings: 2 },
    moderate: { minSize: 9, maxSize: 12, wordCount: 12, maxCrossings: 3 },
    hard: { minSize: 11, maxSize: 14, wordCount: 16, maxCrossings: 4 },
  };
  const TARGET_FILL = 0.5; // aim for ~50% of cells covered by words before overlap tightens it further
  // 8 straight-line directions; word letters always occupy adjacent cells along one of these.
  const DIRECTIONS = [
    [0, 1], [0, -1], [1, 0], [-1, 0],
    [1, 1], [1, -1], [-1, 1], [-1, -1],
  ];
  const ALPHABETS = {
    en: "abcdefghijklmnopqrstuvwxyz",
    uk: "абвгґдеєжзиіїйклмнопрстуфхцчшщьюя",
  };
  const MAX_PLACEMENT_ATTEMPTS = 300;

  let currentLang = "en";
  let wordLevel = "moderate";
  let currentCategory = "animals";
  let currentSubcategory = null; // subcategory id, "mixed", or null for a category with no subcategories
  let categoryMode = "random"; // "random" | "select" — controls what New Game does, see startNewPuzzleFlow()
  let WORDS = {};

  let grid = [];
  let gridSize = 0;
  let targetWords = [];
  let bonusWords = []; // subset of targetWords deliberately placed a 2nd time, see buildPuzzle()
  let found = []; // [{ word, cells: [[r,c], ...] }] — first-occurrence finds
  let bonusFound = []; // [{ word, cells: [[r,c], ...] }] — second-occurrence (bonus) finds
  let selection = []; // [[r,c], ...]
  let direction = null; // [dr, dc], locked once selection.length >= 2
  // Drag-select state (mouse + touch, via Pointer Events): a press-and-drag runs the exact same
  // extend/pop logic as individual taps, one call per newly-entered cell — see handleCellTap()'s
  // callers below. A drag can be released partway through a word and finished off with plain taps,
  // or vice versa; both funnel through the same selection/direction state, so neither mode is
  // "special", they're just two ways of feeding the same input.
  let dragPointerId = null;
  let dragStartCell = null; // [r, c] of the cell under pointerdown, applied lazily on first move
  let dragLastCell = null; // last cell this drag has already applied, to dedupe repeat pointermoves
  let dragMoved = false; // true once the drag has actually left its starting cell
  let suppressNextClick = false; // set after a real drag, so its trailing synthetic click is a no-op
  let gameOver = false;
  let statsRecorded = false;
  // Elapsed time is pausedElapsedMs (time banked from earlier segments) plus, if a segment is
  // currently ticking, Date.now() - startTime. startTime is null whenever nothing is actively
  // ticking (before the first tap, while paused, or after a reload that didn't resume automatically).
  let pausedElapsedMs = 0;
  let startTime = null;
  let paused = false;
  let timerInterval = null;
  let pendingConfirmAction = null;

  const boardWrapEl = document.getElementById("board-wrap");
  const boardEl = document.getElementById("board");
  const badgeLayerEl = document.getElementById("badge-layer");
  const messageEl = document.getElementById("message");
  const wordListEl = document.getElementById("word-list");
  const foundBadgeEl = document.getElementById("found-badge");
  const levelBadgeEl = document.getElementById("level-badge");
  const timerEl = document.getElementById("timer");
  const pauseBtn = document.getElementById("pause-btn");
  const pauseOverlay = document.getElementById("pause-overlay");
  const pauseOverlayIcon = document.getElementById("pause-overlay-icon");
  const pauseOverlayLabel = document.getElementById("pause-overlay-label");
  const resumeBtn = document.getElementById("resume-btn");
  const helpModal = document.getElementById("help-modal");
  const statsModal = document.getElementById("stats-modal");
  const confirmModal = document.getElementById("confirm-modal");
  const categorySelectModal = document.getElementById("category-select-modal");
  const menuBtn = document.getElementById("menu-btn");
  const menuPanel = document.getElementById("menu-panel");

  let cellEls = []; // cellEls[r][c] -> element
  let selectedEls = []; // elements currently showing a badge

  function t(key, ...args) {
    const entry = I18N[currentLang][key];
    return typeof entry === "function" ? entry(...args) : entry;
  }

  function storageKey() {
    return `wordweave-state-${currentLang}`;
  }

  function statsKey() {
    return `wordweave-stats-${currentLang}`;
  }

  function detectInitialLang() {
    const stored = localStorage.getItem(LANG_KEY);
    if (SUPPORTED_LANGS.includes(stored)) return stored;
    return navigator.language && navigator.language.toLowerCase().startsWith("uk") ? "uk" : "en";
  }

  function detectInitialLevel() {
    const stored = localStorage.getItem(LEVEL_KEY);
    return LEVELS.includes(stored) ? stored : "moderate";
  }

  function detectInitialCategoryMode() {
    const stored = localStorage.getItem(CATEGORY_MODE_KEY);
    return CATEGORY_MODES.includes(stored) ? stored : "random";
  }

  function closeMenu() {
    menuPanel.classList.add("hidden");
    menuBtn.setAttribute("aria-expanded", "false");
  }

  menuBtn.addEventListener("click", () => {
    const isHidden = menuPanel.classList.contains("hidden");
    menuPanel.classList.toggle("hidden");
    menuBtn.setAttribute("aria-expanded", String(isHidden));
  });

  document.addEventListener("click", (e) => {
    if (!menuPanel.contains(e.target) && e.target !== menuBtn) closeMenu();
  });

  async function loadWords() {
    messageEl.textContent = t("loadingWords");
    const res = await fetch(`words.${currentLang}.json`);
    const data = await res.json();
    WORDS = data.categories;
    messageEl.textContent = "";
  }

  function randomInt(n) {
    return Math.floor(Math.random() * n);
  }

  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function bounds(delta, len, size) {
    if (delta === 0) return [0, size - 1];
    if (delta === 1) return [0, size - len];
    return [len - 1, size - 1];
  }

  // Checks whether `letters` fits starting at (row,col) heading (dr,dc); returns the cell path
  // and how many of those cells already hold a matching letter (i.e. how much it crosses existing
  // words). `crossCount`/`maxCrossings` cap how many words may already share a cell before this
  // placement is rejected outright — keeps easy grids simple and hard grids allowed to tangle more.
  function fitsAt(letters, row, col, dr, dc, size, g, crossCount, maxCrossings) {
    const cells = [];
    let overlap = 0;
    for (let i = 0; i < letters.length; i++) {
      const r = row + dr * i;
      const c = col + dc * i;
      if (r < 0 || r >= size || c < 0 || c >= size) return null;
      const existing = g[r][c];
      if (existing !== null) {
        if (existing !== letters[i]) return null;
        if (crossCount[r][c] >= maxCrossings) return null;
        overlap++;
      }
      cells.push([r, c]);
    }
    return { cells, overlap };
  }

  // Every already-filled cell that matches one of this word's letters is a candidate crossing point:
  // anchor the word through that cell (in every direction) and keep whichever placements are valid.
  // Preferring these over pure-random placement is what makes words actually interlock instead of
  // floating disconnected in a sea of filler letters.
  function findOverlapPlacements(letters, size, g, crossCount, maxCrossings) {
    const results = [];
    for (let i = 0; i < letters.length; i++) {
      const letter = letters[i];
      for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
          if (g[r][c] !== letter) continue;
          for (const [dr, dc] of DIRECTIONS) {
            const row = r - dr * i;
            const col = c - dc * i;
            const fit = fitsAt(letters, row, col, dr, dc, size, g, crossCount, maxCrossings);
            if (fit && fit.overlap > 0) results.push({ dr, dc, ...fit });
          }
        }
      }
    }
    return results;
  }

  // Same set of cells regardless of traversal order/direction — used both to stop a bonus
  // duplicate placement from landing on the exact same cells as the word's first placement, and to
  // tell a retrace of an already-found word apart from a genuinely different-location duplicate.
  function sameCellSet(cellsA, cellsB) {
    if (!cellsB || cellsA.length !== cellsB.length) return false;
    const setB = new Set(cellsB.map(([r, c]) => `${r},${c}`));
    return cellsA.every(([r, c]) => setB.has(`${r},${c}`));
  }

  function placeWord(word, size, g, crossCount, maxCrossings, excludeCells) {
    const letters = Array.from(word);
    const overlapCandidates = shuffle(findOverlapPlacements(letters, size, g, crossCount, maxCrossings)).filter(
      (fit) => !sameCellSet(fit.cells, excludeCells)
    );
    if (overlapCandidates.length > 0) return overlapCandidates[0];

    for (let attempt = 0; attempt < MAX_PLACEMENT_ATTEMPTS; attempt++) {
      const [dr, dc] = DIRECTIONS[randomInt(DIRECTIONS.length)];
      const [minRow, maxRow] = bounds(dr, letters.length, size);
      const [minCol, maxCol] = bounds(dc, letters.length, size);
      if (minRow > maxRow || minCol > maxCol) continue;
      const row = minRow + randomInt(maxRow - minRow + 1);
      const col = minCol + randomInt(maxCol - minCol + 1);
      const fit = fitsAt(letters, row, col, dr, dc, size, g, crossCount, maxCrossings);
      if (fit && !sameCellSet(fit.cells, excludeCells)) return fit;
    }
    return null; // Never found a spot (rare) — the word is dropped from this puzzle, see AGENTS.md.
  }

  function categorySubcategories(category) {
    const cat = WORDS[category];
    return (cat && cat.subcategories) || null;
  }

  // Some categories (currently just "animals") are split into named subcategories, each of which
  // — like a plain category — holds several curated word-sets; picking one whole set per puzzle
  // (rather than sampling across the pool) keeps a single game thematically tighter.
  // subcategoryId "mixed" (or omitted, for a category *with* subcategories) means "All Mixed":
  // pool every subcategory's every set together instead of picking just one.
  function pickWordSet(category, subcategoryId) {
    const subcats = categorySubcategories(category);
    if (subcats) {
      if (!subcategoryId || subcategoryId === "mixed") {
        const all = new Set();
        for (const sub of subcats) for (const set of sub.sets) for (const w of set.words) all.add(w);
        return [...all];
      }
      const sub = subcats.find((s) => s.id === subcategoryId);
      return (sub && sub.sets[randomInt(sub.sets.length)].words) || [];
    }
    const sets = (WORDS[category] && WORDS[category].sets) || [];
    return sets.length ? sets[randomInt(sets.length)].words || [] : [];
  }

  function buildPuzzle(category, subcategoryId, level) {
    const { minSize, maxSize, wordCount, maxCrossings } = LEVEL_CONFIG[level];
    const pool = shuffle(pickWordSet(category, subcategoryId).filter((w) => Array.from(w).length <= maxSize));
    const chosen = pool.slice(0, wordCount);

    const totalLetters = chosen.reduce((sum, w) => sum + Array.from(w).length, 0);
    const size = Math.max(minSize, Math.min(maxSize, Math.ceil(Math.sqrt(totalLetters / TARGET_FILL))));

    const g = Array.from({ length: size }, () => Array(size).fill(null));
    // How many words already pass through each cell — placeWord()/fitsAt() refuse to add one more
    // once a cell hits this level's maxCrossings, so puzzles don't get more tangled than intended.
    const crossCount = Array.from({ length: size }, () => Array(size).fill(0));
    const placedTarget = [];
    const firstPlacement = new Map(); // word -> its first-placement cells, for the bonus pass below

    const orderedChosen = [...chosen]
      .filter((w) => Array.from(w).length <= size)
      .sort((a, b) => Array.from(b).length - Array.from(a).length);
    for (const word of orderedChosen) {
      const fit = placeWord(word, size, g, crossCount, maxCrossings);
      if (!fit) continue;
      const letters = Array.from(word);
      fit.cells.forEach(([r, c], i) => {
        g[r][c] = letters[i];
        crossCount[r][c]++;
      });
      placedTarget.push(word);
      firstPlacement.set(word, fit.cells);
    }

    // Bonus words are not extra words to learn — they're 2 or 3 of the *already-required* words,
    // deliberately placed a second time elsewhere in the grid. Finding that second occurrence is
    // the bonus; the word itself was already on the list. See AGENTS.md "Bonus words".
    const duplicateCandidates = shuffle(placedTarget);
    const duplicateCount = Math.min(duplicateCandidates.length, 2 + randomInt(2));
    const bonusWords = [];
    for (let i = 0; i < duplicateCount; i++) {
      const word = duplicateCandidates[i];
      const fit = placeWord(word, size, g, crossCount, maxCrossings, firstPlacement.get(word));
      if (!fit) continue; // no room for a second occurrence — this word just isn't a bonus this time
      const letters = Array.from(word);
      fit.cells.forEach(([r, c], i2) => {
        g[r][c] = letters[i2];
        crossCount[r][c]++;
      });
      bonusWords.push(word);
    }

    const alphabet = ALPHABETS[currentLang];
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (g[r][c] === null) g[r][c] = alphabet[randomInt(alphabet.length)];
      }
    }

    return { grid: g, size, targetWords: placedTarget, bonusWords };
  }

  function generateNewPuzzle(category, subcategoryId, level) {
    currentCategory = category;
    currentSubcategory = subcategoryId || null;
    wordLevel = level;
    localStorage.setItem(LEVEL_KEY, level);

    const built = buildPuzzle(category, currentSubcategory, level);
    grid = built.grid;
    gridSize = built.size;
    targetWords = built.targetWords;
    bonusWords = built.bonusWords;
    found = [];
    bonusFound = [];
    selection = [];
    direction = null;
    gameOver = false;
    statsRecorded = false;
    pausedElapsedMs = 0;
    startTime = null;
    setPaused(true); // fresh puzzle starts on the "ready to play" screen, not a running timer
    stopTimerInterval();
    timerEl.textContent = formatTime(0);
    messageEl.textContent = "";

    incrementPlayedStat();
    renderBoard();
    renderWordList();
    updateFoundBadge();
    updateLevelBadge();
    saveState();
  }

  function pickRandomCategoryAndSubcategory() {
    const category = CATEGORIES[randomInt(CATEGORIES.length)];
    const subcats = categorySubcategories(category);
    if (!subcats) return { category, subcategory: null };
    // "mixed" (All Mixed) is just another option in the pool, not special-cased out of Random.
    const options = [...subcats.map((s) => s.id), "mixed"];
    return { category, subcategory: options[randomInt(options.length)] };
  }

  // What "New Game" (and a fresh app load with no saved puzzle) actually does depends on
  // categoryMode: "random" picks immediately, "select" opens the picker and waits for a tap —
  // generateNewPuzzle() only runs once a category (and subcategory, if any) is actually chosen.
  function startNewPuzzleFlow() {
    if (categoryMode === "select") {
      openCategorySelectModal();
    } else {
      const { category, subcategory } = pickRandomCategoryAndSubcategory();
      generateNewPuzzle(category, subcategory, wordLevel);
    }
  }

  // A single-screen tree, not a second "drill in" screen: navigating to a whole new list (even
  // with a Back row) read as an extra window bolted on. Each category is one row with two
  // independent click targets: tapping the *label* immediately starts an "All Mixed" puzzle for
  // that category (the common case — most people don't care which specific topic they get);
  // tapping the separate ▸ toggle expands/collapses that category's topics inline, indented
  // underneath, without picking anything or leaving the screen. Every category has subcategories
  // now (see AGENTS.md), so every row gets a toggle — no branching for a topic-less category.
  // Reads wordLevel fresh at pick time (not a captured param) so the difficulty picker duplicated
  // at the top of this same modal (see renderCategorySelectDifficulty()) can change it mid-picker.
  function renderCategoryTree() {
    const container = document.getElementById("category-select-list");
    container.innerHTML = "";
    const pick = (categoryId, subcategoryId) => {
      categorySelectModal.classList.add("hidden");
      generateNewPuzzle(categoryId, subcategoryId, wordLevel);
    };
    // Highlight whichever category/subcategory the puzzle on screen right now is actually using,
    // and pre-expand that category, so reopening the picker shows what's active instead of always
    // starting fully collapsed with no indication of the current selection.
    const isCurrentCategory = (id) => id === currentCategory;
    const isCurrentSub = (id, subId) => isCurrentCategory(id) && currentSubcategory === subId;

    CATEGORIES.forEach((id) => {
      const subcats = categorySubcategories(id);
      const isActiveCategory = isCurrentCategory(id);

      const row = document.createElement("div");
      row.className = "tree-row";

      const toggleBtn = document.createElement("button");
      toggleBtn.type = "button";
      toggleBtn.className = "tree-toggle";
      toggleBtn.textContent = isActiveCategory ? "▾" : "▸";
      toggleBtn.setAttribute("aria-expanded", String(isActiveCategory));
      toggleBtn.setAttribute("aria-label", t("expandLabel"));

      const labelBtn = document.createElement("button");
      labelBtn.type = "button";
      labelBtn.className = "menu-item select-row tree-label-btn" + (isActiveCategory ? " selected" : "");
      labelBtn.textContent = t(`category${capitalize(id)}`);

      row.appendChild(toggleBtn);
      row.appendChild(labelBtn);
      container.appendChild(row);

      const subContainer = document.createElement("div");
      subContainer.className = "tree-subcategories" + (isActiveCategory ? "" : " hidden");
      (subcats || []).forEach((sub) => {
        const subBtn = document.createElement("button");
        subBtn.type = "button";
        subBtn.className = "menu-item select-row tree-sub-row" + (isCurrentSub(id, sub.id) ? " selected" : "");
        subBtn.textContent = sub.name;
        subBtn.addEventListener("click", () => pick(id, sub.id));
        subContainer.appendChild(subBtn);
      });
      // "All Mixed" is a subcategory-list row like any other, not a shortcut hidden behind the
      // category label — the label's only job now is expand/collapse, same as the ▸ toggle, so
      // tapping a category never surprises someone by starting a puzzle before they've seen the
      // topic list.
      const mixedBtn = document.createElement("button");
      mixedBtn.type = "button";
      mixedBtn.className =
        "menu-item select-row tree-sub-row tree-mixed-row" + (isCurrentSub(id, "mixed") ? " selected" : "");
      mixedBtn.textContent = t("allMixedLabel");
      mixedBtn.addEventListener("click", () => pick(id, "mixed"));
      subContainer.appendChild(mixedBtn);
      container.appendChild(subContainer);

      // Label and toggle are two buttons doing the exact same thing (expand/collapse) — the
      // whole row is one click target in effect, not "tap label to pick, tap arrow to browse".
      const toggle = () => {
        const nowHidden = subContainer.classList.toggle("hidden");
        toggleBtn.textContent = nowHidden ? "▸" : "▾";
        toggleBtn.setAttribute("aria-expanded", String(!nowHidden));
      };
      toggleBtn.addEventListener("click", toggle);
      labelBtn.addEventListener("click", toggle);

      if (isActiveCategory) {
        // Scroll the active category into view once the modal has actually laid out.
        requestAnimationFrame(() => row.scrollIntoView({ block: "nearest" }));
      }
    });

    // A one-off convenience action, not the same thing as switching categoryMode to "random":
    // this picks once, right now, from within the Select picker, and leaves categoryMode alone —
    // the next time New Game runs, Select mode still opens this same picker rather than silently
    // becoming Random mode because someone used this row once.
    const randomRow = document.createElement("button");
    randomRow.type = "button";
    randomRow.className = "menu-item select-row tree-random-row";
    randomRow.textContent = t("randomPickLabel");
    randomRow.addEventListener("click", () => {
      const { category, subcategory } = pickRandomCategoryAndSubcategory();
      pick(category, subcategory);
    });
    container.appendChild(randomRow);
  }

  // Difficulty is duplicated here (same LEVELS/buildRadioOptions as the main "⋮" menu) so picking
  // a category and setting the difficulty for it can happen in one place — without this, Select
  // mode meant closing the picker, going back into the menu for difficulty, then New Game again.
  function renderCategorySelectDifficulty() {
    buildRadioOptions(
      document.getElementById("category-select-level-options"),
      LEVELS.map((l) => ({ value: l, label: t(`level${capitalize(l)}`) })),
      wordLevel,
      (value) => {
        if (value === wordLevel) return;
        wordLevel = value;
        localStorage.setItem(LEVEL_KEY, value);
        renderCategorySelectDifficulty();
        renderMenus(); // keep the "⋮" menu's own difficulty radio in sync with this duplicate picker
      }
    );
  }

  function openCategorySelectModal() {
    document.getElementById("category-select-title").textContent = t("selectCategoryTitle");
    document.getElementById("category-select-hint").textContent = t("selectCategoryHint");
    renderCategorySelectDifficulty();
    renderCategoryTree();
    categorySelectModal.classList.remove("hidden");
  }

  function isAdjacent(a, b) {
    const dr = b[0] - a[0];
    const dc = b[1] - a[1];
    return Math.abs(dr) <= 1 && Math.abs(dc) <= 1 && !(dr === 0 && dc === 0);
  }

  function cellKey(r, c) {
    return `${r},${c}`;
  }

  const WORD_COLOR_COUNT = 8;

  // Each target word gets a stable color by its position in targetWords (fixed once a puzzle is generated),
  // so the same word always renders the same color across re-renders and reloads.
  function wordColorIndex(word) {
    const idx = targetWords.indexOf(word);
    return (idx < 0 ? 0 : idx) % WORD_COLOR_COUNT;
  }

  // A cell shared by N words is split into N equal pie-slice wedges, one per word's color — works
  // the same way for 2, 3, or 4+ crossings instead of special-casing the 2-way split.
  function overlapGradient(colorIndexes) {
    const step = 360 / colorIndexes.length;
    const stops = colorIndexes
      .map((idx, i) => `var(--word-${idx}) ${i * step}deg ${(i + 1) * step}deg`)
      .join(", ");
    return `conic-gradient(${stops})`;
  }

  function wordsCoveringCell(r, c) {
    return found.filter((f) => f.cells.some(([fr, fc]) => fr === r && fc === c)).map((f) => f.word);
  }

  function bonusWordsCoveringCell(r, c) {
    return bonusFound.some((f) => f.cells.some(([fr, fc]) => fr === r && fc === c));
  }

  function handleCellTap(r, c) {
    // Taps are only reachable once the "ready to play"/pause overlay has been dismissed via
    // togglePause(), which is what starts the timer now — no separate "first tap starts it" path.
    if (gameOver || paused) return;

    if (selection.length === 0) {
      selection = [[r, c]];
      direction = null;
    } else {
      const last = selection[selection.length - 1];
      const sameAsLast = last[0] === r && last[1] === c;
      if (sameAsLast) {
        selection.pop();
        if (selection.length <= 1) direction = null;
      } else if (selection.length === 1) {
        if (isAdjacent(selection[0], [r, c])) {
          direction = [Math.sign(r - selection[0][0]), Math.sign(c - selection[0][1])];
          selection.push([r, c]);
        } else {
          selection = [[r, c]];
          direction = null;
        }
      } else {
        const [dr, dc] = direction;
        const expectedR = last[0] + dr;
        const expectedC = last[1] + dc;
        if (expectedR === r && expectedC === c) {
          selection.push([r, c]);
        } else {
          selection = [[r, c]];
          direction = null;
        }
      }
    }

    renderSelection();
    checkMatch();
    saveState();
  }

  // Hit-tests the actual DOM under a pointer's current coordinates, not just the element that
  // originally received pointerdown — needed because touch (and a fast mouse drag) can move past
  // a cell's bounds between events, and touch additionally keeps re-targeting events at the
  // original element unless we do this ourselves.
  function cellFromPoint(x, y) {
    const rect = boardEl.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    // Continuous position in cell units (e.g. 2.5 means "half way across the 3rd column"), not a
    // DOM hit-test — elementFromPoint() would return null over #board's inter-cell gap pixels.
    // Deliberately just the plain nearest cell, immediately, on every call — no threshold, no
    // "wait and see" delay. Selecting on hover means the letter under the pointer right now is
    // the one that gets applied; see handlePointerMove() for how ambiguity near a diagonal is
    // resolved instead (by being willing to revise a provisional pick, not by delaying the pick).
    const colF = ((x - rect.left) / rect.width) * gridSize;
    const rowF = ((y - rect.top) / rect.height) * gridSize;
    if (colF < 0 || colF >= gridSize || rowF < 0 || rowF >= gridSize) return null;
    return [Math.floor(rowF), Math.floor(colF)];
  }

  function handlePointerDown(r, c, e) {
    if (gameOver || paused) return;
    if (e.pointerType === "mouse" && e.button !== 0) return; // left button only
    if (dragPointerId !== null) return; // a drag is already in progress (ignore extra touches)
    dragPointerId = e.pointerId;
    dragStartCell = [r, c];
    dragLastCell = null;
    dragMoved = false;
    // Applying the start cell is deferred to the first real move (see handlePointerMove) so a
    // plain tap — pointerdown then pointerup with no movement — is left entirely to the normal
    // "click" handler below, exactly as it worked before drag support existed.
  }

  // Pure predicate mirroring handleCellTap()'s own extend/undo rules, without mutating anything —
  // used once a drag's direction is fully confirmed (selection.length >= 3, see handlePointerMove)
  // to tell "the pointer reached the next real cell" apart from "the pointer's path is currently
  // passing near/through some unrelated cell it shouldn't reset the selection over."
  function isValidDragContinuation(r, c) {
    const last = selection[selection.length - 1];
    if (last[0] === r && last[1] === c) return true; // dragging back over the last cell = undo
    const [dr, dc] = direction;
    return last[0] + dr === r && last[1] + dc === c;
  }

  function handlePointerMove(e) {
    if (dragPointerId === null || e.pointerId !== dragPointerId) return;

    if (!dragMoved) {
      dragMoved = true;
      e.preventDefault(); // once it's a real drag, stop the page from also trying to scroll
      handleCellTap(dragStartCell[0], dragStartCell[1]);
      dragLastCell = dragStartCell;
    }

    const cell = cellFromPoint(e.clientX, e.clientY);
    if (!cell) return;
    const [r, c] = cell;
    if (dragLastCell && dragLastCell[0] === r && dragLastCell[1] === c) return; // no change

    if (selection.length === 0) {
      // A word was just completed mid-drag — checkMatch() clears selection/direction on a match,
      // but the physical drag gesture (finger/button still down) is still active. Re-anchor right
      // here rather than erroring out on stale state, or silently going dead for the rest of the
      // gesture; this also means one continuous drag can find several words back-to-back.
      dragStartCell = [r, c];
      dragLastCell = [r, c];
      handleCellTap(r, c);
      return;
    }

    if (selection.length === 2) {
      // Picking letter 2 (done, see below) and the transition into letter 3 are *both* where
      // diagonal dragging used to break ("select by diagonal — it is impossible", a real reported
      // bug): diagonal neighbors share only a single corner point (orthogonal neighbors share a
      // full edge), so a diagonal drag's pixel path routinely grazes the corner of an unrelated
      // orthogonal neighbor along the way — between letter 1 and letter 2, *and* just as easily
      // between letter 2 and letter 3. The one rule that fixes both: once we know where we are
      // (letter 2 chosen), only ever *apply* a hover that's unambiguously one of the few sensible
      // next moves, and otherwise just wait for the next hover — never hard-reset over a stray
      // in-between cell the pointer's path happened to clip.
      const start = selection[0];
      const last = selection[1];
      const [dr, dc] = direction;
      if (last[0] + dr === r && last[1] + dc === c) {
        // Confirmed: advancing to an actual letter 3. From here this drag is fully locked (below).
        dragLastCell = [r, c];
        handleCellTap(r, c);
        return;
      }
      if (r === start[0] && c === start[1]) {
        handleCellTap(last[0], last[1]); // back on letter 1: undo the provisional letter 2
        dragLastCell = [r, c];
        return;
      }
      if (isAdjacent(start, [r, c]) && !(r === last[0] && c === last[1])) {
        // A different neighbor of letter 1 than the current provisional pick — a genuine, live
        // correction of which direction the word is going, not ambiguous corner-clip noise.
        handleCellTap(last[0], last[1]); // undo the old provisional pick
        handleCellTap(r, c); // apply the new one
        dragLastCell = [r, c];
        return;
      }
      return; // ambiguous — e.g. a corner clipped mid-flight to letter 3 — wait for the next hover
    }

    if (selection.length === 1) {
      // Establishing letter 2 for the first time: apply immediately on hover if it's a genuine
      // neighbor of letter 1; otherwise wait (same "don't reset on ambiguous noise" rule as above —
      // there's nothing to undo yet at this stage, so simply ignoring is enough).
      const start = selection[0];
      if (isAdjacent(start, [r, c])) {
        handleCellTap(r, c);
        dragLastCell = [r, c];
      }
      return;
    }

    // 3+ letters selected: direction is fully confirmed. Only ever apply the one cell that's
    // actually the next real step (or the undo-last case) — anything else the pointer's path
    // happens to graze is ignored rather than treated as "start a fresh selection here."
    if (!isValidDragContinuation(r, c)) return;
    dragLastCell = [r, c];
    handleCellTap(r, c);
  }

  function handlePointerUp(e) {
    if (dragPointerId === null || e.pointerId !== dragPointerId) return;
    dragPointerId = null;
    if (!dragMoved) {
      // Never left the starting cell: a plain tap. Apply it right here rather than waiting for the
      // browser's own trailing "click" — whether/when that fires (and whether it's suppressed at
      // all) varies by pointer type and gesture, so it can't be the thing we depend on for the
      // actual game logic; see AGENTS.md.
      handleCellTap(dragStartCell[0], dragStartCell[1]);
    }
    // Either the tap was just applied above, or a real drag already applied every cell it touched
    // via handleCellTap() inside handlePointerMove — either way, a trailing "click" event (if the
    // browser fires one at all) would just be a duplicate. The timeout is a safety net: if no click
    // shows up (common after a real touch drag), the flag can't stay stuck and swallow a later tap.
    suppressNextClick = true;
    setTimeout(() => {
      suppressNextClick = false;
    }, 300);
    dragStartCell = null;
    dragLastCell = null;
    dragMoved = false;
  }

  document.addEventListener("pointermove", handlePointerMove);
  document.addEventListener("pointerup", handlePointerUp);
  document.addEventListener("pointercancel", handlePointerUp);

  function selectedWord() {
    return selection.map(([r, c]) => grid[r][c]).join("");
  }

  function checkMatch() {
    if (selection.length < 2) return;
    const text = selectedWord();

    const already = found.find((f) => f.word === text);
    if (already) {
      if (sameCellSet(already.cells, selection)) return; // retracing the same occurrence — no-op
      // A different set of cells spelling a word already found means this is its bonus duplicate
      // occurrence (see buildPuzzle()) — but only if this word was actually chosen as one of this
      // puzzle's bonusWords, and only the first time it's spotted there.
      if (bonusWords.includes(text) && !bonusFound.some((f) => f.word === text)) {
        bonusFound.push({ word: text, cells: selection });
        selection = [];
        direction = null;
        renderBoard();
        renderWordList();
        updateFoundBadge();
        recordBonusFound();
      }
      return;
    }

    if (targetWords.includes(text)) {
      found.push({ word: text, cells: selection });
      selection = [];
      direction = null;
      renderBoard();
      renderWordList();
      updateFoundBadge();
      if (found.length === targetWords.length) finishPuzzle();
    }
  }

  function finishPuzzle() {
    gameOver = true;
    pauseBtn.disabled = true;
    stopTimerInterval();
    const elapsed = Math.floor(elapsedMs() / 1000);
    messageEl.textContent = t("winMessage", formatTime(elapsed));
    if (!statsRecorded) {
      statsRecorded = true;
      recordCompletion(elapsed);
    }
  }

  function elapsedMs() {
    return pausedElapsedMs + (startTime ? Date.now() - startTime : 0);
  }

  // True once the puzzle has actually begun (some time banked, a segment ticking, or a word
  // found) — false for a freshly generated puzzle sitting on its "ready to play" overlay.
  function hasStarted() {
    return pausedElapsedMs > 0 || startTime !== null || found.length > 0;
  }

  function setPaused(next) {
    paused = next;
    pauseBtn.disabled = gameOver;
    pauseBtn.textContent = paused ? "▶" : "⏸";
    pauseBtn.setAttribute("aria-label", t(paused ? "resumeBtn" : "pauseBtn"));
    pauseBtn.title = t(paused ? "resumeBtn" : "pauseBtn");
    pauseOverlay.classList.toggle("hidden", !paused);
    boardWrapEl.classList.toggle("paused", paused);
    wordListEl.classList.toggle("paused", paused);

    // The overlay doubles as both the "ready to play" start screen and the pause screen —
    // same mechanism (unhide the board, start a ticking segment), different framing.
    if (paused) {
      const fresh = !hasStarted();
      pauseOverlayIcon.textContent = fresh ? "▶" : "⏸";
      pauseOverlayLabel.textContent = t(fresh ? "readyLabel" : "pausedLabel");
      resumeBtn.textContent = t(fresh ? "startBtn" : "resumeBtn");
    }
  }

  // Also serves as "Start": a fresh puzzle begins paused (see generateNewPuzzle), so the very
  // first call here — startTime null, nothing banked — both unhides the board and starts the clock.
  function togglePause() {
    if (gameOver) return;
    if (paused) {
      startTime = Date.now();
      setPaused(false);
      startTimerInterval();
    } else {
      if (!startTime) return; // nothing actively ticking to pause
      pausedElapsedMs = elapsedMs();
      startTime = null;
      stopTimerInterval();
      updateTimerDisplay(); // sync immediately -- don't wait for a tick that will never come
      setPaused(true);
    }
    saveState();
  }

  pauseBtn.addEventListener("click", togglePause);
  pauseOverlay.addEventListener("click", togglePause);

  function formatTime(totalSeconds) {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function updateTimerDisplay() {
    timerEl.textContent = formatTime(Math.floor(elapsedMs() / 1000));
  }

  function startTimerInterval() {
    stopTimerInterval();
    updateTimerDisplay();
    timerInterval = setInterval(updateTimerDisplay, 1000);
  }

  function stopTimerInterval() {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = null;
  }

  function renderBoard() {
    boardEl.innerHTML = "";
    // Set on the shared wrapper (not #board) so #badge-layer — a sibling, not a descendant of
    // #board — inherits the same --cols and its grid tracks line up with #board's exactly.
    boardWrapEl.style.setProperty("--cols", gridSize);
    cellEls = Array.from({ length: gridSize }, () => Array(gridSize).fill(null));
    for (let r = 0; r < gridSize; r++) {
      for (let c = 0; c < gridSize; c++) {
        const cell = document.createElement("button");
        cell.type = "button";
        cell.className = "cell";
        cell.textContent = grid[r][c];
        cell.setAttribute("role", "gridcell");
        cell.dataset.row = r;
        cell.dataset.col = c;
        const coveringWords = wordsCoveringCell(r, c);
        if (coveringWords.length === 1) {
          cell.classList.add("found", `word-color-${wordColorIndex(coveringWords[0])}`);
        } else if (coveringWords.length > 1) {
          // Split the cell into as many equal wedges as words cross through it here (2, 3, 4+) —
          // a fixed 2-way gradient used to be reused as-is for 3+ crossings, silently mislabeling a
          // triple-crossing cell as a plain 2-way split. See AGENTS.md.
          cell.classList.add("found");
          cell.style.background = overlapGradient(coveringWords.map(wordColorIndex));
        } else if (bonusWordsCoveringCell(r, c)) {
          // A found target word always wins the cell's color over a bonus word sharing it — bonus
          // styling only shows where a cell belongs to a bonus find and nothing else.
          cell.classList.add("bonus");
        }
        cell.addEventListener("pointerdown", (e) => handlePointerDown(r, c, e));
        cell.addEventListener("click", () => {
          if (suppressNextClick) {
            suppressNextClick = false;
            return;
          }
          handleCellTap(r, c);
        });
        boardEl.appendChild(cell);
        cellEls[r][c] = cell;
      }
    }
    selectedEls = [];
    renderSelection();
    updateCellFontSize();
  }

  // Ties letter size to the actual rendered cell box rather than viewport width, so it's correct
  // in both orientations and at every difficulty's column count (see the --cell-size comment in
  // style.css for why a vw-based formula didn't work: it's decoupled from the real cell size).
  function updateCellFontSize() {
    if (!gridSize) return;
    const cellPx = boardWrapEl.getBoundingClientRect().width / gridSize;
    boardWrapEl.style.setProperty("--cell-size", `${cellPx}px`);
  }

  let resizeRaf = null;
  window.addEventListener("resize", () => {
    if (resizeRaf) return;
    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = null;
      updateCellFontSize();
    });
  });

  function renderSelection() {
    selectedEls.forEach((el) => el.classList.remove("selected"));
    selectedEls = [];
    badgeLayerEl.innerHTML = "";
    selection.forEach(([r, c], i) => {
      const el = cellEls[r][c];
      if (!el) return;
      el.classList.add("selected");
      selectedEls.push(el);

      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = String(i + 1);
      badge.style.gridRow = String(r + 1);
      badge.style.gridColumn = String(c + 1);
      badgeLayerEl.appendChild(badge);
    });
  }

  function renderWordList() {
    wordListEl.innerHTML = "";
    targetWords.forEach((word) => {
      const item = document.createElement("span");
      item.className = "word-chip";
      item.setAttribute("role", "listitem");
      // A word can be found normally (its first occurrence) and later, separately, found again as
      // a bonus (its deliberately-duplicated second occurrence, see buildPuzzle()) — the star only
      // appears once the bonus occurrence specifically has been spotted, on top of the normal find.
      const isBonusFound = bonusFound.some((f) => f.word === word);
      if (isBonusFound) {
        item.classList.add("found", "bonus-chip-found");
        item.textContent = `★ ${word}`;
      } else {
        item.textContent = word;
        if (found.some((f) => f.word === word)) item.classList.add("found", `word-color-${wordColorIndex(word)}`);
      }
      wordListEl.appendChild(item);
    });
  }

  function updateFoundBadge() {
    let text = t("wordsFoundOf", found.length, targetWords.length);
    // Bonus progress rides alongside the normal count rather than replacing it — a bonus find
    // never counts toward found.length/targetWords.length, so without this it'd be invisible here.
    if (bonusWords.length > 0) text += ` ★${bonusFound.length}/${bonusWords.length}`;
    foundBadgeEl.textContent = text;
  }

  function updateLevelBadge() {
    levelBadgeEl.textContent = t(`level${capitalize(wordLevel)}`);
    levelBadgeEl.className = `level-badge visible ${wordLevel}`;
  }

  function saveState() {
    const state = {
      category: currentCategory,
      subcategory: currentSubcategory,
      level: wordLevel,
      size: gridSize,
      grid,
      targetWords,
      bonusWords,
      found,
      bonusFound,
      gameOver,
      statsRecorded,
      elapsedMsAtSave: elapsedMs(),
      // A ticking segment (startTime set, not paused) resumes automatically on reload; a paused
      // one stays paused (and hidden) so reloading mid-pause doesn't quietly reveal the board.
      timerWasRunning: !gameOver && !paused && startTime !== null,
      wasPaused: paused,
    };
    localStorage.setItem(storageKey(), JSON.stringify(state));
  }

  function loadState() {
    const raw = localStorage.getItem(storageKey());
    if (!raw) return false;
    let state;
    try {
      state = JSON.parse(raw);
    } catch {
      return false;
    }
    if (!state || !Array.isArray(state.grid) || !Array.isArray(state.targetWords)) return false;

    currentCategory = CATEGORIES.includes(state.category) ? state.category : currentCategory;
    currentSubcategory = typeof state.subcategory === "string" ? state.subcategory : null;
    wordLevel = LEVELS.includes(state.level) ? state.level : wordLevel;
    grid = state.grid;
    gridSize = state.size || grid.length;
    targetWords = state.targetWords;
    bonusWords = Array.isArray(state.bonusWords) ? state.bonusWords : [];
    found = Array.isArray(state.found) ? state.found : [];
    bonusFound = Array.isArray(state.bonusFound) ? state.bonusFound : [];
    gameOver = Boolean(state.gameOver);
    statsRecorded = Boolean(state.statsRecorded);
    selection = [];
    direction = null;

    pausedElapsedMs = state.elapsedMsAtSave || 0;
    if (state.timerWasRunning && !gameOver) {
      startTime = Date.now();
      startTimerInterval();
    } else {
      startTime = null;
    }
    timerEl.textContent = formatTime(Math.floor(pausedElapsedMs / 1000));

    renderBoard();
    renderWordList();
    updateFoundBadge();
    updateLevelBadge();
    setPaused(Boolean(state.wasPaused) && !gameOver);
    if (gameOver) {
      messageEl.textContent = t("winMessage", formatTime(Math.floor(pausedElapsedMs / 1000)));
    }
    return true;
  }

  function defaultStats() {
    return { played: 0, completed: 0, wordsFound: 0, bonusWordsFound: 0, bestTimes: { easy: null, moderate: null, hard: null } };
  }

  function loadStats() {
    const raw = localStorage.getItem(statsKey());
    if (!raw) return defaultStats();
    try {
      const parsed = JSON.parse(raw);
      return {
        played: parsed.played || 0,
        completed: parsed.completed || 0,
        wordsFound: parsed.wordsFound || 0,
        bonusWordsFound: parsed.bonusWordsFound || 0,
        bestTimes: {
          easy: parsed.bestTimes?.easy ?? null,
          moderate: parsed.bestTimes?.moderate ?? null,
          hard: parsed.bestTimes?.hard ?? null,
        },
      };
    } catch {
      return defaultStats();
    }
  }

  function saveStats(stats) {
    localStorage.setItem(statsKey(), JSON.stringify(stats));
  }

  function incrementPlayedStat() {
    const stats = loadStats();
    stats.played += 1;
    saveStats(stats);
  }

  function recordCompletion(elapsedSeconds) {
    const stats = loadStats();
    stats.completed += 1;
    stats.wordsFound += targetWords.length;
    const best = stats.bestTimes[wordLevel];
    if (best === null || elapsedSeconds < best) stats.bestTimes[wordLevel] = elapsedSeconds;
    saveStats(stats);
  }

  // Bonus finds count toward stats immediately (not gated by statsRecorded/finishing the puzzle
  // like recordCompletion) since a bonus word is its own complete little win, not part of the
  // official completion condition.
  function recordBonusFound() {
    const stats = loadStats();
    stats.bonusWordsFound += 1;
    saveStats(stats);
  }

  function renderStatsModal() {
    const stats = loadStats();
    const summaryEl = document.getElementById("stats-summary");
    const bestTimesEl = document.getElementById("stats-best-times");
    summaryEl.innerHTML = "";
    const rows = [
      [t("statPlayed"), stats.played],
      [t("statCompleted"), stats.completed],
      [t("statWordsFound"), stats.wordsFound],
      [t("statBonusWordsFound"), stats.bonusWordsFound],
    ];
    rows.forEach(([label, value]) => {
      const row = document.createElement("div");
      row.className = "stat-row";
      row.innerHTML = `<span>${label}</span><strong>${value}</strong>`;
      summaryEl.appendChild(row);
    });

    bestTimesEl.innerHTML = "";
    LEVELS.forEach((level) => {
      const row = document.createElement("div");
      row.className = "stat-row";
      const time = stats.bestTimes[level];
      row.innerHTML = `<span>${t(`level${capitalize(level)}`)}</span><strong>${
        time === null ? t("noTimeYet") : formatTime(time)
      }</strong>`;
      bestTimesEl.appendChild(row);
    });
  }

  function capitalize(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function hasProgress() {
    // Not hasStarted() alone: a freshly generated puzzle is "paused" (sitting on its ready screen)
    // but has no actual progress to lose, so switching category/difficulty/language shouldn't warn.
    return !gameOver && hasStarted();
  }

  function requestFreshGame(action) {
    if (hasProgress()) {
      pendingConfirmAction = action;
      confirmModal.classList.remove("hidden");
    } else {
      action();
    }
  }

  function buildRadioOptions(container, options, activeValue, onSelect) {
    container.innerHTML = "";
    options.forEach(({ value, label }) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "lang-option" + (value === activeValue ? " selected" : "");
      btn.textContent = label;
      btn.setAttribute("role", "radio");
      btn.setAttribute("aria-checked", String(value === activeValue));
      btn.addEventListener("click", () => onSelect(value));
      container.appendChild(btn);
    });
  }

  function renderMenus() {
    // Category is no longer picked directly in the menu (28 categories × subcategories made that
    // list unusable) — instead this just toggles what "New Game" does: "random" picks immediately,
    // "select" opens the category-select modal. See startNewPuzzleFlow().
    buildRadioOptions(
      document.getElementById("category-options"),
      CATEGORY_MODES.map((m) => ({ value: m, label: t(`categoryMode${capitalize(m)}`) })),
      categoryMode,
      (value) => {
        if (value === categoryMode) return closeMenu();
        categoryMode = value;
        localStorage.setItem(CATEGORY_MODE_KEY, value);
        renderMenus();
        closeMenu();
      }
    );
    buildRadioOptions(
      document.getElementById("level-options"),
      LEVELS.map((l) => ({ value: l, label: t(`level${capitalize(l)}`) })),
      wordLevel,
      (value) => {
        if (value === wordLevel) return closeMenu();
        requestFreshGame(() => {
          generateNewPuzzle(currentCategory, currentSubcategory, value);
          renderMenus();
        });
        closeMenu();
      }
    );
    buildRadioOptions(
      document.getElementById("lang-options"),
      SUPPORTED_LANGS.map((l) => ({ value: l, label: LANGUAGE_NAMES[l] })),
      currentLang,
      (value) => {
        if (value === currentLang) return closeMenu();
        requestFreshGame(async () => {
          currentLang = value;
          localStorage.setItem(LANG_KEY, value);
          document.documentElement.lang = value;
          await loadWords();
          applyStaticTranslations();
          generateNewPuzzle(currentCategory, currentSubcategory, wordLevel);
          renderMenus();
        });
        closeMenu();
      }
    );
  }

  function applyStaticTranslations() {
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      el.textContent = t(el.getAttribute("data-i18n"));
    });
    document.querySelectorAll("[data-i18n-title]").forEach((el) => {
      const text = t(el.getAttribute("data-i18n-title"));
      el.title = text;
      el.setAttribute("aria-label", text);
    });
  }

  document.getElementById("help-btn").addEventListener("click", () => {
    helpModal.classList.remove("hidden");
    closeMenu();
  });
  document.getElementById("close-help-btn").addEventListener("click", () => {
    helpModal.classList.add("hidden");
  });

  document.getElementById("stats-btn").addEventListener("click", () => {
    renderStatsModal();
    statsModal.classList.remove("hidden");
    closeMenu();
  });
  document.getElementById("close-stats-btn").addEventListener("click", () => {
    statsModal.classList.add("hidden");
  });

  document.getElementById("new-game-btn").addEventListener("click", () => {
    requestFreshGame(() => startNewPuzzleFlow());
  });

  document.getElementById("confirm-ok-btn").addEventListener("click", () => {
    confirmModal.classList.add("hidden");
    const action = pendingConfirmAction;
    pendingConfirmAction = null;
    if (action) action();
  });
  document.getElementById("confirm-cancel-btn").addEventListener("click", () => {
    confirmModal.classList.add("hidden");
    pendingConfirmAction = null;
    renderMenus();
  });

  async function init() {
    currentLang = detectInitialLang();
    wordLevel = detectInitialLevel();
    categoryMode = detectInitialCategoryMode();
    document.documentElement.lang = currentLang;

    await loadWords();
    applyStaticTranslations();

    if (!loadState()) {
      startNewPuzzleFlow();
    }
    renderMenus();
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;

    // Local dev must always reflect whatever's currently on disk. sw.js's CACHE_NAME only changes
    // on a real deploy (the __CACHE_VERSION__ placeholder is substituted by CI, never locally), so
    // a service worker registered here would serve one fixed snapshot forever, silently ignoring
    // every subsequent edit and every ?v=N cache-bust — exactly the "why is this still old" bug
    // this comment exists to prevent someone from re-introducing. Actively unregister here too
    // (not just skip future registration) so a *previously* registered local SW self-heals on the
    // next load instead of requiring a manual DevTools "Unregister" from whoever hit this.
    if (["localhost", "127.0.0.1"].includes(location.hostname)) {
      navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => r.unregister()));
      if (window.caches) caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)));
      return;
    }

    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });

    // A new SW takes control after skipWaiting()/clients.claim() once the previous
    // page's assets are all replaced — reload once so the page picks up the update.
    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
  }

  init();
  registerServiceWorker();
})();
