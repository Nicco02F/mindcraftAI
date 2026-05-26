// Memory-aware prompting system.
// Handles retrieval, prompt injection, action scoring, and memory updates.

import { formatSystemPrompt } from './system_prompt.js';
import { getSurvivalMilestone } from './autonomy_guard.js';
import { formatObjectivePlan } from './objective_planner.js';

export class MemoryAwarePrompter {
    constructor(agent) {
        this.agent = agent;
        this.lastDiaryUpdate = Date.now();
        this.diaryUpdateInterval = 5 * 60 * 1000;
    }

    buildSystemPrompt(currentSituation = '') {
        this.agent.currentSituation = currentSituation;

        if (Date.now() - this.lastDiaryUpdate > this.diaryUpdateInterval) {
            this.agent.memory_bank.generateAutoDiary();
            this.lastDiaryUpdate = Date.now();
        }

        let prompt = formatSystemPrompt(this.agent);
        prompt += `\n\n==================================================\nCURRENT SURVIVAL MILESTONE\n==================================================\n${getSurvivalMilestone(this.agent)}\n`;
        const objectivePlan = this.agent.objective_planner?.formatPrompt?.() || formatObjectivePlan(this.agent);
        prompt += `\n\n==================================================\nACTIVE OBJECTIVE PLAN\n==================================================\n${objectivePlan}\n`;
        const progressSummary = this.agent.task_manager?.getProgressSummary?.();
        if (progressSummary) {
            prompt += `\n\n==================================================\nSURVIVAL PROGRESS LEDGER\n==================================================\n${progressSummary}\n`;
        }
        const worldSummary = this.agent.world_model?.formatPromptSummary?.();
        if (worldSummary) {
            prompt += `\n\n==================================================\nWORLD MODEL\n==================================================\n${worldSummary}\n`;
        }

        if (currentSituation) {
            const relevantMemories = this.agent.memory_bank.retrieveRelevantMemories(currentSituation);

            prompt += `\n\n==================================================\nSITUATION-SPECIFIC CONTEXT\n==================================================\n\n`;

            if (relevantMemories.skills && relevantMemories.skills.length > 0) {
                prompt += `Relevant skills for this situation:\n`;
                for (const skill of relevantMemories.skills) {
                    prompt += `- "${skill.name}" (${Math.round(skill.success_rate * 100)}% success rate): ${skill.steps.join(' -> ')}\n`;
                }
                prompt += `\n`;
            }

            if (relevantMemories.personality_state && Object.keys(relevantMemories.personality_state).length > 0) {
                prompt += `Current emotional state: ${JSON.stringify(relevantMemories.personality_state)}\n\n`;
            }
        }

        const rewardSummary = this.agent.reward_manager?.formatPromptSummary?.();
        if (rewardSummary) {
            prompt += `\n\n==================================================\nREWARD AND LEARNING SIGNALS\n==================================================\n${rewardSummary}\n`;
        }

        const curiositySummary = this.agent.curiosity_evaluator?.formatPromptSummary?.();
        if (curiositySummary) {
            prompt += `\n\n==================================================\nCURIOSITY AND EXPLORATION\n==================================================\n${curiositySummary}\n`;
        }

        const socialSummary = this.agent.social_handler?.formatPromptSummary?.();
        if (socialSummary) {
            prompt += `\n\n==================================================\nSOCIAL INTELLIGENCE\n==================================================\n${socialSummary}\n`;
        }

        const inventorySummary = this.agent.inventory_manager?.formatPromptSummary?.();
        if (inventorySummary) {
            prompt += `\n\n==================================================\nINVENTORY INTELLIGENCE\n==================================================\n${inventorySummary}\n`;
        }

        const reflectionSummary = this.agent.reflection_engine?.formatPromptSummary?.();
        if (reflectionSummary) {
            prompt += `\n\n==================================================\nSELF-REFLECTION\n==================================================\n${reflectionSummary}\n`;
        }

        return prompt;
    }

    handleActionResult(action, result, reward = null, metadata = {}) {
        result = String(result || 'Command completed with no output.');
        if (reward === null) {
            reward = this.scoreActionResult(metadata.commandName || action, result);
        }

        if (this.isRuntimeException(result)) {
            this.agent.memory_bank.addEvent(`Runtime exception in ${action}: ${this.runtimeExceptionSummary(result)}`, reward);
            this.learnFromAction(action, result, reward, metadata);
            return reward;
        }

        this.agent.memory_bank.addEvent(`${action}: ${result}`, reward);

        if (reward > 0) {
            this.agent.memory_bank.recordSuccess(`${action} (reward: +${reward})`);
        } else if (reward < 0 && !this.isRoutineFailure(result)) {
            this.agent.memory_bank.recordTrauma(`${action} failed (penalty: ${reward})`);
        }

        if (this.isFailureResult(result) || reward < 0) {
            this.agent.memory_bank.recordFailedAttempt(action);
        } else {
            this.agent.memory_bank.resetFailedAttempt(action);
        }

        this.learnFromAction(action, result, reward, metadata);
        return reward;
    }

    isRuntimeException(result) {
        const text = String(result || '').toLowerCase();
        return text.includes('!!code threw exception') || text.includes('stack trace:');
    }

    runtimeExceptionSummary(result) {
        const line = String(result || '')
            .split(/\r?\n/)
            .map(part => part.trim())
            .find(part => /^(error|typeerror|referenceerror|rangeerror|syntaxerror):/i.test(part));
        return line || 'command threw an implementation error';
    }

    isRoutineFailure(result) {
        const text = String(result || '').toLowerCase();
        return text.includes('collected 0') ||
            (text.includes('no ') && text.includes('nearby')) ||
            text.includes('could not find') ||
            text.includes('you do not have the resources') ||
            text.includes('requires:') ||
            text.includes('not enough') ||
            text.includes("don't have") ||
            text.includes('do not have');
    }

    getActionKey(commandText, commandName = '') {
        const commandMatch = String(commandText || '').match(/!(\w+)(?:\((.*)\))?/);
        const normalizedCommand = commandName || (commandMatch ? `!${commandMatch[1]}` : 'unknown');
        const args = commandMatch?.[2] || '';
        const firstStringArg = args.match(/"([^"]+)"/)?.[1] || args.match(/'([^']+)'/)?.[1] || null;
        const firstNumericArg = args.match(/-?\d+(?:\.\d+)?/)?.[0] || null;

        if (normalizedCommand === '!autoTradeWithVillager' && firstNumericArg) {
            return `${normalizedCommand}:${firstNumericArg}`;
        }

        if (firstStringArg && [
            '!collectBlocks',
            '!searchForBlock',
            '!craftRecipe',
            '!smeltItem',
            '!attack',
            '!searchForEntity',
            '!goToRememberedPlace',
            '!placeHere',
            '!useOn',
            '!newAction',
            '!autoTradeWithVillager'
        ].includes(normalizedCommand)) {
            return `${normalizedCommand}:${firstStringArg}`;
        }

        return normalizedCommand;
    }

    scoreActionResult(commandName, result) {
        const text = String(result || '').toLowerCase();
        commandName = String(commandName || '');

        if (this.isFailureResult(text)) {
            return -25;
        }

        if (commandName.includes('craft')) {
            return /(successfully crafted|crafted [1-9]|you now have)/i.test(result) ? 15 : 0;
        }

        if (commandName.includes('collect')) {
            return /(collected [1-9]|picked up [1-9])/i.test(result) ? 10 : 0;
        }

        if (commandName.includes('search')) {
            return /found .+ at \(/i.test(result) || /found .+ blocks away/i.test(result) || /you have reached|arrived|reached/i.test(result) ? 8 : 0;
        }

        if (commandName.includes('attack')) {
            return /successfully killed|picked up [1-9]/i.test(result) ? 10 : 0;
        }

        if (/(successfully|smelted|saved|slept|equipped|placed|you now have)/i.test(result)) {
            return 10;
        }

        if (/found .+ at \(/i.test(result) || /found .+ blocks away/i.test(result)) {
            return 10;
        }

        return 0;
    }

    isFailureResult(result) {
        const text = String(result || '').toLowerCase();
        if (/crafted [1-9]/.test(text) || /collected [1-9]/.test(text) || text.includes('you now have')) {
            return false;
        }

        return text.includes('!!code threw exception') ||
            text.includes('error:') ||
            text.includes('failed') ||
            text.includes('interrupted') ||
            text.includes('blocked') ||
            text.includes('could not') ||
            text.includes('cannot ') ||
            (text.includes('no ') && text.includes('nearby')) ||
            text.includes('produced no action output') ||
            text.includes('collected 0') ||
            text.includes('picked up 0') ||
            text.includes('did not pick up') ||
            text.includes('requires:') ||
            text.includes('not enough') ||
            text.includes('do not have') ||
            text.includes("don't have") ||
            text.includes('unable');
    }

    learnFromAction(action, result, reward, metadata = {}) {
        if (reward <= 0) return;

        const commandName = metadata.commandName || action.split(':')[0];
        const rawCommand = metadata.rawCommand || action;
        const skillName = action.replace(/^!/, '').replace(/[^a-zA-Z0-9_:-]/g, '_');

        if (this.shouldRecordAsSkill(commandName, action, result)) {
            this.recordSkillSuccess(skillName, [rawCommand], true);
        }

        const foundBlock = String(result).match(/Found ([a-zA-Z0-9_]+) at \((-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)\)/);
        if (foundBlock) {
            const [, block, x, y, z] = foundBlock;
            this.agent.memory_bank.recordResource(block, [Number(x), Number(y), Number(z)], 1);
        }

        const placedUsefulBlock = String(result).match(/Placed (furnace|crafting_table|chest|bed) at \((-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)\)/);
        if (placedUsefulBlock) {
            const [, block, x, y, z] = placedUsefulBlock;
            this.agent.memory_bank.rememberPlace(`last_${block}`, Number(x), Number(y), Number(z), `Useful placed ${block}`);
        }
    }

    shouldRecordAsSkill(commandName, action, result) {
        if (commandName === '!newAction' || commandName === '!smeltItem') return true;

        if (commandName === '!craftRecipe') {
            return /pickaxe|axe|sword|shovel|furnace|chest|bed|shield|bucket|armor|helmet|chestplate|leggings|boots/i.test(action);
        }

        if (commandName === '!collectBlocks') {
            return /iron_ore|deepslate_iron_ore|diamond_ore|ancient_debris/i.test(action) &&
                /Collected [3-9]/i.test(result);
        }

        return false;
    }

    handleDeath(deathLocation, deathMessage) {
        this.agent.memory_bank.recordTrauma(`Death at ${deathLocation}: ${deathMessage}`);

        if (deathMessage.includes('fell')) {
            this.agent.memory_bank.personality.learned_fears.high_fall = Math.min(
                1,
                this.agent.memory_bank.personality.learned_fears.high_fall + 0.3
            );
        } else if (deathMessage.includes('lava')) {
            this.agent.memory_bank.personality.learned_fears.lava = Math.min(
                1,
                this.agent.memory_bank.personality.learned_fears.lava + 0.3
            );
        } else if (deathMessage.includes('killed') || deathMessage.includes('attacked')) {
            this.agent.memory_bank.personality.learned_fears.cave_combat = Math.min(
                1,
                this.agent.memory_bank.personality.learned_fears.cave_combat + 0.3
            );
        }

        this.agent.memory_bank.updatePersonality({
            learned_fears: this.agent.memory_bank.personality.learned_fears
        });
    }

    recordSkillSuccess(skillName, steps, wasSuccessful = true) {
        this.agent.memory_bank.recordSkill(skillName, steps, wasSuccessful ? 0.9 : 0.5);
        this.agent.memory_bank.updateSkillSuccess(skillName, wasSuccessful);
        const personality = this.agent.memory_bank.personality;
        if (!personality.skill_confidence || typeof personality.skill_confidence !== 'object') {
            personality.skill_confidence = {};
        }

        if (wasSuccessful) {
            personality.skill_confidence[skillName] =
                Math.min(1, (personality.skill_confidence[skillName] || 0.5) + 0.1);
        } else {
            personality.skill_confidence[skillName] =
                Math.max(0, (personality.skill_confidence[skillName] || 0.5) - 0.2);
        }

        this.agent.memory_bank.updatePersonality({
            skill_confidence: personality.skill_confidence
        });
    }

    shouldAbortAction(action) {
        return this.agent.memory_bank.shouldAbortAction(action);
    }

    getActionRecommendation(situation) {
        const memories = this.agent.memory_bank.retrieveRelevantMemories(situation);
        let recommendation = `Based on your memories:\n`;

        if (memories.short_term && memories.short_term.length > 0) {
            recommendation += `\nRecent events:\n`;
            memories.short_term.slice(0, 3).forEach(event => {
                recommendation += `- ${event}\n`;
            });
        }

        if (memories.long_term && memories.long_term.length > 0) {
            recommendation += `\nRelevant knowledge:\n`;
            memories.long_term.forEach(knowledge => {
                recommendation += `- ${knowledge}\n`;
            });
        }

        if (memories.skills && memories.skills.length > 0) {
            recommendation += `\nUseful skills:\n`;
            memories.skills.forEach(skill => {
                recommendation += `- "${skill.name}" (${Math.round(skill.success_rate * 100)}% reliable)\n`;
            });
        }

        if (memories.personality_state) {
            recommendation += `\nYour current state:\n`;
            recommendation += `- Mood: ${memories.personality_state.mood || 'neutral'}\n`;
            if (memories.personality_state.fear_level) {
                recommendation += `- Fear level: ${memories.personality_state.fear_level}/1.0\n`;
            }
            if (memories.personality_state.recent_trauma) {
                recommendation += `- Still affected by: ${memories.personality_state.recent_trauma}\n`;
            }
        }

        return recommendation;
    }

    exportMemoryState() {
        return {
            timestamp: new Date().toISOString(),
            agentName: this.agent.name,
            memories: this.agent.memory_bank.getAllMemories()
        };
    }

    getMemoryStats() {
        const memories = this.agent.memory_bank;
        return {
            total_events: memories.shortTermMemory.length,
            discovered_places: Object.keys(memories.longTermMemory.discovered_places || {}).length,
            known_dangers: (memories.longTermMemory.danger_zones || []).length,
            known_resources: (memories.longTermMemory.resource_locations || []).length,
            unfinished_goals: (memories.longTermMemory.unfinished_goals || []).length,
            skills_learned: memories.skills.length,
            diary_entries: memories.diary.length,
            repeated_failures: Object.keys(memories.failedAttempts || {}).length,
            personality_mood: memories.personality.mood,
            fear_level: memories.personality.fear_level,
            exploration_drive: memories.personality.exploration_drive
        };
    }
}
