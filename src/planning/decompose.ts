export function capabilityTitle(requirement: string): string {
    const first = requirement.split(/[.!\n]/)[0]?.trim() ?? requirement.trim();
    const cleaned = first.replace(/^(we need to|please|add|implement|build)\s+/i, '').trim();
    if (cleaned.length === 0) return 'Requested capability';
    return cleaned.length > 80 ? `${cleaned.slice(0, 77)}…` : cleaned;
}

/** Smallest useful story themes from a free-text requirement. */
export function storyThemes(requirement: string): string[] {
    const lower = requirement.toLowerCase();
    const themes: string[] = [];
    if (/\blogin\b|\bsign[- ]?in\b/.test(lower)) themes.push('sign in');
    if (/\blogout\b|\bsign[- ]?out\b/.test(lower)) themes.push('sign out');
    if (/\bsession\b/.test(lower)) themes.push('validate the session');
    if (themes.length > 0) return themes.slice(0, 3);

    const bullets = requirement
        .split(/\n|;|•|(?:\d+[.)]\s+)/)
        .map(part => part.trim())
        .filter(part => part.length > 12 && part.length < 80);
    if (bullets.length >= 2) return bullets.slice(0, 3);

    return [capabilityTitle(requirement)];
}

export function wantsMultipleSprints(requirement: string, sprintCount?: number): number {
    if (sprintCount && sprintCount >= 1) return Math.min(sprintCount, 4);
    const match = requirement.match(/(\d+)\s+sprints?/i);
    if (match) return Math.min(Number(match[1]), 4);
    if (/next two sprints|over two sprints|two sprints/i.test(requirement)) return 2;
    return 1;
}

export function featureTitles(requirement: string, capability: string): string[] {
    const lower = requirement.toLowerCase();
    if (/\bauthori[sz]ation\b/.test(lower) && /\bauth(entication)?\b/.test(lower)) {
        return ['Authentication', 'Authorization'];
    }
    return [capability];
}
