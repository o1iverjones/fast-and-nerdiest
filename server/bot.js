const { getArticleLinks } = require('./wikiService');

const HUB_WORDS = [
  'United States', 'England', 'France', 'Germany', 'History', 'Science',
  'World War', 'British', 'American', 'European', 'University', 'London',
  'New York', 'War', 'Religion', 'Philosophy', 'Mathematics', 'Physics',
  'Biology', 'Chemistry', 'Literature', 'Art', 'Music', 'Sport', 'China',
  'India', 'Russia', 'Italy', 'Roman', 'Greek', 'Ancient', 'Politics',
];

class Bot {
  constructor({ difficulty, targetArticle, onMove, onWin }) {
    this.difficulty = difficulty;
    this.targetArticle = targetArticle;
    this.onMove = onMove;   // (newArticle, clickCount) => void
    this.onWin = onWin;     // () => void
    this.currentArticle = null;
    this.path = [];
    this.active = false;
    this._timer = null;
  }

  start(startArticle) {
    this.currentArticle = startArticle;
    this.path = [startArticle];
    this.active = true;
    this._scheduleMove();
  }

  stop() {
    this.active = false;
    if (this._timer) clearTimeout(this._timer);
    this._timer = null;
  }

  _delay() {
    switch (this.difficulty) {
      case 'easy':   return 3000 + Math.random() * 5000;
      case 'medium': return 2000 + Math.random() * 2000;
      case 'hard':   return 500  + Math.random() * 1500;
      default:       return 3000;
    }
  }

  _scheduleMove() {
    if (!this.active) return;
    this._timer = setTimeout(() => this._move(), this._delay());
  }

  async _move() {
    if (!this.active) return;

    let links;
    try {
      links = await getArticleLinks(this.currentArticle);
    } catch {
      links = [];
    }

    if (!this.active) return;

    if (links.length === 0) {
      this._scheduleMove();
      return;
    }

    const next = this._pick(links);
    if (!next) { this._scheduleMove(); return; }

    this.currentArticle = next;
    this.path.push(next);
    const clickCount = this.path.length - 1;

    this.onMove(next, clickCount);

    if (next.toLowerCase() === this.targetArticle.toLowerCase()) {
      this.stop();
      this.onWin();
    } else {
      this._scheduleMove();
    }
  }

  _pick(links) {
    switch (this.difficulty) {
      case 'easy':   return this._pickRandom(links);
      case 'medium': return this._pickMedium(links);
      case 'hard':   return this._pickHard(links);
      default:       return this._pickRandom(links);
    }
  }

  _pickRandom(links) {
    return links[Math.floor(Math.random() * links.length)];
  }

  _pickMedium(links) {
    const hubs = links.filter(l => HUB_WORDS.some(w => l.includes(w)));
    if (hubs.length > 0 && Math.random() > 0.35) {
      return hubs[Math.floor(Math.random() * hubs.length)];
    }
    return this._pickRandom(links);
  }

  _pickHard(links) {
    if (links.includes(this.targetArticle)) return this.targetArticle;

    const targetWords = new Set(
      this.targetArticle.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter(w => w.length > 3)
    );

    if (targetWords.size > 0) {
      const scored = links.map(link => {
        const words = link.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/);
        const score = words.filter(w => targetWords.has(w)).length;
        return { link, score };
      });
      scored.sort((a, b) => b.score - a.score);
      if (scored[0].score > 0) return scored[0].link;
    }

    return this._pickMedium(links);
  }
}

module.exports = Bot;
