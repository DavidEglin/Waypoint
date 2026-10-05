/** Candidate course content to match an assessment's keyword topics against. */
export interface MatchCandidate {
  kind: 'page' | 'file';
  canvasId: string;
  title: string;
  htmlUrl: string | null;
  moduleName: string | null;
  /** Module position for ordering; unmoduled content sorts last. */
  modulePosition: number;
  text: string;
}

export interface MatchResult {
  kind: 'page' | 'file';
  canvasId: string;
  title: string;
  htmlUrl: string | null;
  moduleName: string | null;
  modulePosition: number;
  /** How many distinct keyword topics this item matched. */
  score: number;
  matchedTerms: string[];
  snippet: string | null;
}

const MAX_RESULTS = 40;
const SNIPPET_RADIUS = 80;

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** First match of `term` in `text` as a whole word/phrase (case-insensitive), or -1. ASCII word boundaries: a reasonable approximation for English notifications. */
function findMatch(text: string, term: string): number {
  const t = term.trim();
  if (!t) return -1;
  const m = new RegExp(`\\b${escapeRegExp(t)}\\b`, 'i').exec(text);
  return m ? m.index : -1;
}

function snippetAround(text: string, index: number, termLen: number): string {
  const start = Math.max(0, index - SNIPPET_RADIUS);
  const end = Math.min(text.length, index + termLen + SNIPPET_RADIUS);
  const raw = text.slice(start, end).replace(/\s+/g, ' ').trim();
  return (start > 0 ? '… ' : '') + raw + (end < text.length ? ' …' : '');
}

/**
 * Keyword matching only (skill-kind topics need a different approach - matches the brief's keyword.ts
 * scope for this milestone, with skill.ts "later"). Scores by how many distinct topics a page/file covers.
 */
export function matchContent(topics: { text: string; kind: 'keyword' | 'skill' }[], candidates: MatchCandidate[]): MatchResult[] {
  const keywords = topics.filter((t) => t.kind === 'keyword').map((t) => t.text).filter(Boolean);
  if (keywords.length === 0) return [];

  const results: MatchResult[] = [];
  for (const c of candidates) {
    const matched: string[] = [];
    let snippet: string | null = null;
    for (const term of keywords) {
      const index = findMatch(c.text, term);
      if (index < 0) continue;
      matched.push(term);
      if (!snippet) snippet = snippetAround(c.text, index, term.length);
    }
    if (matched.length === 0) continue;
    results.push({ kind: c.kind, canvasId: c.canvasId, title: c.title, htmlUrl: c.htmlUrl, moduleName: c.moduleName, modulePosition: c.modulePosition, score: matched.length, matchedTerms: matched, snippet });
  }

  results.sort((a, b) => b.score - a.score || a.modulePosition - b.modulePosition || a.title.localeCompare(b.title));
  return results.slice(0, MAX_RESULTS);
}
