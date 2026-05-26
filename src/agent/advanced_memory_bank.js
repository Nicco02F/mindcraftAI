// Advanced Memory System for Minecraft Agent
// 3-tier memory architecture with intelligent retrieval

import fs from 'fs';
import path from 'path';

function stripExecutableCommands(text) {
    return String(text || '')
        .replace(/!(\w+)(?:\([^)]*\))?/g, '$1')
        .replace(/\s+/g, ' ')
        .trim();
}

function eventKey(event) {
    return stripExecutableCommands(event)
        .toLowerCase()
        .replace(/\b\d{4}-\d{2}-\d{2}t[0-9:.z-]+\b/g, '')
        .replace(/\s+/g, ' ')
        .slice(0, 240);
}

function isRuntimeDiagnostic(event) {
    const text = String(event || '').toLowerCase();
    return text.includes('!!code threw exception') ||
        text.includes('stack trace:') ||
        text.includes('partialreaderror') ||
        text.includes('unexpected buffer end while reading varint');
}

function cleanEventText(event) {
    let text = String(event || '').replace(/\r\n/g, '\n').trim();
    if (!text) return '';

    if (isRuntimeDiagnostic(text)) {
        const action = text.match(/^([^:\n]{1,80})/)?.[1]?.trim() || 'action';
        const errorLine = text
            .split('\n')
            .map(line => line.trim())
            .find(line => /^(error|typeerror|referenceerror|rangeerror|syntaxerror):/i.test(line));
        return `${action}: runtime exception${errorLine ? ` (${errorLine})` : ''}`;
    }

    if (text.length > 600) {
        text = `${text.slice(0, 600).trim()}...`;
    }

    return text;
}

export class AdvancedMemoryBank {
    constructor(botName) {
        this.botName = botName;
        this.memoryDir = `bots/${botName}/memories`;
        
        // Ensure memory directory exists
        if (!fs.existsSync(this.memoryDir)) {
            fs.mkdirSync(this.memoryDir, { recursive: true });
        }

        this.shortTermFile = path.join(this.memoryDir, 'short_term_memory.json');
        this.longTermFile = path.join(this.memoryDir, 'long_term_memory.json');
        this.skillsFile = path.join(this.memoryDir, 'skill_memory.json');
        this.personalityFile = path.join(this.memoryDir, 'personality_state.json');
        this.diaryFile = path.join(this.memoryDir, 'diary.json');
        this.failuresFile = path.join(this.memoryDir, 'failure_memory.json');
        this.questStateFile = path.join(this.memoryDir, 'quest_state.json');

        // Load or initialize all memory types
        this.shortTermMemory = this.normalizeShortTermMemory(this.loadMemory(this.shortTermFile, []));
        this.longTermMemory = this.normalizeLongTermMemory(
            this.loadMemory(this.longTermFile, this.initializeLongTermMemory())
        );
        this.skills = this.loadMemory(this.skillsFile, []);
        this.personality = this.normalizePersonality(
            this.loadMemory(this.personalityFile, this.initializePersonality())
        );
        this.diary = this.loadMemory(this.diaryFile, []);
        this.questState = this.loadMemory(this.questStateFile, {});

        // For tracking repeated failures
        this.failedAttempts = this.loadMemory(this.failuresFile, {});
        this.pruneLowValueMemories();
        this.pruneLowValueShortTermMemories();
        this.pruneLowValueSkills();
        this.decayFailures(1);
        this.ensureMemoryFiles();
    }

    // ============ INITIALIZATION ============

    initializePersonality() {
        return {
            name: this.botName,
            traits: ['cautious', 'curious', 'survival-oriented'],
            fear_level: 0.5,
            exploration_drive: 0.6,
            crafting_preference: 'practical',
            mood: 'neutral',
            recent_trauma: null,
            learned_fears: {
                cave_combat: 0.3,
                lava: 0.7,
                high_fall: 0.5
            },
            skill_confidence: {},
            reward_score: 0,
            recent_reward_score: 0,
            policy_bias: {
                exploration: 0.5,
                social: 0.5,
                risk_tolerance: 0.35,
                resource_efficiency: 0.5
            }
        };
    }

    initializeLongTermMemory() {
        return {
            home_position: null,
            danger_zones: [],
            resource_locations: [],
            unfinished_goals: [],
            discovered_places: {},
            mob_encounters: [],
            social_relationships: {}
        };
    }

    normalizePersonality(memory) {
        const defaults = this.initializePersonality();
        if (!memory || Array.isArray(memory) || typeof memory !== 'object') {
            return defaults;
        }

        const learnedFears = memory.learned_fears && !Array.isArray(memory.learned_fears)
            ? { ...defaults.learned_fears, ...memory.learned_fears }
            : defaults.learned_fears;

        return {
            ...defaults,
            ...memory,
            traits: Array.isArray(memory.traits) ? memory.traits : defaults.traits,
            fear_level: Number.isFinite(memory.fear_level) ? memory.fear_level : defaults.fear_level,
            exploration_drive: Number.isFinite(memory.exploration_drive) ? memory.exploration_drive : defaults.exploration_drive,
            learned_fears: learnedFears,
            skill_confidence: memory.skill_confidence && !Array.isArray(memory.skill_confidence)
                ? memory.skill_confidence
                : {},
            reward_score: Number.isFinite(memory.reward_score) ? memory.reward_score : defaults.reward_score,
            recent_reward_score: Number.isFinite(memory.recent_reward_score) ? memory.recent_reward_score : defaults.recent_reward_score,
            policy_bias: memory.policy_bias && !Array.isArray(memory.policy_bias)
                ? { ...defaults.policy_bias, ...memory.policy_bias }
                : defaults.policy_bias
        };
    }

    normalizeLongTermMemory(memory) {
        const defaults = this.initializeLongTermMemory();
        if (!memory || Array.isArray(memory) || typeof memory !== 'object') {
            return defaults;
        }

        return {
            home_position: memory.home_position ?? defaults.home_position,
            danger_zones: Array.isArray(memory.danger_zones) ? memory.danger_zones : [],
            resource_locations: Array.isArray(memory.resource_locations) ? memory.resource_locations : [],
            unfinished_goals: Array.isArray(memory.unfinished_goals) ? memory.unfinished_goals : [],
            discovered_places: memory.discovered_places && !Array.isArray(memory.discovered_places)
                ? memory.discovered_places
                : {},
            mob_encounters: Array.isArray(memory.mob_encounters) ? memory.mob_encounters : [],
            social_relationships: memory.social_relationships && !Array.isArray(memory.social_relationships)
                ? memory.social_relationships
                : {}
        };
    }

    normalizeShortTermMemory(memory) {
        return (Array.isArray(memory) ? memory : [])
            .map(record => {
                const event = cleanEventText(record?.event);
                if (!event) return null;
                return {
                    ...record,
                    event,
                    key: eventKey(event)
                };
            })
            .filter(Boolean)
            .slice(0, 20);
    }

    ensureMemoryFiles() {
        this.saveMemory(this.shortTermFile, this.shortTermMemory);
        this.saveMemory(this.longTermFile, this.longTermMemory);
        this.saveMemory(this.skillsFile, this.skills);
        this.saveMemory(this.personalityFile, this.personality);
        this.saveMemory(this.diaryFile, this.diary);
        this.saveMemory(this.failuresFile, this.failedAttempts);
        this.saveMemory(this.questStateFile, this.questState);
    }

    // ============ MEMORY I/O ============

    loadMemory(filePath, defaultValue) {
        try {
            if (fs.existsSync(filePath)) {
                const data = fs.readFileSync(filePath, 'utf-8');
                return JSON.parse(data);
            }
        } catch (e) {
            console.error(`Error loading memory from ${filePath}:`, e);
        }
        return defaultValue;
    }

    saveMemory(filePath, data) {
        try {
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        } catch (e) {
            console.error(`Error saving memory to ${filePath}:`, e);
        }
    }

    // ============ SHORT-TERM MEMORY ============
    // Keep last 20 events in order

    addEvent(event, reward = 0) {
        event = cleanEventText(event);
        if (!event) return null;
        const key = eventKey(event);
        const previous = this.shortTermMemory[0];
        if (previous && previous.key === key && Date.now() - Date.parse(previous.timestamp || 0) < 120000) {
            previous.timestamp = new Date().toISOString();
            previous.repeat_count = (previous.repeat_count || 1) + 1;
            previous.reward = reward;
            this.saveMemory(this.shortTermFile, this.shortTermMemory);
            return previous;
        }

        const eventRecord = {
            timestamp: new Date().toISOString(),
            event: event,
            reward,
            key
        };

        this.shortTermMemory.unshift(eventRecord);
        if (this.shortTermMemory.length > 20) {
            this.shortTermMemory.pop();
        }

        this.saveMemory(this.shortTermFile, this.shortTermMemory);
        return eventRecord;
    }

    getRecentEvents(count = 5) {
        return this.shortTermMemory
            .filter(e => !isRuntimeDiagnostic(e.event))
            .slice(0, count)
            .map(e =>
            e.repeat_count > 1 ? `${e.event} (repeated ${e.repeat_count} times)` : e.event
        );
    }

    // ============ LONG-TERM MEMORY ============

    rememberPlace(name, x, y, z, description = '') {
        this.longTermMemory.discovered_places[name] = {
            position: [x, y, z],
            description: description,
            discovered_at: new Date().toISOString()
        };
        this.saveMemory(this.longTermFile, this.longTermMemory);
        this.addEvent(`Discovered and remembered location: ${name} at [${x}, ${y}, ${z}]`);
    }

    recallPlace(name) {
        if (name === 'home' && this.longTermMemory.home_position) {
            return this.longTermMemory.home_position;
        }

        return this.longTermMemory.discovered_places[name]?.position || null;
    }

    getKeys() {
        const keys = Object.keys(this.longTermMemory.discovered_places || {});
        if (this.longTermMemory.home_position && !keys.includes('home')) {
            keys.unshift('home');
        }
        return keys.length > 0 ? keys.join(', ') : 'none';
    }

    setHome(x, y, z) {
        this.longTermMemory.home_position = [x, y, z];
        this.saveMemory(this.longTermFile, this.longTermMemory);
        this.addEvent(`Home position set to [${x}, ${y}, ${z}]`);
    }

    recordDanger(description, location = null) {
        this.longTermMemory.danger_zones.push({
            description: description,
            location: location,
            discovered_at: new Date().toISOString()
        });
        this.saveMemory(this.longTermFile, this.longTermMemory);
        this.addEvent(`Danger recorded: ${description}`);
    }

    recordResource(resource, location, quantity = 1) {
        if (!this.shouldRememberResource(resource, quantity)) {
            this.addEvent(`Skipped low-value long-term resource memory: ${resource} at ${location}`);
            return false;
        }

        const existingResource = this.longTermMemory.resource_locations.find(
            r => r.resource === resource && 
                 JSON.stringify(r.location) === JSON.stringify(location)
        );

        if (existingResource) {
            existingResource.quantity = (existingResource.quantity || 1) + quantity;
        } else {
            this.longTermMemory.resource_locations.push({
                resource: resource,
                location: location,
                quantity: quantity,
                discovered_at: new Date().toISOString()
            });
        }

        this.saveMemory(this.longTermFile, this.longTermMemory);
        return true;
    }

    shouldRememberResource(resource, quantity = 1) {
        resource = String(resource || '').toLowerCase();
        const volatileExact = new Set([
            'stone',
            'cobblestone',
            'dirt',
            'coarse_dirt',
            'grass_block',
            'sand',
            'gravel',
            'clay',
            'netherrack',
            'end_stone',
            'crafting_table'
        ]);

        if (!resource || volatileExact.has(resource)) return false;
        if (resource.endsWith('_ore')) return false;
        if (resource.endsWith('_log') || resource.endsWith('_wood')) return false;
        if (resource.endsWith('_leaves') || resource.endsWith('_sapling')) return false;
        if (resource.includes('flower') || resource.includes('grass') || resource.includes('mushroom')) return false;

        // A single consumable block is almost never worth persistent retrieval.
        if (quantity <= 1 && !['village', 'spawner', 'mineshaft', 'stronghold', 'portal', 'chest'].some(key => resource.includes(key))) {
            return false;
        }

        return true;
    }

    pruneLowValueMemories() {
        const before = this.longTermMemory.resource_locations.length;
        this.longTermMemory.resource_locations = this.longTermMemory.resource_locations.filter(resource =>
            this.shouldRememberResource(resource.resource, resource.quantity || 1)
        );

        if (this.longTermMemory.resource_locations.length !== before) {
            this.saveMemory(this.longTermFile, this.longTermMemory);
        }
    }

    pruneLowValueShortTermMemories() {
        const before = this.shortTermMemory.length;
        this.shortTermMemory = this.normalizeShortTermMemory(this.shortTermMemory);
        if (this.shortTermMemory.length !== before) {
            this.saveMemory(this.shortTermFile, this.shortTermMemory);
        }
    }

    addUnfinishedGoal(goal) {
        if (!this.longTermMemory.unfinished_goals.includes(goal)) {
            this.longTermMemory.unfinished_goals.push(goal);
            this.saveMemory(this.longTermFile, this.longTermMemory);
            this.addEvent(`Unfinished goal added: ${goal}`);
        }
    }

    completeGoal(goal) {
        const index = this.longTermMemory.unfinished_goals.indexOf(goal);
        if (index > -1) {
            this.longTermMemory.unfinished_goals.splice(index, 1);
            this.saveMemory(this.longTermFile, this.longTermMemory);
            this.addEvent(`Goal completed: ${goal}`);
        }
    }

    recordMobEncounter(mobType, health, loot) {
        this.longTermMemory.mob_encounters.push({
            mob_type: mobType,
            health: health,
            loot: loot,
            timestamp: new Date().toISOString()
        });
        this.saveMemory(this.longTermFile, this.longTermMemory);
    }

    // ============ SKILL MEMORY ============
    // Remember successful procedures

    recordSkill(name, steps, successRate = 0.8) {
        const existingSkill = this.skills.find(s => s.name === name);

        if (existingSkill) {
            existingSkill.steps = steps;
            existingSkill.success_rate = successRate;
            existingSkill.last_used = new Date().toISOString();
        } else {
            this.skills.push({
                name: name,
                steps: steps,
                success_rate: successRate,
                first_learned: new Date().toISOString(),
                last_used: new Date().toISOString()
            });
        }

        this.saveMemory(this.skillsFile, this.skills);
        this.addEvent(`Skill learned/updated: ${name}`);
    }

    getSkill(name) {
        return this.skills.find(s => s.name === name);
    }

    updateSkillSuccess(name, wasSuccessful) {
        const skill = this.getSkill(name);
        if (skill) {
            const currentRate = skill.success_rate || 0.5;
            // Moving average
            skill.success_rate = currentRate * 0.8 + (wasSuccessful ? 1 : 0) * 0.2;
            this.saveMemory(this.skillsFile, this.skills);
        }
    }

    shouldRememberSkill(skill) {
        const name = String(skill?.name || '').toLowerCase();
        if (!name) return false;
        if (name.startsWith('newaction') || name.startsWith('smeltitem')) return true;

        if (name.startsWith('craftrecipe:')) {
            return /pickaxe|axe|sword|shovel|furnace|chest|bed|shield|bucket|helmet|chestplate|leggings|boots/.test(name);
        }

        if (name.startsWith('collectblocks:')) {
            return /iron_ore|deepslate_iron_ore|diamond_ore|ancient_debris/.test(name);
        }

        return false;
    }

    pruneLowValueSkills() {
        const before = this.skills.length;
        this.skills = this.skills.filter(skill => this.shouldRememberSkill(skill));
        if (this.skills.length !== before) {
            this.saveMemory(this.skillsFile, this.skills);
        }
    }

    // ============ INTELLIGENT MEMORY RETRIEVAL ============

    retrieveRelevantMemories(situation) {
        situation = String(situation || '').toLowerCase();
        const relevant = {
            short_term: [],
            long_term: [],
            skills: [],
            personality_state: {}
        };

        // Always include recent events
        relevant.short_term = this.getRecentEvents(5);

        // Score long-term memories by relevance
        const scoredLongTerm = this.scoreLongTermMemories(situation);
        relevant.long_term = scoredLongTerm.slice(0, 3).map(m => m.content);

        // Score skills by relevance
        const scoredSkills = this.scoreSkills(situation);
        relevant.skills = scoredSkills.slice(0, 2).map(s => ({
            name: s.name,
            steps: s.steps,
            success_rate: s.success_rate
        }));

        // Include relevant personality state
        relevant.personality_state = this.getRelevantPersonalityState(situation);

        return relevant;
    }

    scoreLongTermMemories(situation) {
        situation = String(situation || '').toLowerCase();
        const scored = [];

        // Home position
        if (this.longTermMemory.home_position) {
            scored.push({
                content: `Home is at ${this.longTermMemory.home_position}`,
                score: situation.includes('home') ? 100 : 20
            });
        }

        // Danger zones
        for (const danger of this.longTermMemory.danger_zones) {
            let score = 10;
            const description = String(danger.description || '').toLowerCase();
            if (situation.includes('danger')) score += 50;
            if (description && situation.includes(description)) score += 30;
            
            scored.push({
                content: `Known danger: ${danger.description}`,
                score: score
            });
        }

        // Resource locations
        for (const resource of this.longTermMemory.resource_locations) {
            let score = 5;
            const resourceName = String(resource.resource || '').toLowerCase();
            if (resourceName && situation.includes(resourceName)) score += 40;
            
            scored.push({
                content: `${resource.resource} found at ${resource.location}`,
                score: score
            });
        }

        // Unfinished goals
        for (const goal of this.longTermMemory.unfinished_goals) {
            let score = 15;
            const goalText = String(goal || '').toLowerCase();
            if (goalText && situation.includes(goalText)) score += 50;
            
            scored.push({
                content: `Unfinished goal: ${goal}`,
                score: score
            });
        }

        // Social relationships
        for (const [name, relation] of Object.entries(this.longTermMemory.social_relationships || {})) {
            let score = 8;
            const relationText = JSON.stringify(relation).toLowerCase();
            if (situation.includes(String(name).toLowerCase())) score += 70;
            if (situation.includes('player') || situation.includes('human') || situation.includes('social')) score += 25;
            if (relationText && situation.includes(relationText.slice(0, 20))) score += 10;

            scored.push({
                content: `Social memory for ${name}: ${relation.recent_summary || JSON.stringify(relation)}`,
                score
            });
        }

        // Sort by score
        return scored.sort((a, b) => b.score - a.score);
    }

    scoreSkills(situation) {
        situation = String(situation || '').toLowerCase();
        return this.skills
            .map(skill => ({
                ...skill,
                score: situation.includes(skill.name.toLowerCase()) ? 100 :
                       situation.includes(skill.name.split('_')[0].toLowerCase()) ? 50 : 10
            }))
            .sort((a, b) => b.score - a.score);
    }

    getRelevantPersonalityState(situation) {
        situation = String(situation || '').toLowerCase();
        const state = {};

        if (situation.includes('mob') || situation.includes('combat')) {
            state.fear_level = this.personality.fear_level;
            state.learned_fears = this.personality.learned_fears;
        }

        if (situation.includes('explore')) {
            state.exploration_drive = this.personality.exploration_drive;
        }

        if (situation.includes('craft')) {
            state.crafting_preference = this.personality.crafting_preference;
        }

        state.mood = this.personality.mood;
        if (this.personality.recent_trauma) {
            state.recent_trauma = this.personality.recent_trauma;
        }

        return state;
    }

    // ============ PERSONALITY & EMOTION ============

    updatePersonality(changes) {
        this.personality = this.normalizePersonality({ ...this.personality, ...changes });
        this.saveMemory(this.personalityFile, this.personality);
    }

    recordTrauma(event) {
        event = stripExecutableCommands(event);
        if (isRuntimeDiagnostic(event)) {
            this.addEvent(`Runtime diagnostic ignored as survival trauma: ${event}`);
            return;
        }
        this.personality.recent_trauma = event;
        this.personality.fear_level = Math.min(1, this.personality.fear_level + 0.1);
        this.personality.mood = 'anxious';
        this.updatePersonality({
            recent_trauma: event,
            fear_level: this.personality.fear_level,
            mood: this.personality.mood
        });
        this.addEvent(`Trauma recorded: ${event}`);
    }

    recordSuccess(event) {
        this.personality.mood = 'confident';
        if (this.personality.recent_trauma) {
            this.personality.recent_trauma = null;
        }
        this.personality.fear_level = Math.max(0, this.personality.fear_level - 0.05);
        this.updatePersonality({
            recent_trauma: this.personality.recent_trauma,
            fear_level: this.personality.fear_level,
            mood: this.personality.mood
        });
        this.addEvent(`Success: ${event}`);
    }

    // ============ FAILURE TRACKING ============

    recordFailedAttempt(action) {
        if (!this.failedAttempts[action]) {
            this.failedAttempts[action] = 0;
        }
        this.failedAttempts[action]++;
        this.saveMemory(this.failuresFile, this.failedAttempts);
        this.addEvent(`Failed attempt: ${action} (${this.failedAttempts[action]} times)`);
    }

    shouldAbortAction(action) {
        return (this.failedAttempts[action] || 0) >= 2;
    }

    resetFailedAttempt(action) {
        delete this.failedAttempts[action];
        this.saveMemory(this.failuresFile, this.failedAttempts);
    }

    decayFailures(amount = 1) {
        for (const action of Object.keys(this.failedAttempts)) {
            this.failedAttempts[action] -= amount;
            if (this.failedAttempts[action] <= 0) {
                delete this.failedAttempts[action];
            }
        }
        this.saveMemory(this.failuresFile, this.failedAttempts);
    }

    getFailureSummary() {
        return Object.entries(this.failedAttempts)
            .filter(([, count]) => count > 0)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([action, count]) => `${stripExecutableCommands(action)} failed ${count} time(s)`);
    }

    // ============ DIARY & AUTO-SUMMARY ============

    addDiaryEntry(entry) {
        const diaryEntry = {
            timestamp: new Date().toISOString(),
            entry: entry
        };
        this.diary.push(diaryEntry);
        this.saveMemory(this.diaryFile, this.diary);
    }

    generateAutoDiary() {
        // Summarize last N events and personality state
        const recentEvents = this.getRecentEvents(12).filter(event => this.isDiaryWorthyEvent(event));
        const mood = this.personality.mood;
        const explorationRatio = this.personality.exploration_drive;

        let summary = `Today's observations: `;
        
        if (recentEvents.length > 0) {
            summary += recentEvents.slice(0, 3).map(event => this.cleanDiaryEvent(event)).join(' ');
        }

        summary += ` Current mood: ${mood}. `;

        if (this.personality.recent_trauma) {
            summary += `Still thinking about: ${stripExecutableCommands(this.personality.recent_trauma)}. `;
        }

        if (this.longTermMemory.unfinished_goals.length > 0) {
            summary += `Need to: ${this.longTermMemory.unfinished_goals[0]}.`;
        }

        this.addDiaryEntry(summary);
        return summary;
    }

    isDiaryWorthyEvent(event) {
        const text = String(event || '').toLowerCase();
        if (!text.trim()) return false;
        if (text.includes('skipped low-value')) return false;
        if (text.includes('found ') && text.includes('_ore at')) return false;
        if (text.includes('action output') && text.length > 220) return false;
        return true;
    }

    cleanDiaryEvent(event) {
        return stripExecutableCommands(event)
            .replace(/Action output:\s*/gi, '')
            .replace(/\n+/g, ' ')
            .slice(0, 180)
            .trim();
    }

    getPromptSummary(situation = '') {
        const relevant = this.retrieveRelevantMemories(situation);
        const sections = [];

        if (relevant.short_term.length > 0) {
            sections.push(`Recent events: ${relevant.short_term.slice(0, 5).map(stripExecutableCommands).join(' | ')}`);
        }

        if (relevant.long_term.length > 0) {
            sections.push(`Relevant knowledge: ${relevant.long_term.join(' | ')}`);
        }

        if (relevant.skills.length > 0) {
            sections.push(`Useful skills: ${relevant.skills.map(skill =>
                `${skill.name} (${Math.round((skill.success_rate || 0) * 100)}%): ${skill.steps.join(' -> ')}`
            ).join(' | ')}`);
        }

        const failures = this.getFailureSummary();
        if (failures.length > 0) {
            sections.push(`Avoid repeating: ${failures.join(' | ')}`);
        }

        const state = relevant.personality_state || {};
        sections.push(`Personality: mood=${state.mood || this.personality.mood || 'neutral'}, fear=${this.personality.fear_level ?? 0.5}, exploration=${this.personality.exploration_drive ?? 0.5}`);

        if (this.diary.length > 0) {
            sections.push(`Latest diary: ${this.diary[this.diary.length - 1].entry}`);
        }

        return sections.join('\n');
    }

    // ============ UTILITY ============

    getAllMemories() {
        return {
            short_term: this.shortTermMemory,
            long_term: this.longTermMemory,
            skills: this.skills,
            personality: this.personality,
            diary: this.diary,
            failures: this.failedAttempts
        };
    }

    clearAllMemories() {
        this.shortTermMemory = [];
        this.longTermMemory = this.initializeLongTermMemory();
        this.skills = [];
        this.personality = this.initializePersonality();
        this.diary = [];
        this.failedAttempts = {};
        this.questState = {};

        this.saveMemory(this.shortTermFile, this.shortTermMemory);
        this.saveMemory(this.longTermFile, this.longTermMemory);
        this.saveMemory(this.skillsFile, this.skills);
        this.saveMemory(this.personalityFile, this.personality);
        this.saveMemory(this.diaryFile, this.diary);
        this.saveMemory(this.failuresFile, this.failedAttempts);
        this.saveMemory(this.questStateFile, this.questState);
    }

    // ============ QUEST MANAGEMENT ============

    getQuestState(questId) {
        return this.questState[questId] || { completed: false, microtasks: {} };
    }

    updateQuestState(questId, updates) {
        if (!this.questState[questId]) {
            this.questState[questId] = { completed: false, microtasks: {} };
        }
        this.questState[questId] = { ...this.questState[questId], ...updates };
        this.saveMemory(this.questStateFile, this.questState);
    }

    completeMicrotask(questId, microtaskId) {
        if (!this.questState[questId]) {
            this.questState[questId] = { completed: false, microtasks: {} };
        }
        if (!this.questState[questId].microtasks) {
            this.questState[questId].microtasks = {};
        }
        this.questState[questId].microtasks[microtaskId] = {
            completed: true,
            timestamp: Date.now()
        };
        this.saveMemory(this.questStateFile, this.questState);
        this.addEvent(`Quest microtask completed: ${questId}/${microtaskId}`);
    }

    completeQuest(questId) {
        if (!this.questState[questId]) {
            this.questState[questId] = { microtasks: {} };
        }
        this.questState[questId].completed = true;
        this.questState[questId].completedAt = Date.now();
        this.saveMemory(this.questStateFile, this.questState);
        this.addEvent(`Quest completed: ${questId}`);
    }

    getQuestProgress(questId, totalMicrotasks) {
        const state = this.questState[questId] || { microtasks: {} };
        const completed = Object.keys(state.microtasks || {}).length;
        return Math.min(1, completed / totalMicrotasks);
    }
}
