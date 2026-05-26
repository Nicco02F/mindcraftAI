// ============================================================
// MEMORY SYSTEM - ULTRA QUICK REFERENCE (Cheat Sheet)
// ============================================================

// INITIALIZATION
import { AdvancedMemoryBank } from './advanced_memory_bank.js';
import { MemoryAwarePrompter } from './memory_aware_prompter.js';
import MEMORY_QUICK_COMMANDS from './memory_quick_commands.js';

this.memory_bank = new AdvancedMemoryBank(this.name);
this.memory_prompter = new MemoryAwarePrompter(this);

// ============================================================
// MOST COMMON OPERATIONS
// ============================================================

// Remember important location
MEMORY_QUICK_COMMANDS.rememberPlace(mb, 'iron_cave', x, y, z, 'description');
MEMORY_QUICK_COMMANDS.setHome(mb, x, y, z);

// Learn skill
MEMORY_QUICK_COMMANDS.learnSkill(mb, 'survive_night', ['step1', 'step2', 'step3'], 0.85);
MEMORY_QUICK_COMMANDS.updateSkill(mb, 'survive_night', wasSuccessful);

// Add goal
MEMORY_QUICK_COMMANDS.addGoal(mb, 'Get diamond pickaxe');
MEMORY_QUICK_COMMANDS.completeGoal(mb, 'Get diamond pickaxe');

// Prevent loops
if (MEMORY_QUICK_COMMANDS.shouldAbortAction(mb, 'action_name')) {
    // Change strategy
}
MEMORY_QUICK_COMMANDS.recordFailure(mb, 'action_name');

// Build system prompt with memory
const systemPrompt = this.memory_prompter.buildSystemPrompt(situation);

// Record action result
this.memory_prompter.handleActionResult(action, result, reward);

// Handle death
this.memory_prompter.handleDeath(location, message);

// Personality checks
const mood = MEMORY_QUICK_COMMANDS.getMood(mb);
const fear = MEMORY_QUICK_COMMANDS.getFearLevel(mb);
MEMORY_QUICK_COMMANDS.recordSuccess(mb, 'event');
MEMORY_QUICK_COMMANDS.recordTrauma(mb, 'event');

// ============================================================
// 3-TIER MEMORY STRUCTURE
// ============================================================

// SHORT-TERM (last 20 events)
getRecentEvents(5) → ['Event1', 'Event2', ...]

// LONG-TERM (persistent)
longTermMemory = {
    home_position: [x, y, z],
    danger_zones: [{description, location}],
    resource_locations: [{resource, location, quantity}],
    unfinished_goals: ['goal1', 'goal2'],
    discovered_places: {name: {position, description}},
    mob_encounters: [{mob_type, health, loot}]
}

// SKILLS (learned procedures)
skills = [{name, steps[], success_rate, first_learned, last_used}]

// PERSONALITY (evolving identity)
personality = {
    traits: ['cautious', 'curious'],
    mood: 'confident',
    fear_level: 0.5,
    exploration_drive: 0.6,
    learned_fears: {cave_combat: 0.3, lava: 0.7},
    skill_confidence: {}
}

// ============================================================
// ANTI-LOOP MECHANISM
// ============================================================

// Records failure attempts
recordFailedAttempt(action) → count++

// Returns true if action failed 2+ times
shouldAbortAction(action) → count >= 2

// Reset failure counter
resetFailedAttempt(action) → delete count

// ============================================================
// PERSONALITY EVOLUTION
// ============================================================

recordTrauma(event) → {
    fear_level +0.1
    mood = 'anxious'
    recent_trauma = event
}

recordSuccess(event) → {
    fear_level -0.05
    mood = 'confident'
    recent_trauma = null
}

// Death type affects specific fears
cave_combat +0.3, lava +0.3, high_fall +0.3

// ============================================================
// MEMORY RETRIEVAL (automatic)
// ============================================================

retrieveRelevantMemories(situation) → {
    short_term: [recent events],
    long_term: [scored by relevance],
    skills: [scored by relevance],
    personality_state: {relevant fields}
}

// SCORING:
// relevance (keyword match) + importance (user-set) + recency

// ============================================================
// FILE STRUCTURE
// ============================================================

bots/{botname}/memories/
├── short_term_memory.json        ← [events]
├── long_term_memory.json         ← {places, dangers, goals...}
├── skill_memory.json             ← [{skills}]
├── personality_state.json        ← {mood, fears, traits...}
└── diary.json                    ← [{entries}]

// ============================================================
// SYSTEM PROMPT AUTO-INJECTION
// ============================================================

buildSystemPrompt(situation) generates:

"You are {AGENT_NAME} with traits: {TRAITS}
Current mood: {MOOD}
Fear level: {FEAR}/1.0
Exploration drive: {EXPLORATION}/1.0

Recent events: {SHORT_TERM_EVENTS}
Relevant knowledge: {SCORED_LONG_TERM}
Learned skills: {SCORED_SKILLS}

...full rules...

{SITUATION_SPECIFIC_MEMORY}"

// ============================================================
// DIARY AUTO-GENERATION
// ============================================================

Every 5 minutes: generateAutoDiary() → generates entry with:
- Recent events summary
- Current mood
- Recent trauma (if any)
- Unfinished goals
- Saves to diary.json

// ============================================================
// ESSENTIAL INTEGRATION POINTS
// ============================================================

1. Agent.start()
   this.memory_bank = new AdvancedMemoryBank(this.name);
   this.memory_prompter = new MemoryAwarePrompter(this);

2. Building prompts
   const systemPrompt = this.memory_prompter.buildSystemPrompt(situation);

3. After actions
   this.memory_prompter.handleActionResult(action, result, reward);

4. On death
   this.memory_prompter.handleDeath(position, message);

// ============================================================
// DEBUGGING/MONITORING
// ============================================================

// Export all memory
MEMORY_QUICK_COMMANDS.exportAll(mb)

// Get statistics
MEMORY_QUICK_COMMANDS.getStats(mb) → {
    events, places, dangers, resources, goals, skills, diary_entries
}

// Get personality
{mood, fear_level, exploration_drive, traits}

// Get recommendation
this.memory_prompter.getActionRecommendation(situation)

// ============================================================
// REWARDS (for motivation)
// ============================================================

Positive:
+10 food, +15 tools, +20 shelter, +25 locations
+30 danger survival, +40 iron, +60 diamonds, +80 goals, +100 systems

Negative:
-20 waste, -30 stuck, -40 starvation, -50 failures, -80 damage, -150 death

// ============================================================
// KEY FEATURES
// ============================================================

✓ 3-tier memory (short/long/skills)
✓ Intelligent retrieval (only relevant memories)
✓ Anti-loop detection (fails 2x = abort)
✓ Personality evolution (fear, mood, traits)
✓ Skill learning with success rates
✓ Location/resource/danger tracking
✓ Automatic diary generation
✓ Death trauma analysis
✓ JSON persistence (no database)
✓ Reward system for motivation

// ============================================================
// BEHAVIORAL RULES IN PROMPT
// ============================================================

1. Never repeat failed actions 2x
2. If stuck, change strategy
3. Avoid aimless wandering
4. Think before acting
5. Preserve resources
6. Avoid unnecessary combat
7. Sleep during night if possible
8. Retreat if low health
9. Learn from failures
10. Never spam identical behaviors

// ============================================================
// EXPECTED BEHAVIOR AFTER IMPLEMENTATION
// ============================================================

✓ Bot won't repeat failed strategies
✓ Bot remembers all discoveries
✓ Bot has consistent personality
✓ Bot shows trauma/confidence shifts
✓ Bot pursues goals over time
✓ Bot writes fascinating diary
✓ Bot makes strategic decisions
✓ Bot evolves over hours/days
✓ Bot appears genuinely "alive"

// ============================================================

// SEE: MEMORY_SYSTEM_GUIDE.md for full documentation
// SEE: PRACTICAL_INTEGRATION_EXAMPLES.md for code snippets
// RUN: memory_system_test.js to verify setup

// ============================================================
