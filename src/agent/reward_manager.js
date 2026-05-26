import fs from 'fs';
import path from 'path';

const HISTORY_LIMIT = 300;
const RECENT_LIMIT = 30;

const RARE_ITEMS = new Map([
    ['diamond', 80],
    ['diamond_ore', 80],
    ['deepslate_diamond_ore', 90],
    ['emerald', 55],
    ['ancient_debris', 120],
    ['netherite_scrap', 140],
    ['iron_ingot', 35],
    ['raw_iron', 30],
    ['iron_ore', 30],
    ['deepslate_iron_ore', 35],
    ['gold_ingot', 25],
    ['raw_gold', 25],
    ['lapis_lazuli', 20],
    ['redstone', 18],
    ['coal', 12]
]);

const HELPFUL_COMMANDS = new Set(['!givePlayer', '!goToPlayer', '!followPlayer', '!lookAtPlayer']);
const SOCIAL_REWARD_TYPES = new Set(['social_reply', 'social_help_offer', 'social_player_helped']);
const SURVIVAL_BLOCKS = new Set(['crafting_table', 'furnace', 'chest', 'barrel', 'torch', 'bed']);

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function safeReadObject(filePath, fallback) {
    try {
        if (!fs.existsSync(filePath)) return fallback;
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
    } catch (err) {
        console.error(`Error reading reward state from ${filePath}:`, err);
        return fallback;
    }
}

function normalizeActionKey(commandName, metadata = {}) {
    return metadata.actionKey || metadata.rawCommand || commandName || 'unknown';
}

function includesAny(text, needles) {
    return needles.some(needle => text.includes(needle));
}

function classifyMood(recentScore, totalScore) {
    if (recentScore >= 120) return 'energized';
    if (recentScore >= 45) return 'confident';
    if (recentScore <= -140) return 'shaken';
    if (recentScore <= -55) return 'frustrated';
    if (totalScore >= 300) return 'purposeful';
    return 'focused';
}

export class RewardManager {
    constructor(agent) {
        this.agent = agent;
        this.file = path.join(agent.memory_bank.memoryDir, 'reward_state.json');
        this.state = this.normalizeState(safeReadObject(this.file, this.defaultState()));
        this.lastHealth = null;
        this.lastFood = null;
        this.lastSurvivalTick = 0;
        this.save();
    }

    defaultState() {
        return {
            version: 1,
            total_score: 0,
            recent_score: 0,
            history: [],
            action_values: {},
            policy_bias: {
                exploration: 0.5,
                social: 0.5,
                risk_tolerance: 0.35,
                resource_efficiency: 0.5
            },
            last_updated: null
        };
    }

    normalizeState(state) {
        const defaults = this.defaultState();
        return {
            ...defaults,
            ...state,
            total_score: Number.isFinite(state.total_score) ? state.total_score : 0,
            recent_score: Number.isFinite(state.recent_score) ? state.recent_score : 0,
            history: Array.isArray(state.history) ? state.history.slice(-HISTORY_LIMIT) : [],
            action_values: state.action_values && typeof state.action_values === 'object' && !Array.isArray(state.action_values)
                ? state.action_values
                : {},
            policy_bias: {
                ...defaults.policy_bias,
                ...(state.policy_bias && typeof state.policy_bias === 'object' && !Array.isArray(state.policy_bias) ? state.policy_bias : {})
            }
        };
    }

    save() {
        try {
            fs.writeFileSync(this.file, JSON.stringify(this.state, null, 2));
        } catch (err) {
            console.error(`Error saving reward state ${this.file}:`, err);
        }
    }

    record(type, description, reward, metadata = {}) {
        reward = Number.isFinite(reward) ? Math.round(reward) : 0;
        const record = {
            timestamp: new Date().toISOString(),
            type,
            description: String(description || type).slice(0, 500),
            reward,
            metadata: this.compactMetadata(metadata)
        };

        this.state.history.push(record);
        if (this.state.history.length > HISTORY_LIMIT) {
            this.state.history.splice(0, this.state.history.length - HISTORY_LIMIT);
        }

        this.state.total_score += reward;
        this.state.recent_score = this.state.history
            .slice(-RECENT_LIMIT)
            .reduce((sum, item) => sum + (item.reward || 0), 0);

        this.updateActionValue(record, metadata);
        this.updatePolicyBias(type, reward, metadata);
        this.updatePersonalityFromReward(type, reward);
        this.state.last_updated = record.timestamp;
        this.save();

        this.agent.autonomy_logger?.log?.({
            type: 'reward_event',
            source: 'reward_manager',
            reward_type: type,
            reward,
            description: record.description,
            total_score: this.state.total_score,
            recent_score: this.state.recent_score
        });

        return record;
    }

    compactMetadata(metadata = {}) {
        const compact = {};
        for (const [key, value] of Object.entries(metadata || {})) {
            if (value === undefined || typeof value === 'function') continue;
            if (typeof value === 'string') compact[key] = value.slice(0, 300);
            else if (typeof value === 'number' || typeof value === 'boolean' || value === null) compact[key] = value;
            else compact[key] = JSON.parse(JSON.stringify(value, (_k, v) =>
                typeof v === 'string' && v.length > 300 ? `${v.slice(0, 300)}...` : v
            ));
        }
        return compact;
    }

    updateActionValue(record, metadata = {}) {
        const actionKey = normalizeActionKey(metadata.commandName || record.type, metadata);
        const current = this.state.action_values[actionKey] || {
            count: 0,
            average_reward: 0,
            last_reward: 0,
            last_seen: null
        };

        current.count += 1;
        current.average_reward = current.average_reward * 0.8 + record.reward * 0.2;
        current.last_reward = record.reward;
        current.last_seen = record.timestamp;
        this.state.action_values[actionKey] = current;
    }

    updatePolicyBias(type, reward, metadata = {}) {
        const bias = this.state.policy_bias;
        const delta = clamp(reward / 250, -0.12, 0.12);

        if (type.includes('exploration') || metadata.commandName === '!moveAway' || metadata.commandName === '!searchForBlock') {
            bias.exploration = clamp(bias.exploration + delta, 0.1, 0.95);
        }

        if (SOCIAL_REWARD_TYPES.has(type) || HELPFUL_COMMANDS.has(metadata.commandName)) {
            bias.social = clamp(bias.social + delta, 0.1, 0.95);
        }

        if (type.includes('damage') || type.includes('death') || type.includes('danger')) {
            bias.risk_tolerance = clamp(bias.risk_tolerance - Math.abs(delta), 0.05, 0.9);
        } else if (reward > 20 && includesAny(type, ['survival', 'combat', 'escape'])) {
            bias.risk_tolerance = clamp(bias.risk_tolerance + 0.02, 0.05, 0.9);
        }

        if (type.includes('waste') || type.includes('discard') || reward < -20) {
            bias.resource_efficiency = clamp(bias.resource_efficiency + 0.05, 0.1, 0.95);
        } else if (type.includes('craft') || type.includes('storage') || type.includes('inventory')) {
            bias.resource_efficiency = clamp(bias.resource_efficiency + Math.max(0, delta), 0.1, 0.95);
        }
    }

    updatePersonalityFromReward(type, reward) {
        const personality = this.agent.memory_bank.personality || {};
        const recentScore = this.state.recent_score;
        const changes = {
            mood: classifyMood(recentScore, this.state.total_score),
            reward_score: this.state.total_score,
            recent_reward_score: recentScore,
            policy_bias: this.state.policy_bias
        };

        if (reward <= -60 || type.includes('death')) {
            changes.fear_level = clamp((personality.fear_level ?? 0.5) + 0.08, 0, 1);
        } else if (reward >= 25) {
            changes.fear_level = clamp((personality.fear_level ?? 0.5) - 0.025, 0, 1);
        }

        if (type.includes('exploration') && reward > 0) {
            changes.exploration_drive = clamp((personality.exploration_drive ?? 0.5) + 0.04, 0, 1);
        } else if ((type.includes('danger') || type.includes('death')) && reward < 0) {
            changes.exploration_drive = clamp((personality.exploration_drive ?? 0.5) - 0.03, 0, 1);
        }

        this.agent.memory_bank.updatePersonality(changes);
    }

    scoreCommandResult(commandName, result, baseReward = 0, metadata = {}) {
        const text = String(result || '').toLowerCase();
        let reward = Number.isFinite(baseReward) ? baseReward : 0;

        if (includesAny(text, ['successfully crafted', 'crafted ', 'you now have'])) {
            reward += 8;
        }
        if (includesAny(text, ['collected ', 'picked up ']) && !includesAny(text, ['collected 0', 'picked up 0'])) {
            reward += 8;
        }
        if (includesAny(text, ['successfully put', 'successfully took', 'the chest contains'])) {
            reward += 10;
        }
        if (includesAny(text, ['successfully auto-traded', 'successfully traded'])) {
            reward += 30;
        }
        if (HELPFUL_COMMANDS.has(commandName)) {
            reward += 12;
        }
        if (commandName === '!givePlayer' && !includesAny(text, ['could not', 'do not have', 'failed'])) {
            reward += 35;
        }
        if (commandName === '!placeHere') {
            for (const block of SURVIVAL_BLOCKS) {
                if (text.includes(block)) reward += 12;
            }
        }
        if (commandName === '!rememberHere') {
            reward += 12;
        }

        for (const [item, value] of RARE_ITEMS.entries()) {
            if (text.includes(item)) {
                reward += Math.min(value, 35);
            }
        }

        if (includesAny(text, ['death', 'you died'])) reward -= 160;
        if (includesAny(text, ['failed', 'could not', 'cannot ', 'not enough', 'do not have', "don't have", 'unable'])) reward -= 15;
        if (includesAny(text, ['interrupted', 'timed out', 'blocked'])) reward -= 10;
        if (includesAny(text, ['discarded']) && !metadata.inventoryPressure) reward -= 15;
        if (metadata.damageTaken) reward -= Math.round(metadata.damageTaken * 10);

        return clamp(Math.round(reward), -250, 180);
    }

    recordCommandResult(commandText, commandName, result, baseReward = 0, metadata = {}) {
        const reward = this.scoreCommandResult(commandName, result, baseReward, metadata);
        const type = reward >= 0 ? 'command_reward' : 'command_penalty';
        return this.record(type, `${commandName}: ${String(result || '').slice(0, 220)}`, reward, {
            ...metadata,
            rawCommand: commandText,
            commandName,
            actionKey: metadata.actionKey || commandText
        });
    }

    recordDeath(location, message) {
        return this.record('death_penalty', `Death at ${location}: ${message}`, -180, { location, message });
    }

    updateSurvivalSignals() {
        const bot = this.agent?.bot;
        if (!bot) return;
        const health = Math.round(bot.health ?? 20);
        const food = Math.round(bot.food ?? 20);
        const now = Date.now();

        if (this.lastHealth !== null && health < this.lastHealth) {
            const damage = this.lastHealth - health;
            this.record('damage_penalty', `Took ${damage} avoidable damage.`, -Math.max(8, damage * 8), { damageTaken: damage });
        }

        if (this.lastFood !== null && food <= 6 && food < this.lastFood) {
            this.record('hunger_warning', `Hunger dropped to ${food}/20.`, -10, { hunger: food });
        }

        if (now - this.lastSurvivalTick > 5 * 60 * 1000 && health >= 16 && food >= 12) {
            this.record('survival_stability', 'Stayed alive and stable for another survival interval.', 8, { health, food });
            this.lastSurvivalTick = now;
        }

        this.lastHealth = health;
        this.lastFood = food;
    }

    getActionValue(actionKey) {
        return this.state.action_values[actionKey]?.average_reward || 0;
    }

    getRecentHistory(count = 8) {
        return this.state.history.slice(-count);
    }

    formatPromptSummary() {
        const bias = this.state.policy_bias;
        const recent = this.getRecentHistory(5)
            .map(event => `${event.type}:${event.reward} ${event.description}`)
            .join(' | ') || 'none';

        return [
            `Reward score: total=${this.state.total_score}, recent=${this.state.recent_score}`,
            `Policy bias: exploration=${bias.exploration.toFixed(2)}, social=${bias.social.toFixed(2)}, risk_tolerance=${bias.risk_tolerance.toFixed(2)}, resource_efficiency=${bias.resource_efficiency.toFixed(2)}`,
            `Recent reward events: ${recent}`,
            'Use reward as a learning signal: prefer actions with positive past value, avoid repeated penalties, and accept risk only when expected survival value is high.'
        ].join('\n');
    }
}
