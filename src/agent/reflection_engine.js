import fs from 'fs';
import path from 'path';

const REFLECTION_LIMIT = 120;
const ACTIONS_BETWEEN_ROUTINE_REFLECTIONS = 6;

function safeReadObject(filePath, fallback) {
    try {
        if (!fs.existsSync(filePath)) return fallback;
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
    } catch (err) {
        console.error(`Error reading reflection state from ${filePath}:`, err);
        return fallback;
    }
}

function compact(text, length = 260) {
    text = String(text || '').replace(/\s+/g, ' ').trim();
    return text.length > length ? `${text.slice(0, length).trim()}...` : text;
}

function isFailure(result) {
    const text = String(result || '').toLowerCase();
    return text.includes('failed') ||
        text.includes('could not') ||
        text.includes('cannot ') ||
        text.includes('not enough') ||
        text.includes('do not have') ||
        text.includes("don't have") ||
        text.includes('interrupted') ||
        text.includes('blocked') ||
        text.includes('unable');
}

function inferLesson(commandName, result, reward) {
    const text = String(result || '').toLowerCase();
    if (reward <= -80) return 'Survival risk dominated the value. Recover, inspect, and choose a safer prerequisite.';
    if (text.includes('not enough') || text.includes('do not have') || text.includes("don't have") || text.includes('requires:')) {
        return 'A prerequisite was missing. Inspect inventory, gather or craft the missing component, then retry only after state changes.';
    }
    if (text.includes('could not find') || text.includes('no ') && text.includes('nearby')) {
        return 'The local search space is exhausted. Change area, target, or strategy before repeating.';
    }
    if (commandName === '!givePlayer') return 'Helping the player is valuable when it does not endanger core survival resources.';
    if (commandName === '!moveAway') return 'Movement changed the context; inspect the new area before committing to resource work.';
    if (reward > 25) return 'This action produced useful progress. Similar state-action choices should become more trusted.';
    return 'Small progress was made; continue only if it advances the active microtask.';
}

export class ReflectionEngine {
    constructor(agent) {
        this.agent = agent;
        this.file = path.join(agent.memory_bank.memoryDir, 'reflection_state.json');
        this.state = this.normalizeState(safeReadObject(this.file, this.defaultState()));
        this.actionsSinceReflection = 0;
        this.save();
    }

    defaultState() {
        return {
            version: 1,
            reflections: [],
            last_decision_frame: null,
            last_updated: null
        };
    }

    normalizeState(state) {
        const defaults = this.defaultState();
        return {
            ...defaults,
            ...state,
            reflections: Array.isArray(state.reflections) ? state.reflections.slice(-REFLECTION_LIMIT) : []
        };
    }

    save() {
        try {
            fs.writeFileSync(this.file, JSON.stringify(this.state, null, 2));
        } catch (err) {
            console.error(`Error saving reflection state ${this.file}:`, err);
        }
    }

    addReflection(kind, summary, lesson, metadata = {}) {
        const record = {
            timestamp: new Date().toISOString(),
            kind,
            summary: compact(summary, 360),
            lesson: compact(lesson, 360),
            metadata: this.compactMetadata(metadata)
        };

        this.state.reflections.push(record);
        if (this.state.reflections.length > REFLECTION_LIMIT) {
            this.state.reflections.splice(0, this.state.reflections.length - REFLECTION_LIMIT);
        }
        this.state.last_updated = record.timestamp;
        this.save();

        this.agent.memory_bank.addEvent(`Reflection: ${record.summary} Lesson: ${record.lesson}`, metadata.reward || 0);
        if (kind === 'major_failure' || kind === 'death') {
            this.agent.memory_bank.addDiaryEntry(`Reflection after ${kind}: ${record.summary} Lesson: ${record.lesson}`);
        }

        this.agent.autonomy_logger?.log?.({
            type: 'reflection',
            source: 'reflection_engine',
            reflection_kind: kind,
            summary: record.summary,
            lesson: record.lesson
        });

        return record;
    }

    compactMetadata(metadata = {}) {
        const compacted = {};
        for (const [key, value] of Object.entries(metadata || {})) {
            if (value === undefined || typeof value === 'function') continue;
            if (typeof value === 'string') compacted[key] = compact(value, 240);
            else if (typeof value === 'number' || typeof value === 'boolean' || value === null) compacted[key] = value;
        }
        return compacted;
    }

    maybeReflectAfterAction(commandText, commandName, result, reward, metadata = {}) {
        this.actionsSinceReflection += 1;
        const failed = isFailure(result) || reward < 0;
        const major = reward <= -45 || reward >= 35 || metadata.plannerForced;
        const routineDue = this.actionsSinceReflection >= ACTIONS_BETWEEN_ROUTINE_REFLECTIONS;

        if (!failed && !major && !routineDue) return null;

        const kind = reward <= -60 ? 'major_failure' :
            failed ? 'failure' :
            reward >= 35 ? 'success' :
            'routine';
        const plan = this.agent.objective_planner?.state?.snapshot;
        const summary = `${commandName} produced reward ${reward}. Result: ${compact(result, 220)} Active objective: ${plan?.objective || 'unknown'}.`;
        const lesson = inferLesson(commandName, result, reward);
        this.actionsSinceReflection = 0;
        return this.addReflection(kind, summary, lesson, {
            ...metadata,
            command: commandText,
            commandName,
            reward
        });
    }

    reflectOnDeath(location, message) {
        return this.addReflection(
            'death',
            `Died at ${location}. Final message: ${message}.`,
            'Treat the death location as dangerous. Recover basics first, then return only with food, gear, and a specific purpose.',
            { location, reward: -180 }
        );
    }

    reflectOnInteraction(username, message, intent) {
        if (!['help_request', 'trade', 'danger_alert', 'correction', 'praise'].includes(intent)) return null;
        const lesson = intent === 'correction'
            ? 'Human correction should update immediate priorities unless it conflicts with survival.'
            : intent === 'praise'
                ? 'The recent social behavior was useful; keep this style of help available.'
                : 'The human has an active need. Balance helping them with survival safety and remember the outcome.';
        return this.addReflection(
            'social',
            `${username} interaction intent=${intent}: ${compact(message, 180)}`,
            lesson,
            { player: username, intent }
        );
    }

    buildDecisionFrame(plan = null) {
        const reward = this.agent.reward_manager?.state;
        const curiosity = this.agent.curiosity_evaluator?.getCurrentNovelty?.();
        const socialNearby = this.agent.social_handler?.getNearbyHumans?.(8)?.map(player => player.username) || [];
        const activePlan = plan || this.agent.objective_planner?.state?.snapshot;
        const frame = {
            timestamp: new Date().toISOString(),
            objective: activePlan?.objective || null,
            microtask: activePlan?.active_microtask || null,
            expected_value_hint: reward?.recent_score >= 0 ? 'continue productive policy' : 'recover from recent penalties',
            risk_hint: (reward?.policy_bias?.risk_tolerance ?? 0.35) < 0.25 ? 'low risk tolerance: inspect and avoid combat' : 'normal risk tolerance',
            curiosity_hint: Number.isFinite(curiosity) && curiosity > 0.6 ? 'nearby novelty is high if survival is stable' : 'curiosity can wait for a safer opening',
            social_hint: socialNearby.length > 0 ? `nearby humans: ${socialNearby.join(', ')}` : 'no nearby humans'
        };
        this.state.last_decision_frame = frame;
        this.save();
        return frame;
    }

    formatPromptSummary() {
        const latest = this.state.reflections.slice(-5)
            .map(reflection => `${reflection.kind}: ${reflection.lesson}`)
            .join(' | ') || 'none';
        const frame = this.buildDecisionFrame();
        return [
            `Inner monologue summary: objective=${frame.objective || 'unknown'}, microtask=${frame.microtask || 'none'}, EV=${frame.expected_value_hint}, risk=${frame.risk_hint}, curiosity=${frame.curiosity_hint}, social=${frame.social_hint}`,
            `Recent reflections: ${latest}`,
            'Reflection policy: use concise private deliberation before important decisions, but do not expose hidden chain-of-thought in chat. Share only short conclusions when useful.'
        ].join('\n');
    }
}
