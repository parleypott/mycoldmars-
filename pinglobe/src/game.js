import { getClueSet } from './clues.js';
import { haversine, kmToMiles, pointInFeature } from './geo-utils.js';
import { getCountryFeatures } from './countries.js';

export class Game {
  constructor() {
    this.clues = [];
    this.currentClueIndex = 0;
    this.pinsPerClue = [];
    this.totalPins = 0;
    this.isActive = false;
    this.currentClueResolved = false;
    this.difficulty = 'easy';
    this.countryFeatures = getCountryFeatures();

    this.els = {
      clueNumber: document.getElementById('clue-number'),
      clueText: document.getElementById('clue-text'),
      clueAnswer: document.getElementById('clue-answer'),
      scoreDisplay: document.getElementById('score-display'),
      scorecard: document.getElementById('scorecard'),
      scorecardBody: document.getElementById('scorecard-body'),
      scorecardTotal: document.getElementById('scorecard-total'),
      scorecardBadge: document.getElementById('scorecard-badge'),
      scorecardBrand: document.getElementById('scorecard-brand'),
      startScreen: document.getElementById('start-screen'),
      scoreLedger: document.getElementById('score-ledger'),
      ledgerRows: document.getElementById('ledger-rows'),
      ledgerTotal: document.getElementById('ledger-total'),
      ledgerPinLabel: document.getElementById('ledger-pin-label'),
      gamePanel: document.getElementById('game-panel'),
    };
  }

  setDifficulty(diff) {
    this.difficulty = diff;
  }

  startRound() {
    this.clues = getClueSet(this.difficulty);
    this.currentClueIndex = 0;
    this.pinsPerClue = new Array(this.clues.length).fill(0);
    this.totalPins = 0;
    this.isActive = true;
    this.currentClueResolved = false;

    this.els.startScreen.classList.add('hidden');
    this.els.scorecard.classList.add('hidden');
    this.els.gamePanel.classList.remove('hidden');

    // Show ledger, clear rows
    this.els.ledgerRows.innerHTML = '';
    this.els.ledgerTotal.textContent = '0';
    this.els.ledgerPinLabel.textContent = `${this.clues.length} CLUES`;
    this.els.scoreLedger.classList.remove('hidden');

    this.updateUI();
  }

  getCurrentClue() {
    if (this.currentClueIndex >= this.clues.length) return null;
    return this.clues[this.currentClueIndex];
  }

  checkGuess(lat, lon) {
    const clue = this.getCurrentClue();
    if (!clue || this.currentClueResolved) return null;

    this.pinsPerClue[this.currentClueIndex]++;
    this.totalPins++;

    let correct = false;
    let distanceKm = haversine(lat, lon, clue.center.lat, clue.center.lon);

    if (clue.type === 'country') {
      const feature = this.countryFeatures.find(f => f.id === clue.countryId);
      if (feature) correct = pointInFeature(lat, lon, feature);
    } else {
      correct = distanceKm <= clue.acceptRadius;
    }

    if (correct) this.currentClueResolved = true;
    this.updateUI();

    return {
      correct,
      pinsUsed: this.pinsPerClue[this.currentClueIndex],
      distanceKm: Math.round(distanceKm),
      distanceMi: Math.round(kmToMiles(distanceKm)),
      targetLat: clue.center.lat,
      targetLon: clue.center.lon,
      blurb: correct ? clue.blurb : null,
      answer: correct ? clue.answer : null,
    };
  }

  nextClue() {
    this.currentClueIndex++;
    this.currentClueResolved = false;

    if (this.currentClueIndex >= this.clues.length) {
      this.isActive = false;
      this.showScorecard();
      return false;
    }

    this.updateUI();
    return true;
  }

  updateUI() {
    const clue = this.getCurrentClue();
    if (!clue) return;

    const num = String(this.currentClueIndex + 1).padStart(2, '0');
    const total = String(this.clues.length).padStart(2, '0');
    this.els.clueNumber.textContent = `${num}/${total}`;
    this.els.clueText.textContent = clue.clue.toUpperCase();
    this.els.scoreDisplay.textContent = this.totalPins;

    if (this.currentClueResolved) {
      this.els.clueAnswer.textContent = clue.answer;
      this.els.clueAnswer.classList.remove('hidden');
    } else {
      this.els.clueAnswer.classList.add('hidden');
    }
  }

  addLedgerRow(clueIndex) {
    const clue = this.clues[clueIndex];
    const pins = this.pinsPerClue[clueIndex];
    const tier = pins === 1 ? 'perfect' : pins <= 3 ? 'good' : 'rough';

    const squares = Array.from({ length: pins }, (_, j) => {
      const type = j < pins - 1 ? 'wrong' : 'correct';
      return `<span class="pin-square ${type}"></span>`;
    }).join('');

    const row = document.createElement('div');
    row.className = 'ledger-row';
    row.innerHTML = `
      <span class="ledger-name">${clue.answer}</span>
      <span class="ledger-pins">${squares}</span>
      <span class="ledger-count ${tier}">${pins}</span>
    `;
    this.els.ledgerRows.appendChild(row);

    // Update running total with bump animation
    this.els.ledgerTotal.textContent = this.totalPins;
    this.els.ledgerTotal.classList.remove('bump');
    this.els.ledgerTotal.offsetHeight; // force reflow
    this.els.ledgerTotal.classList.add('bump');
  }

  _truncateClue(text, max = 40) {
    if (text.length <= max) return text;
    return text.slice(0, max).trimEnd() + '...';
  }

  showScorecard() {
    // Hide game panel and ledger
    this.els.gamePanel.classList.add('hidden');
    this.els.scoreLedger.classList.add('hidden');

    // Difficulty badge
    if (this.difficulty === 'hard') {
      this.els.scorecardBadge.className = 'badge-hard';
      this.els.scorecardBadge.innerHTML = `
        <svg class="hard-seal" viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <clipPath id="seal-clip"><circle cx="60" cy="60" r="56"/></clipPath>
          </defs>
          <!-- Outer ornamental ring -->
          <circle cx="60" cy="60" r="58" fill="none" stroke="currentColor" stroke-width="1.5"/>
          <circle cx="60" cy="60" r="54" fill="none" stroke="currentColor" stroke-width="0.5"/>
          <!-- Notched edge -->
          ${Array.from({ length: 36 }, (_, i) => {
            const a = (i * 10) * Math.PI / 180;
            const x1 = 60 + Math.cos(a) * 54;
            const y1 = 60 + Math.sin(a) * 54;
            const x2 = 60 + Math.cos(a) * 58;
            const y2 = 60 + Math.sin(a) * 58;
            return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="currentColor" stroke-width="0.5"/>`;
          }).join('')}
          <!-- Inner circle -->
          <circle cx="60" cy="60" r="44" fill="none" stroke="currentColor" stroke-width="1"/>
          <!-- Star accents -->
          <text x="60" y="38" text-anchor="middle" font-size="8" fill="currentColor" font-family="serif">&#9733;</text>
          <!-- HARD text -->
          <text x="60" y="66" text-anchor="middle" font-size="18" font-weight="700" fill="currentColor" letter-spacing="0.2em" font-family="var(--mono)">HARD</text>
          <!-- Decorative laurel lines -->
          <path d="M 28 75 Q 44 85 60 78 Q 76 85 92 75" fill="none" stroke="currentColor" stroke-width="0.8"/>
          <path d="M 32 80 Q 46 88 60 82 Q 74 88 88 80" fill="none" stroke="currentColor" stroke-width="0.5"/>
        </svg>
      `;
    } else {
      this.els.scorecardBadge.className = 'badge-easy';
      this.els.scorecardBadge.textContent = 'EASY';
    }

    // Hero total
    const totalDelay = 0.2;
    const pinWord = this.totalPins === 1 ? 'PIN' : 'PINS';
    this.els.scorecardTotal.innerHTML = `
      <div class="total-number" style="animation-delay: ${totalDelay}s">${this.totalPins}</div>
      <div class="total-label" style="animation-delay: ${totalDelay + 0.1}s">${pinWord}</div>
    `;

    // Clue rows — truncated clue text, NO answers
    let html = '';
    for (let i = 0; i < this.clues.length; i++) {
      const pins = this.pinsPerClue[i];
      const tier = pins === 1 ? 'perfect' : pins <= 3 ? 'good' : 'rough';
      const delay = 0.5 + i * 0.1;
      const clueText = this._truncateClue(this.clues[i].clue);

      const squares = Array.from({ length: pins }, (_, j) => {
        const type = j < pins - 1 ? 'wrong' : 'correct';
        return `<span class="pin-square ${type}"></span>`;
      }).join('');

      html += `
        <div class="scorecard-row" style="animation-delay: ${delay}s">
          <span class="clue-label">${clueText}</span>
          <span class="pin-dots">${squares}</span>
          <span class="pin-count ${tier}">${pins}</span>
        </div>
      `;
    }
    this.els.scorecardBody.innerHTML = html;

    this.els.scorecard.classList.remove('hidden');
  }
}
