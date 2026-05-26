import fs from 'fs';
import path from 'path';
import * as world from './library/world.js';
import convoManager from './conversation.js';

const SOCIAL_STATE_VERSION = 1;
const PROXIMITY_RADIUS = 6;
const PROACTIVE_COOLDOWN = 4 * 60 * 1000;
const GLOBAL_PROACTIVE_COOLDOWN = 75 * 1000;
const INTERACTION_LIMIT = 12;

function safeReadObject(filePath, fallback) {
    try {
        if (!fs.existsSync(filePath)) return fallback;
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
    } catch (err) {
        console.error(`Error reading social state from ${filePath}:`, err);
        return fallback;
    }
}

function safeWriteObject(filePath, value) {
    try {
        fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
    } catch (err) {
        console.error(`Error saving social state ${filePath}:`, err);
    }
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function compact(text, length = 220) {
    text = String(text || '').replace(/\s+/g, ' ').trim();
    return text.length > length ? `${text.slice(0, length).trim()}...` : text;
}

function classifyIntent(message) {
    const text = String(message || '').toLowerCase();
    if (/(ciao|salve|hey|hello|hi|buongiorno|buonasera)\b/.test(text)) return 'greeting';
    if (/(help|aiut|soccor|serve|bisogno|puoi|can you|could you|mi fai|craft|costruisc|trova|portami|follow|seguimi)/.test(text)) return 'help_request';
    if (/(trade|scambi|baratt|vend|compra|ti do|dammi|give me|offro)/.test(text)) return 'trade';
    if (/(dove|where|coordinate|base|casa|sei|stai facendo|che fai|status|progress)/.test(text)) return 'status_question';
    if (/(pericolo|danger|mob|zombie|creeper|skeleton|aiuto!|run|scappa)/.test(text)) return 'danger_alert';
    if (/(grazie|thanks|bravo|nice|ottimo|good job)/.test(text)) return 'praise';
    if (/(no|stop|fermo|basta|sbagli|bad|wrong|non farlo)/.test(text)) return 'correction';
    return 'conversation';
}

function sentimentFromIntent(intent) {
    if (intent === 'praise') return 0.2;
    if (intent === 'correction') return -0.1;
    if (intent === 'danger_alert') return -0.15;
    return 0;
}

function getHumanPlayers(agent, radius = 64) {
    const bot = agent?.bot;
    if (!bot?.entity?.position) return [];
    const botNames = new Set(convoManager.getInGameAgents?.() || []);
    return Object.values(bot.players || {})
        .map(player => player?.entity)
        .filter(entity =>
            entity?.username &&
            entity.username !== agent.name &&
            !botNames.has(entity.username) &&
            entity.position &&
            entity.position.distanceTo(bot.entity.position) <= radius
        )
        .map(entity => ({
            username: entity.username,
            distance: entity.position.distanceTo(bot.entity.position),
            position: {
                x: Number(entity.position.x.toFixed(1)),
                y: Number(entity.position.y.toFixed(1)),
                z: Number(entity.position.z.toFixed(1))
            }
        }))
        .sort((a, b) => a.distance - b.distance);
}

export class SocialInteractionHandler {
    constructor(agent) {
        this.agent = agent;
        this.file = path.join(agent.memory_bank.memoryDir, 'social_state.json');
        this.state = this.normalizeState(safeReadObject(this.file, this.defaultState()));
        this.lastGlobalProactiveAt = 0;
        this.lastUpdateAt = 0;
        this.save();
    }

    defaultState() {
        return {
            version: SOCIAL_STATE_VERSION,
            players: {},
            recent_interactions: [],
            last_proactive_at: {},
            updated_at: null
        };
    }

    normalizeState(state) {
        const defaults = this.defaultState();
        return {
            ...defaults,
            ...state,
            players: state.players && typeof state.players === 'object' && !Array.isArray(state.players) ? state.players : {},
            recent_interactions: Array.isArray(state.recent_interactions) ? state.recent_interactions.slice(-50) : [],
            last_proactive_at: state.last_proactive_at && typeof state.last_proactive_at === 'object' && !Array.isArray(state.last_proactive_at) ? state.last_proactive_at : {}
        };
    }

    save() {
        this.state.updated_at = new Date().toISOString();
        safeWriteObject(this.file, this.state);
        this.syncLongTermMemory();
    }

    syncLongTermMemory() {
        const ltm = this.agent.memory_bank.longTermMemory;
        ltm.social_relationships = ltm.social_relationships || {};
        for (const [name, profile] of Object.entries(this.state.players)) {
            ltm.social_relationships[name] = {
                name,
                trust: profile.trust,
                helpfulness: profile.helpfulness,
                last_seen: profile.last_seen,
                last_intent: profile.last_intent,
                known_preferences: profile.known_preferences || [],
                recent_summary: this.summarizePlayer(name)
            };
        }
        this.agent.memory_bank.saveMemory(this.agent.memory_bank.longTermFile, ltm);
    }

    getPlayerProfile(username) {
        if (!this.state.players[username]) {
            this.state.players[username] = {
                name: username,
                first_seen: new Date().toISOString(),
                last_seen: null,
                trust: 0.5,
                helpfulness: 0.5,
                sentiment: 0,
                last_intent: null,
                interactions: [],
                known_preferences: []
            };
        }
        return this.state.players[username];
    }

    recordIncoming(username, message) {
        const intent = classifyIntent(message);
        const profile = this.getPlayerProfile(username);
        const now = new Date().toISOString();
        profile.last_seen = now;
        profile.last_intent = intent;
        profile.sentiment = clamp((profile.sentiment || 0) * 0.85 + sentimentFromIntent(intent), -1, 1);
        if (intent === 'praise') profile.trust = clamp((profile.trust || 0.5) + 0.05, 0, 1);
        if (intent === 'help_request' || intent === 'danger_alert') profile.helpfulness = clamp((profile.helpfulness || 0.5) + 0.03, 0, 1);

        const interaction = {
            timestamp: now,
            player: username,
            direction: 'incoming',
            intent,
            message: compact(message)
        };
        profile.interactions.unshift(interaction);
        profile.interactions = profile.interactions.slice(0, INTERACTION_LIMIT);
        this.state.recent_interactions.unshift(interaction);
        this.state.recent_interactions = this.state.recent_interactions.slice(0, 50);

        this.agent.memory_bank.addEvent(`Social incoming from ${username}: ${intent} - ${compact(message, 160)}`, intent === 'praise' ? 5 : 0);
        this.agent.reward_manager?.record?.('social_attention', `Listened to ${username}: ${intent}`, intent === 'help_request' ? 10 : 4, { player: username, intent });
        this.save();
        return { intent, profile };
    }

    recordOutgoing(username, message, metadata = {}) {
        if (!username || username === 'system' || username === this.agent.name || convoManager.isOtherAgent(username)) return;
        const profile = this.getPlayerProfile(username);
        const now = new Date().toISOString();
        const interaction = {
            timestamp: now,
            player: username,
            direction: 'outgoing',
            intent: metadata.intent || 'reply',
            message: compact(message)
        };
        profile.last_seen = now;
        profile.interactions.unshift(interaction);
        profile.interactions = profile.interactions.slice(0, INTERACTION_LIMIT);
        this.state.recent_interactions.unshift(interaction);
        this.state.recent_interactions = this.state.recent_interactions.slice(0, 50);
        this.agent.reward_manager?.record?.('social_reply', `Replied to ${username}: ${compact(message, 160)}`, 8, { player: username });
        this.save();
    }

    summarizePlayer(username) {
        const profile = this.state.players[username];
        if (!profile) return 'unknown player';
        const recent = (profile.interactions || [])
            .slice(0, 4)
            .map(item => `${item.direction}:${item.intent}:${item.message}`)
            .join(' | ') || 'no recent interactions';
        return `trust=${(profile.trust ?? 0.5).toFixed(2)}, helpfulness=${(profile.helpfulness ?? 0.5).toFixed(2)}, last_intent=${profile.last_intent || 'none'}, recent=${recent}`;
    }

    buildContextForMessage(username, message) {
        const profile = this.getPlayerProfile(username);
        const intent = profile.last_intent || classifyIntent(message);
        const diary = this.agent.memory_bank.diary || [];
        const latestDiary = diary.length > 0 ? diary[diary.length - 1].entry : 'no diary entries yet';
        const plan = this.agent.objective_planner?.state?.snapshot;
        const inventoryOffer = this.getHelpOffer();

        return [
            `Human player ${username} is talking to you.`,
            `Detected intent: ${intent}.`,
            `Relationship memory: ${this.summarizePlayer(username)}`,
            `Latest diary memory: ${compact(latestDiary, 260)}`,
            `Current personal objective: ${plan?.objective || 'unknown'}; active microtask: ${plan?.active_microtask || 'none'}.`,
            `Possible helpful offer: ${inventoryOffer}`,
            'Social rule: answer naturally and contextually first. If the player asks for an action, either confirm the plan or use exactly one command after a short sentence. Do not ignore direct human needs unless survival danger is immediate.'
        ].join('\n');
    }

    getHelpOffer() {
        const inventory = world.getInventoryCounts(this.agent.bot);
        if ((inventory.stone_sword || inventory.wooden_sword || inventory.iron_sword || 0) > 0) {
            return 'offer escort or defense if the player is in danger';
        }
        if ((inventory.iron_ingot || 0) >= 2 || (inventory.cobblestone || 0) >= 3) {
            return 'offer to craft or share basic tools if the player agrees';
        }
        if ((inventory.emerald || 0) > 0 || (inventory.wheat || 0) >= 8 || (inventory.stick || 0) >= 16) {
            return 'propose a small fair trade if the player wants one';
        }
        if ((inventory.cooked_beef || inventory.bread || inventory.apple || inventory.carrot || 0) > 1) {
            return 'offer food support';
        }
        if ((inventory.oak_log || inventory.spruce_log || inventory.birch_log || inventory.acacia_log || inventory.jungle_log || inventory.mangrove_log || 0) > 3) {
            return 'offer wood, planks, or a small crafting assist';
        }
        return 'ask what the player needs, or briefly report your current survival task';
    }

    getNearbyHumans(radius = PROXIMITY_RADIUS) {
        return getHumanPlayers(this.agent, radius);
    }

    async update(delta) {
        this.lastUpdateAt += delta;
        if (this.lastUpdateAt < 1000) return;
        this.lastUpdateAt = 0;
        if (!this.agent?.bot?.entity || this.agent.shut_up) return;
        if (!this.agent.isIdle()) return;
        if (convoManager.inConversation?.()) return;

        const nearby = this.getNearbyHumans(PROXIMITY_RADIUS);
        if (nearby.length === 0) return;

        const now = Date.now();
        if (now - this.lastGlobalProactiveAt < GLOBAL_PROACTIVE_COOLDOWN) return;

        const target = nearby[0];
        const lastForPlayer = this.state.last_proactive_at[target.username] || 0;
        if (now - lastForPlayer < PROACTIVE_COOLDOWN) return;

        const message = this.composeProactiveMessage(target.username);
        if (!message) return;

        this.state.last_proactive_at[target.username] = now;
        this.lastGlobalProactiveAt = now;
        this.recordOutgoing(target.username, message, { intent: 'proactive' });
        this.agent.memory_bank.addEvent(`Proactively greeted/helped nearby player ${target.username}.`, 5);
        this.agent.reward_manager?.record?.('social_help_offer', `Proactively offered help to ${target.username}`, 12, { player: target.username });
        await this.agent.routeResponse(target.username, message);
    }

    composeProactiveMessage(username) {
        const profile = this.getPlayerProfile(username);
        const plan = this.agent.objective_planner?.state?.snapshot;
        const reward = this.agent.reward_manager?.state?.recent_score ?? 0;
        const mood = this.agent.memory_bank.personality?.mood || 'focused';
        const offer = this.getHelpOffer();

        if (profile.last_intent === 'danger_alert') {
            return `${username}, resto vicino: se vuoi ti copro mentre ci spostiamo in un punto piu sicuro.`;
        }

        if (reward < -50) {
            return `${username}, sono un po' sotto pressione dopo gli ultimi tentativi. Sto facendo ${plan?.objective || 'sopravvivenza'}; se vuoi posso comunque aiutarti.`;
        }

        const objective = plan?.objective ? `Sto lavorando su ${plan.objective.toLowerCase()}` : 'Sto leggendo la situazione';
        return `${username}, ${objective}. Umore ${mood}. Posso ${offer}?`;
    }

    formatPromptSummary() {
        const nearby = this.getNearbyHumans(12).map(player => `${player.username}(${player.distance.toFixed(1)}m)`).join(', ') || 'none';
        const recent = this.state.recent_interactions
            .slice(0, 6)
            .map(item => `${item.player}:${item.direction}:${item.intent}:${item.message}`)
            .join(' | ') || 'none';
        return [
            `Nearby human players: ${nearby}`,
            `Recent social interactions: ${recent}`,
            'Social policy: remember players as people with continuity. Be helpful, ask useful questions, offer concrete Minecraft help, and keep promises grounded in inventory and safety.'
        ].join('\n');
    }
}
