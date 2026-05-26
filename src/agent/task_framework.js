/**
 * Fact-driven survival progress tracker.
 *
 * The objective planner decides the next executable command. This module keeps
 * a JSON progress ledger so the bot and prompt know which player-like
 * milestones are already done without letting stale static quests override
 * live inventory/world state.
 */

export const MAIN_QUESTS = {
    inspect_start: {
        id: 'inspect_start',
        name: 'Inspect Spawn',
        description: 'Know current health, hunger, inventory, and nearby resources.',
        priority: 1
    },
    tools_wooden: {
        id: 'tools_wooden',
        name: 'Wooden Tool Chain',
        description: 'Craft crafting table, wooden pickaxe, and a first axe.',
        priority: 2
    },
    tools_stone: {
        id: 'tools_stone',
        name: 'Stone Tool Chain',
        description: 'Upgrade to stone pickaxe and stone axe.',
        priority: 3
    },
    food_secure: {
        id: 'food_secure',
        name: 'Food Buffer',
        description: 'Keep edible food available and recover hunger when needed.',
        priority: 4,
        repeatable: true
    },
    base_setup: {
        id: 'base_setup',
        name: 'Base Camp',
        description: 'Remember a base and place storage, crafting table, furnace, and light.',
        priority: 5
    },
    starter_farm: {
        id: 'starter_farm',
        name: 'Starter Farm',
        description: 'Create a small renewable food source near base.',
        priority: 6
    },
    tools_iron: {
        id: 'tools_iron',
        name: 'Iron Progression',
        description: 'Craft iron pickaxe and start iron equipment.',
        priority: 7
    },
    armor_basic: {
        id: 'armor_basic',
        name: 'Wear Armor',
        description: 'Wear at least one armor piece and keep improving protection.',
        priority: 8
    },
    tools_diamond: {
        id: 'tools_diamond',
        name: 'Diamond Progression',
        description: 'Only after iron-age survival is stable, mine diamonds and craft diamond tools.',
        priority: 9
    },
    exploration: {
        id: 'exploration',
        name: 'Safe Exploration',
        description: 'Explore for villages, caves, and rare resources while maintaining food and safety.',
        priority: 10,
        repeatable: true
    }
};

function questComplete(questId, facts = {}) {
    switch (questId) {
        case 'inspect_start':
            return Number.isFinite(facts.health) && Number.isFinite(facts.hunger);
        case 'tools_wooden':
            return facts.hasCraftingTable && facts.highestPickaxeTier >= 0 && facts.highestAxeTier >= 0;
        case 'tools_stone':
            return facts.highestPickaxeTier >= 1 && facts.highestAxeTier >= 1;
        case 'food_secure':
            return Boolean(facts.foodSecure);
        case 'base_setup':
            return Boolean(facts.hasBase && facts.chestPlaced && facts.craftingTablePlaced && facts.furnacePlaced);
        case 'starter_farm':
            return Boolean(facts.hasFarm);
        case 'tools_iron':
            return facts.highestPickaxeTier >= 2;
        case 'armor_basic':
            return facts.equippedArmorCount > 0;
        case 'tools_diamond':
            return facts.highestPickaxeTier >= 3;
        case 'exploration':
            return facts.highestPickaxeTier >= 2 && facts.foodSecure && facts.hasBase;
        default:
            return false;
    }
}

function stateChanged(a, b) {
    return JSON.stringify(a) !== JSON.stringify(b);
}

export class TaskManager {
    constructor(memoryBank) {
        this.memoryBank = memoryBank;
        this.activeQuests = this.loadQuestState();
    }

    loadQuestState() {
        const stored = this.memoryBank?.questState;
        if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
            return stored;
        }
        return {};
    }

    saveQuestState() {
        this.memoryBank.questState = this.activeQuests;
        if (this.memoryBank?.questStateFile && this.memoryBank?.saveMemory) {
            this.memoryBank.saveMemory(this.memoryBank.questStateFile, this.activeQuests);
        }
    }

    syncProgress(facts = {}) {
        const previous = this.activeQuests;
        const next = {
            version: 2,
            updated_at: new Date().toISOString(),
            active_milestone: null,
            milestones: {}
        };

        for (const quest of Object.values(MAIN_QUESTS).sort((a, b) => a.priority - b.priority)) {
            const completed = questComplete(quest.id, facts);
            const old = previous?.milestones?.[quest.id] || previous?.[quest.id] || {};
            next.milestones[quest.id] = {
                id: quest.id,
                name: quest.name,
                description: quest.description,
                priority: quest.priority,
                completed,
                completed_at: completed ? (old.completed_at || new Date().toISOString()) : null,
                repeatable: Boolean(quest.repeatable)
            };

            if (!completed && !next.active_milestone) {
                next.active_milestone = quest.id;
            }
        }

        if (!next.active_milestone) {
            next.active_milestone = 'exploration';
        }

        if (stateChanged(previous, next)) {
            this.activeQuests = next;
            this.saveQuestState();
        }

        return this.activeQuests;
    }

    getProgressSummary(facts = null) {
        const state = facts ? this.syncProgress(facts) : this.activeQuests;
        const milestones = Object.values(state?.milestones || {})
            .sort((a, b) => a.priority - b.priority);
        if (milestones.length === 0) {
            return 'Survival progress: no milestones recorded yet.';
        }

        const lines = [
            `Active milestone: ${state.active_milestone || 'unknown'}`,
            'Milestones:'
        ];

        for (const milestone of milestones) {
            const marker = milestone.completed ? '[done]' : '[todo]';
            lines.push(`- ${marker} ${milestone.name}: ${milestone.description}`);
        }

        return lines.join('\n');
    }

    // The command planner is now fully fact-driven in objective_planner.js.
    // Returning null here prevents stale quest JSON from overriding live plans.
    getActiveQuestPlan(facts = {}) {
        this.syncProgress(facts);
        return null;
    }

    completeMicrotask(questId, microtaskId) {
        const state = this.activeQuests?.milestones ? this.activeQuests : {
            version: 2,
            updated_at: new Date().toISOString(),
            active_milestone: questId,
            milestones: {}
        };
        const milestone = state.milestones?.[questId] || {};
        milestone.microtasks = milestone.microtasks || {};
        milestone.microtasks[microtaskId] = { completed: true, timestamp: Date.now() };
        this.activeQuests = state;
        this.activeQuests.milestones[questId] = milestone;
        this.saveQuestState();
    }

    completeQuest(questId) {
        const state = this.activeQuests?.milestones ? this.activeQuests : {
            version: 2,
            updated_at: new Date().toISOString(),
            active_milestone: questId,
            milestones: {}
        };
        if (!state.milestones?.[questId]) {
            state.milestones[questId] = {
                id: questId,
                name: MAIN_QUESTS[questId]?.name || questId,
                description: MAIN_QUESTS[questId]?.description || '',
                priority: MAIN_QUESTS[questId]?.priority || 999
            };
        }
        state.milestones[questId].completed = true;
        state.milestones[questId].completed_at = new Date().toISOString();
        this.activeQuests = state;
        this.saveQuestState();
    }

    getQuestProgress(questId) {
        const milestones = this.activeQuests?.milestones || {};
        return milestones[questId]?.completed ? 1 : 0;
    }

    getActiveMicrotask() {
        return null;
    }
}

export function questToMicrotaskPlan() {
    return null;
}
