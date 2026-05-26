import fs from 'fs';
import path from 'path';

const REGION_REVISIT_SOFT_LIMIT = 4;
const MIN_EXPLORATION_INTERVAL = 3 * 60 * 1000;

function safeReadObject(filePath, fallback) {
    try {
        if (!fs.existsSync(filePath)) return fallback;
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
    } catch (err) {
        console.error(`Error reading curiosity state from ${filePath}:`, err);
        return fallback;
    }
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function regionKey(snapshot) {
    if (!snapshot?.position) return 'unknown';
    const x = Math.floor((snapshot.position.x || 0) / 64);
    const z = Math.floor((snapshot.position.z || 0) / 64);
    return `${snapshot.dimension || 'unknown'}:${x},${z}:${snapshot.biome || 'unknown'}`;
}

function countObjectKeys(obj) {
    return obj && typeof obj === 'object' && !Array.isArray(obj) ? Object.keys(obj).length : 0;
}

export class CuriosityEvaluator {
    constructor(agent) {
        this.agent = agent;
        this.file = path.join(agent.memory_bank.memoryDir, 'curiosity_state.json');
        this.state = this.normalizeState(safeReadObject(this.file, this.defaultState()));
        this.lastUpdateAt = 0;
        this.save();
    }

    defaultState() {
        return {
            version: 1,
            visited_regions: {},
            discovered_biomes: {},
            novelty_history: [],
            last_exploration_at: 0,
            last_updated: null
        };
    }

    normalizeState(state) {
        const defaults = this.defaultState();
        return {
            ...defaults,
            ...state,
            visited_regions: state.visited_regions && typeof state.visited_regions === 'object' && !Array.isArray(state.visited_regions) ? state.visited_regions : {},
            discovered_biomes: state.discovered_biomes && typeof state.discovered_biomes === 'object' && !Array.isArray(state.discovered_biomes) ? state.discovered_biomes : {},
            novelty_history: Array.isArray(state.novelty_history) ? state.novelty_history.slice(-120) : []
        };
    }

    save() {
        try {
            fs.writeFileSync(this.file, JSON.stringify(this.state, null, 2));
        } catch (err) {
            console.error(`Error saving curiosity state ${this.file}:`, err);
        }
    }

    update({ force = false } = {}) {
        const now = Date.now();
        if (!force && now - this.lastUpdateAt < 5000) return this.state;
        this.lastUpdateAt = now;

        const worldState = this.agent.world_model?.updateFromAgent?.({ force }) || {};
        const area = worldState.current_area;
        if (!area) return this.state;

        const key = regionKey(area);
        const existingRegion = this.state.visited_regions[key];
        const existingBiome = this.state.discovered_biomes[area.biome];
        const novelty = this.scoreNovelty(area, existingRegion);
        const timestamp = new Date().toISOString();

        this.state.visited_regions[key] = {
            key,
            biome: area.biome,
            dimension: area.dimension,
            first_seen: existingRegion?.first_seen || timestamp,
            last_seen: timestamp,
            visits: (existingRegion?.visits || 0) + 1,
            last_position: area.position,
            last_novelty: novelty
        };

        this.state.discovered_biomes[area.biome] = {
            biome: area.biome,
            first_seen: existingBiome?.first_seen || timestamp,
            last_seen: timestamp,
            visits: (existingBiome?.visits || 0) + 1,
            dimension: area.dimension
        };

        this.state.novelty_history.push({
            timestamp,
            region: key,
            biome: area.biome,
            novelty
        });
        if (this.state.novelty_history.length > 120) {
            this.state.novelty_history.splice(0, this.state.novelty_history.length - 120);
        }

        if (!existingRegion) {
            this.agent.memory_bank.addEvent(`Curiosity discovered new region: ${key}`, 12);
            this.agent.reward_manager?.record?.('exploration_new_region', `Discovered new region ${key}`, 22, { region: key, biome: area.biome });
        } else if (!existingBiome) {
            this.agent.memory_bank.addEvent(`Curiosity discovered new biome: ${area.biome}`, 15);
            this.agent.reward_manager?.record?.('exploration_new_biome', `Discovered new biome ${area.biome}`, 28, { region: key, biome: area.biome });
        }

        this.state.last_updated = timestamp;
        this.save();
        return this.state;
    }

    scoreNovelty(area, existingRegion = null) {
        const visits = existingRegion?.visits || 0;
        const biomeVisits = this.state.discovered_biomes[area.biome]?.visits || 0;
        const nearby = area.nearby || {};
        let score = 0.35;

        if (!existingRegion) score += 0.35;
        else score += clamp((REGION_REVISIT_SOFT_LIMIT - visits) / REGION_REVISIT_SOFT_LIMIT, 0, 0.25);

        if (!this.state.discovered_biomes[area.biome]) score += 0.2;
        else score += clamp((5 - biomeVisits) / 20, 0, 0.1);

        if ((nearby.useful_blocks || []).length > 0) score += 0.08;
        if ((nearby.food_mobs || []).length > 0) score += 0.06;
        if ((nearby.hazards || []).length > 0) score -= 0.12;

        return clamp(Number(score.toFixed(3)), 0, 1);
    }

    getPreparedness(facts = {}) {
        let score = 0;
        if ((facts.health ?? 20) >= 16) score += 0.2;
        if ((facts.hunger ?? 20) >= 14) score += 0.2;
        if (facts.foodSecure || (facts.readyFood || 0) >= 3) score += 0.18;
        if ((facts.torches || 0) >= 4) score += 0.12;
        if ((facts.highestPickaxeTier ?? -1) >= 1) score += 0.15;
        if (facts.hasMeleeWeapon) score += 0.08;
        if ((facts.equippedArmorCount || 0) > 0) score += 0.07;
        return clamp(score, 0, 1);
    }

    getCurrentNovelty() {
        this.update();
        const area = this.agent.world_model?.state?.current_area;
        if (!area) return 0.4;
        const key = regionKey(area);
        return this.state.visited_regions[key]?.last_novelty ?? this.scoreNovelty(area);
    }

    shouldInterleaveExploration(facts = {}) {
        this.update();
        const now = Date.now();
        const preparedness = this.getPreparedness(facts);
        const novelty = this.getCurrentNovelty();
        const explorationBias = this.agent.reward_manager?.state?.policy_bias?.exploration ?? 0.5;
        const drive = this.agent.memory_bank?.personality?.exploration_drive ?? 0.5;
        const recentReward = this.agent.reward_manager?.state?.recent_score ?? 0;
        const safe = (facts.health ?? 20) >= 14 &&
            (facts.hunger ?? 20) >= 12 &&
            (facts.nearbyHostiles || []).length === 0 &&
            Boolean(facts.foodSecure || (facts.readyFood || 0) >= 3) &&
            (facts.highestPickaxeTier ?? -1) >= 1;

        if (!safe) return false;
        if (now - (this.state.last_exploration_at || 0) < MIN_EXPLORATION_INTERVAL) return false;
        if (recentReward < -90) return false;

        const curiosityPressure = novelty * 0.45 + drive * 0.3 + explorationBias * 0.25;
        return preparedness >= 0.65 && curiosityPressure >= 0.58;
    }

    markExplorationChosen() {
        this.state.last_exploration_at = Date.now();
        this.save();
    }

    suggestExplorationMicrotask(facts = {}) {
        const novelty = this.getCurrentNovelty();
        const preparedness = this.getPreparedness(facts);
        const distance = preparedness > 0.8 && novelty < 0.45 ? 160 : 96;
        return {
            id: 'curiosity_explore',
            text: `Explore a nearby novel region safely (novelty=${novelty.toFixed(2)}, preparedness=${preparedness.toFixed(2)}).`,
            command: `!moveAway(${distance})`,
            status: 'pending',
            reason: 'Curiosity is high enough and survival basics are stable; move to a new region, then inspect.'
        };
    }

    formatPromptSummary() {
        this.update();
        const novelty = this.getCurrentNovelty();
        const recent = this.state.novelty_history.slice(-5)
            .map(item => `${item.biome}:${item.novelty}`)
            .join(' | ') || 'none';
        return [
            `Curiosity state: novelty=${novelty.toFixed(2)}, known_regions=${countObjectKeys(this.state.visited_regions)}, known_biomes=${countObjectKeys(this.state.discovered_biomes)}`,
            `Recent novelty: ${recent}`,
            'Curiosity policy: explore when safe, equipped, fed, and not mid-crisis. Prefer new regions/biomes and inspect after moving.'
        ].join('\n');
    }
}
