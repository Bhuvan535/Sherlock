import { tokenOverlap } from './helpers.js';
import type { ExistingMatch, ExistingWorkHint } from './types.js';

export function findExistingMatches(requirement: string, existingWork: ExistingWorkHint[]): ExistingMatch[] {
    const scored = existingWork
        .map(item => ({
            id: item.id,
            title: item.title,
            type: item.type,
            score: tokenOverlap(requirement, item.title)
        }))
        .filter(item => item.score >= 0.45)
        .sort((a, b) => b.score - a.score);
    return scored.slice(0, 5);
}

export function strongestMatch(matches: ExistingMatch[], type: string, minScore: number): ExistingMatch | undefined {
    return matches.find(item => item.type === type && item.score >= minScore);
}
