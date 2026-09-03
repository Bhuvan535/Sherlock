/**
 * Apply harness defaults before any module under test loads getConfig().
 * Production still requires a real .env; this is test-only.
 */
process.env.ADO_ORGANIZATION ??= 'KEBS4KAAR';
process.env.ADO_PROJECT ??= 'K4K';
process.env.ADO_TEAM ??= 'Platform';
process.env.ADO_PAT ??= 'test-pat-value-not-a-real-secret';
process.env.DATABASE_URL ??= ':memory:';
process.env.LOG_LEVEL ??= 'silent';
process.env.CACHE_TTL_SECONDS ??= '60';
