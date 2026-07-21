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
  const LEVEL_CONFIG = {
    easy: { minSize: 7, maxSize: 9, wordCount: 8 },
    moderate: { minSize: 9, maxSize: 12, wordCount: 12 },
    hard: { minSize: 11, maxSize: 14, wordCount: 16 },
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
  let found = []; // [{ word, cells: [[r,c], ...] }]
  let bonusFound = []; // [{ word, cells: [[r,c], ...] }] — see checkMatch()/computeBonusPool()
  let bonusPool = new Set(); // words this puzzle instance will accept as bonus finds, see computeBonusPool()
  let selection = []; // [[r,c], ...]
  let direction = null; // [dr, dc], locked once selection.length >= 2
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
  const bonusListEl = document.getElementById("bonus-list");
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

  // Every word already authored for this category (across all its subcategories/sets) that ISN'T
  // one of this puzzle's targetWords. Short (3-4 letter) words from the category's other sets
  // often turn up by coincidence in the grid's filler letters or crossing points, so a player can
  // still get credit for spotting one — without inventing a separate bonus dictionary, since the
  // category's own curated content already has plenty of short words (see AGENTS.md).
  function computeBonusPool(categoryId, excludeWords) {
    const cat = WORDS[categoryId];
    const all = new Set();
    const sourceSets = cat && cat.subcategories
      ? cat.subcategories.flatMap((sub) => sub.sets)
      : (cat && cat.sets) || [];
    for (const set of sourceSets) for (const w of set.words) all.add(w);
    for (const w of excludeWords) all.delete(w);
    return all;
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
  // and how many of those cells already hold a matching letter (i.e. how much it crosses existing words).
  function fitsAt(letters, row, col, dr, dc, size, g) {
    const cells = [];
    let overlap = 0;
    for (let i = 0; i < letters.length; i++) {
      const r = row + dr * i;
      const c = col + dc * i;
      if (r < 0 || r >= size || c < 0 || c >= size) return null;
      const existing = g[r][c];
      if (existing !== null) {
        if (existing !== letters[i]) return null;
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
  function findOverlapPlacements(letters, size, g) {
    const results = [];
    for (let i = 0; i < letters.length; i++) {
      const letter = letters[i];
      for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
          if (g[r][c] !== letter) continue;
          for (const [dr, dc] of DIRECTIONS) {
            const row = r - dr * i;
            const col = c - dc * i;
            const fit = fitsAt(letters, row, col, dr, dc, size, g);
            if (fit && fit.overlap > 0) results.push({ dr, dc, ...fit });
          }
        }
      }
    }
    return results;
  }

  function placeWord(word, size, g) {
    const letters = Array.from(word);
    const overlapCandidates = shuffle(findOverlapPlacements(letters, size, g));
    if (overlapCandidates.length > 0) return overlapCandidates[0];

    for (let attempt = 0; attempt < MAX_PLACEMENT_ATTEMPTS; attempt++) {
      const [dr, dc] = DIRECTIONS[randomInt(DIRECTIONS.length)];
      const [minRow, maxRow] = bounds(dr, letters.length, size);
      const [minCol, maxCol] = bounds(dc, letters.length, size);
      if (minRow > maxRow || minCol > maxCol) continue;
      const row = minRow + randomInt(maxRow - minRow + 1);
      const col = minCol + randomInt(maxCol - minCol + 1);
      const fit = fitsAt(letters, row, col, dr, dc, size, g);
      if (fit) return fit;
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
    const { minSize, maxSize, wordCount } = LEVEL_CONFIG[level];
    const pool = pickWordSet(category, subcategoryId).filter((w) => Array.from(w).length <= maxSize);
    const chosen = shuffle(pool).slice(0, wordCount);

    const totalLetters = chosen.reduce((sum, w) => sum + Array.from(w).length, 0);
    const size = Math.max(minSize, Math.min(maxSize, Math.ceil(Math.sqrt(totalLetters / TARGET_FILL))));
    // A word longer than this puzzle's actual (possibly smaller-than-maxSize) grid can't be placed.
    const fittable = chosen.filter((w) => Array.from(w).length <= size);
    // Longer words are harder to fit; place them first for better packing.
    const ordered = [...fittable].sort((a, b) => Array.from(b).length - Array.from(a).length);

    const g = Array.from({ length: size }, () => Array(size).fill(null));
    const placed = [];

    for (const word of ordered) {
      const fit = placeWord(word, size, g);
      if (!fit) continue;
      const letters = Array.from(word);
      fit.cells.forEach(([r, c], i) => {
        g[r][c] = letters[i];
      });
      placed.push({ word, cells: fit.cells });
    }

    const alphabet = ALPHABETS[currentLang];
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (g[r][c] === null) g[r][c] = alphabet[randomInt(alphabet.length)];
      }
    }

    return { grid: g, size, targetWords: placed.map((p) => p.word) };
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
    found = [];
    bonusFound = [];
    bonusPool = computeBonusPool(category, targetWords);
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
    renderBonusList();
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
    CATEGORIES.forEach((id) => {
      const subcats = categorySubcategories(id);

      const row = document.createElement("div");
      row.className = "tree-row";

      const toggleBtn = document.createElement("button");
      toggleBtn.type = "button";
      toggleBtn.className = "tree-toggle";
      toggleBtn.textContent = "▸";
      toggleBtn.setAttribute("aria-expanded", "false");
      toggleBtn.setAttribute("aria-label", t("expandLabel"));

      const labelBtn = document.createElement("button");
      labelBtn.type = "button";
      labelBtn.className = "menu-item select-row tree-label-btn";
      labelBtn.textContent = t(`category${capitalize(id)}`);

      row.appendChild(toggleBtn);
      row.appendChild(labelBtn);
      container.appendChild(row);

      const subContainer = document.createElement("div");
      subContainer.className = "tree-subcategories hidden";
      (subcats || []).forEach((sub) => {
        const subBtn = document.createElement("button");
        subBtn.type = "button";
        subBtn.className = "menu-item select-row tree-sub-row";
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
      mixedBtn.className = "menu-item select-row tree-sub-row tree-mixed-row";
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

  function selectedWord() {
    return selection.map(([r, c]) => grid[r][c]).join("");
  }

  function checkMatch() {
    if (selection.length < 2) return;
    const text = selectedWord();

    if (targetWords.includes(text)) {
      if (found.some((f) => f.word === text)) return; // already claimed, not a fresh match
      found.push({ word: text, cells: selection });
      selection = [];
      direction = null;
      renderBoard();
      renderWordList();
      updateFoundBadge();
      if (found.length === targetWords.length) finishPuzzle();
      return;
    }

    // Not one of the puzzle's official words — but if it's a word from this category's own
    // pool that just wasn't picked for this puzzle (bonusPool), give credit for spotting it too.
    if (bonusPool.has(text) && !bonusFound.some((f) => f.word === text)) {
      bonusFound.push({ word: text, cells: selection });
      selection = [];
      direction = null;
      renderBoard();
      renderBonusList();
      recordBonusFound();
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
        const coveringWords = wordsCoveringCell(r, c);
        if (coveringWords.length === 1) {
          cell.classList.add("found", `word-color-${wordColorIndex(coveringWords[0])}`);
        } else if (coveringWords.length > 1) {
          cell.classList.add("found");
          const [a, b] = coveringWords;
          cell.style.background = `linear-gradient(135deg, var(--word-${wordColorIndex(a)}) 50%, var(--word-${wordColorIndex(b)}) 50%)`;
        } else if (bonusWordsCoveringCell(r, c)) {
          // A found target word always wins the cell's color over a bonus word sharing it — bonus
          // styling only shows where a cell belongs to a bonus find and nothing else.
          cell.classList.add("bonus");
        }
        cell.addEventListener("click", () => handleCellTap(r, c));
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
      item.textContent = word;
      item.setAttribute("role", "listitem");
      if (found.some((f) => f.word === word)) item.classList.add("found", `word-color-${wordColorIndex(word)}`);
      wordListEl.appendChild(item);
    });
  }

  function renderBonusList() {
    bonusListEl.innerHTML = "";
    bonusListEl.classList.toggle("hidden", bonusFound.length === 0);
    bonusFound.forEach(({ word }) => {
      const item = document.createElement("span");
      item.className = "word-chip bonus-chip";
      item.textContent = word;
      item.setAttribute("role", "listitem");
      bonusListEl.appendChild(item);
    });
  }

  function updateFoundBadge() {
    foundBadgeEl.textContent = t("wordsFoundOf", found.length, targetWords.length);
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
    found = Array.isArray(state.found) ? state.found : [];
    bonusFound = Array.isArray(state.bonusFound) ? state.bonusFound : [];
    bonusPool = computeBonusPool(currentCategory, targetWords);
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
    renderBonusList();
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
