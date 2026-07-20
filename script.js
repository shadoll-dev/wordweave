(function () {
  const LANG_KEY = "wordweave-lang";
  const LEVEL_KEY = "wordweave-level";
  const CATEGORY_KEY = "wordweave-category";
  const LANGUAGE_NAMES = { en: "English", uk: "Українська" };
  const SUPPORTED_LANGS = Object.keys(LANGUAGE_NAMES);
  const CATEGORIES = [
    "animals", "countries", "food", "colors", "sports", "space",
    "weather", "jobs", "vehicles", "clothing", "music",
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
  let WORDS = {};

  let grid = [];
  let gridSize = 0;
  let targetWords = [];
  let found = []; // [{ word, cells: [[r,c], ...] }]
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
  const foundBadgeEl = document.getElementById("found-badge");
  const levelBadgeEl = document.getElementById("level-badge");
  const timerEl = document.getElementById("timer");
  const pauseBtn = document.getElementById("pause-btn");
  const pauseOverlay = document.getElementById("pause-overlay");
  const helpModal = document.getElementById("help-modal");
  const statsModal = document.getElementById("stats-modal");
  const confirmModal = document.getElementById("confirm-modal");
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

  function detectInitialCategory() {
    const stored = localStorage.getItem(CATEGORY_KEY);
    return CATEGORIES.includes(stored) ? stored : CATEGORIES[0];
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

  // Each category holds several curated word-sets; picking one whole set per puzzle (rather than
  // sampling across the category's full pool) keeps a single game thematically tighter.
  function pickWordSet(category) {
    const sets = (WORDS[category] && WORDS[category].sets) || [];
    if (sets.length === 0) return [];
    return sets[randomInt(sets.length)].words || [];
  }

  function buildPuzzle(category, level) {
    const { minSize, maxSize, wordCount } = LEVEL_CONFIG[level];
    const pool = pickWordSet(category).filter((w) => Array.from(w).length <= maxSize);
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

  function generateNewPuzzle(category, level) {
    currentCategory = category;
    wordLevel = level;
    localStorage.setItem(CATEGORY_KEY, category);
    localStorage.setItem(LEVEL_KEY, level);

    const built = buildPuzzle(category, level);
    grid = built.grid;
    gridSize = built.size;
    targetWords = built.targetWords;
    found = [];
    selection = [];
    direction = null;
    gameOver = false;
    statsRecorded = false;
    pausedElapsedMs = 0;
    startTime = null;
    setPaused(false);
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

  function handleCellTap(r, c) {
    if (gameOver || paused) return;
    if (!startTime) {
      startTime = Date.now();
      startTimerInterval();
      pauseBtn.disabled = false;
    }

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
    const alreadyFound = found.some((f) => f.word === text);
    if (alreadyFound || !targetWords.includes(text)) return;

    found.push({ word: text, cells: selection });
    selection = [];
    direction = null;
    renderBoard();
    renderWordList();
    updateFoundBadge();

    if (found.length === targetWords.length) {
      finishPuzzle();
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

  function setPaused(next) {
    paused = next;
    // Nothing to pause/resume before the first tap ever happens (startTime null, nothing banked,
    // not already paused) — everything else (mid-game, or reloaded into a paused puzzle) is valid.
    pauseBtn.disabled = gameOver || (!paused && !startTime && pausedElapsedMs === 0);
    pauseBtn.textContent = paused ? "▶" : "⏸";
    pauseBtn.setAttribute("aria-label", t(paused ? "resumeBtn" : "pauseBtn"));
    pauseBtn.title = t(paused ? "resumeBtn" : "pauseBtn");
    pauseOverlay.classList.toggle("hidden", !paused);
    boardWrapEl.classList.toggle("paused", paused);
    wordListEl.classList.toggle("paused", paused);
  }

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

  function startTimerInterval() {
    stopTimerInterval();
    timerInterval = setInterval(() => {
      timerEl.textContent = formatTime(Math.floor(elapsedMs() / 1000));
    }, 1000);
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
        }
        cell.addEventListener("click", () => handleCellTap(r, c));
        boardEl.appendChild(cell);
        cellEls[r][c] = cell;
      }
    }
    selectedEls = [];
    renderSelection();
  }

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
      level: wordLevel,
      size: gridSize,
      grid,
      targetWords,
      found,
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
    wordLevel = LEVELS.includes(state.level) ? state.level : wordLevel;
    grid = state.grid;
    gridSize = state.size || grid.length;
    targetWords = state.targetWords;
    found = Array.isArray(state.found) ? state.found : [];
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
    return { played: 0, completed: 0, wordsFound: 0, bestTimes: { easy: null, moderate: null, hard: null } };
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

  function renderStatsModal() {
    const stats = loadStats();
    const summaryEl = document.getElementById("stats-summary");
    const bestTimesEl = document.getElementById("stats-best-times");
    summaryEl.innerHTML = "";
    const rows = [
      [t("statPlayed"), stats.played],
      [t("statCompleted"), stats.completed],
      [t("statWordsFound"), stats.wordsFound],
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
    return !gameOver && (startTime !== null || paused || found.length > 0);
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
    buildRadioOptions(
      document.getElementById("category-options"),
      CATEGORIES.map((c) => ({ value: c, label: t(`category${capitalize(c)}`) })),
      currentCategory,
      (value) => {
        if (value === currentCategory) return closeMenu();
        requestFreshGame(() => {
          generateNewPuzzle(value, wordLevel);
          renderMenus();
        });
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
          generateNewPuzzle(currentCategory, value);
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
          generateNewPuzzle(currentCategory, wordLevel);
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
    requestFreshGame(() => generateNewPuzzle(currentCategory, wordLevel));
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
    currentCategory = detectInitialCategory();
    document.documentElement.lang = currentLang;

    await loadWords();
    applyStaticTranslations();

    if (!loadState()) {
      generateNewPuzzle(currentCategory, wordLevel);
    }
    renderMenus();
  }

  init();
})();
