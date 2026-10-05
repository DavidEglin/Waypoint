import { describe, expect, it } from 'vitest';
import { matchContent, type MatchCandidate } from '../src/match.js';

const page = (over: Partial<MatchCandidate> = {}): MatchCandidate => ({
  kind: 'page',
  canvasId: 'p1',
  title: 'A page',
  htmlUrl: 'https://canvas.school.edu/courses/1/pages/p1',
  moduleName: null,
  modulePosition: 0,
  text: '',
  ...over,
});

describe('matchContent', () => {
  it('matches a whole-word keyword, case-insensitively, and ignores skill-kind topics', () => {
    const topics = [
      { text: 'atmospheric circulation', kind: 'keyword' as const },
      { text: 'communicates using a range of examples', kind: 'skill' as const },
    ];
    const candidates = [page({ canvasId: 'hit', text: 'Global winds are driven by ATMOSPHERIC CIRCULATION patterns.' })];
    const results = matchContent(topics, candidates);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ canvasId: 'hit', score: 1, matchedTerms: ['atmospheric circulation'] });
    expect(results[0]!.snippet).toContain('ATMOSPHERIC CIRCULATION');
  });

  it('does not match a substring inside another word', () => {
    const topics = [{ text: 'rain', kind: 'keyword' as const }];
    const candidates = [page({ text: 'The terrain here is mountainous.' })];
    expect(matchContent(topics, candidates)).toEqual([]);
  });

  it('scores by how many distinct topics are covered, and ranks higher scores first', () => {
    const topics = [
      { text: 'coffee', kind: 'keyword' as const },
      { text: 'chocolate', kind: 'keyword' as const },
      { text: 'supply chains', kind: 'keyword' as const },
    ];
    const candidates = [
      page({ canvasId: 'one-term', text: 'This page is about coffee production.' }),
      page({ canvasId: 'two-terms', text: 'Coffee and chocolate both rely on global supply chains.' }),
      page({ canvasId: 'no-terms', text: 'Nothing relevant on this page at all.' }),
    ];
    const results = matchContent(topics, candidates);
    expect(results.map((r) => r.canvasId)).toEqual(['two-terms', 'one-term']);
    expect(results[0]!.score).toBe(3);
  });

  it('returns nothing when there are no keyword topics (skills only, or none at all)', () => {
    expect(matchContent([{ text: 'presents clearly', kind: 'skill' }], [page({ text: 'presents clearly throughout' })])).toEqual([]);
    expect(matchContent([], [page({ text: 'anything' })])).toEqual([]);
  });

  it('breaks ties by module position, then title', () => {
    const topics = [{ text: 'x', kind: 'keyword' as const }];
    const candidates = [
      page({ canvasId: 'later', title: 'Z', text: 'x', modulePosition: 2 }),
      page({ canvasId: 'earlier', title: 'A', text: 'x', modulePosition: 1 }),
    ];
    expect(matchContent(topics, candidates).map((r) => r.canvasId)).toEqual(['earlier', 'later']);
  });
});
