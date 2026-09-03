import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getSharedRules, getSkills, toIndexEntry } from '../../skills/registry.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('mcp-skill-resources');

export const SKILL_INDEX_URI = 'skill://sherlock/index';
export const SKILL_SHARED_RULES_URI = 'skill://sherlock/_shared/rules';

export function skillUri(name: string): string {
    return `skill://sherlock/${name}`;
}

/**
 * Publishes the skill catalogue as MCP resources.
 *
 * Tools let the model pull a skill on its own initiative; resources let the
 * Team Lead attach one deliberately in the client. Both read the same markdown
 * files, so there is one source of truth.
 */
export function registerSkillResources(server: McpServer): void {
    const skills = getSkills();

    server.registerResource(
        'sherlock-skill-index',
        SKILL_INDEX_URI,
        {
            title: 'Skill catalogue',
            description: 'Every Team Lead workflow this server ships with, the phrases that route to each, and the tools each uses.',
            mimeType: 'application/json'
        },
        async uri => ({
            contents: [
                {
                    uri: uri.href,
                    mimeType: 'application/json',
                    text: JSON.stringify(
                        {
                            count: skills.length,
                            skills: skills.map(toIndexEntry),
                            azureDevOpsAccess: 'read-only',
                            emailRule: 'V1 has no email send path. Azure DevOps work items are read-only; saved queries are the only controlled mutation.'
                        },
                        null,
                        2
                    )
                }
            ]
        })
    );

    server.registerResource(
        'sherlock-skill-shared-rules',
        SKILL_SHARED_RULES_URI,
        {
            title: 'Shared skill rules',
            description: 'Data, analysis, output and safety rules that apply to every skill.',
            mimeType: 'text/markdown'
        },
        async uri => ({
            contents: [
                {
                    uri: uri.href,
                    mimeType: 'text/markdown',
                    text: getSharedRules()
                        .map(document => `<!-- ${document.path} -->\n\n${document.content}`)
                        .join('\n\n---\n\n')
                }
            ]
        })
    );

    for (const skill of skills) {
        server.registerResource(
            `sherlock-skill-${skill.name}`,
            skillUri(skill.name),
            {
                title: `Skill: ${skill.title}`,
                description: skill.description,
                mimeType: 'text/markdown'
            },
            async uri => ({
                contents: [
                    {
                        uri: uri.href,
                        mimeType: 'text/markdown',
                        text: skill.body
                    }
                ]
            })
        );
    }

    log.debug('Registered skill resources', { skills: skills.length });
}
