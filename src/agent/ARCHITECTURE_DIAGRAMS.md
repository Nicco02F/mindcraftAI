// ============================================================
// MEMORY SYSTEM ARCHITECTURE DIAGRAM
// Copy paste the content below into a Mermaid viewer
// ============================================================

/*

graph TB
    Agent["🤖 Agent"]
    Agent -->|initializes| MB["AdvancedMemoryBank"]
    Agent -->|uses| MP["MemoryAwarePrompter"]
    
    MB -->|stores| STM["Short-Term Memory<br/>Last 20 events"]
    MB -->|stores| LTM["Long-Term Memory<br/>Locations, dangers, goals"]
    MB -->|stores| Skills["Skill Memory<br/>Learned procedures"]
    MB -->|stores| Personality["Personality State<br/>Mood, fears, traits"]
    MB -->|stores| Diary["Diary<br/>Auto-generated summaries"]
    
    STM -->|saved to| JSON1["short_term_memory.json"]
    LTM -->|saved to| JSON2["long_term_memory.json"]
    Skills -->|saved to| JSON3["skill_memory.json"]
    Personality -->|saved to| JSON4["personality_state.json"]
    Diary -->|saved to| JSON5["diary.json"]
    
    JSON1 -.->|bots/botname/memories/| FS["File System"]
    JSON2 -.-> FS
    JSON3 -.-> FS
    JSON4 -.-> FS
    JSON5 -.-> FS
    
    MP -->|builds| SystemPrompt["System Prompt<br/>with injected memory"]
    
    Situation["Current Situation<br/>e.g. 'I see zombie'"]
    Situation -->|scored for relevance| Retrieval["Intelligent Retrieval<br/>relevance + importance + recency"]
    
    Retrieval -->|select top N| SelectedMem["Selected Memories<br/>Only relevant ones"]
    SelectedMem -->|inject into| SystemPrompt
    
    SystemPrompt -->|sent to| LLM["Language Model"]
    LLM -->|returns| Action["Action/Decision"]
    
    Action -->|execute| ActionResult["Action Result<br/>success/failure"]
    ActionResult -->|record with reward| MP
    
    MP -->|update| MB
    MB -->|save| FS
    
    Death["Agent Dies"] -->|record trauma| MP
    MP -->|increase fear| Personality
    MP -->|set mood anxious| Personality
    
    Success["Success Event"] -->|record in memory| MP
    MP -->|decrease fear| Personality
    MP -->|set mood confident| Personality
    
    Failure["Action Fails"] -->|count attempt| MP
    Failure -->|if 2 failures, abort| ActionLoopCheck{"Should Abort?"}
    ActionLoopCheck -->|yes| ChangeStrategy["Change Strategy"]
    ActionLoopCheck -->|no| RetryAction["Retry or Continue"]
    
    EveryNMin["Every 5 minutes"] -->|generate auto entry| MP
    MP -->|summarize recent events| Diary
    Diary -->|save| JSON5
    
    style MB fill:#4A90E2
    style MP fill:#7ED321
    style SystemPrompt fill:#F5A623
    style Retrieval fill:#BD10E0
    style FS fill:#50E3C2
    style Personality fill:#D0021B
    style Diary fill:#B8E986

*/

// ============================================================
// INFORMATION FLOW
// ============================================================

/*

Decision Making Flow:

    Agent State
        ↓
    Analyze Situation
        ↓
    Retrieve Relevant Memories
        ├─ Short-term (always)
        ├─ Long-term (scored)
        ├─ Skills (scored)
        └─ Personality state
        ↓
    Build System Prompt
        (personality + rules + memories)
        ↓
    Send to LLM
        ↓
    LLM Returns Action (JSON)
        ↓
    Execute Action
        ↓
    Get Result
        ↓
    Record in Memory
        (event + reward + personality change)
        ↓
    Save to JSON
        ↓
    Next Decision Loop

*/

// ============================================================
// MEMORY RETRIEVAL SCORING
// ============================================================

/*

    Situation: "I'm in a cave and see a skeleton"

    Score each memory:
    
    Memory: "skeleton_encounter_deadly"
    - Relevance: 100 (contains "skeleton")
    - Importance: 80 (marked as important)
    - Recency: 60 (3 hours ago)
    Score: 240 ✓ HIGH - Include
    
    Memory: "crafted_wooden_pickaxe"
    - Relevance: 5 (no match)
    - Importance: 20
    - Recency: 100 (recent)
    Score: 125 ✗ LOW - Exclude
    
    Memory: "survived_night_by_bed"
    - Relevance: 30 (related)
    - Importance: 50
    - Recency: 80
    Score: 160 ✓ MEDIUM - Include if space
    
    Result: Only top scored memories included
    
*/

// ============================================================
// PERSONALITY EVOLUTION
// ============================================================

/*

Initial State:
{
  mood: "neutral",
  fear_level: 0.5,
  exploration_drive: 0.6,
  traits: ["cautious", "curious"]
}

Event: Death to creeper
→ mood = "anxious"
→ fear_level += 0.1 → 0.6
→ learned_fears.combat += 0.3 → 0.5
→ Recent Trauma recorded

Event: 10 hours safe gameplay
→ mood = "confident"
→ fear_level -= 0.05 → 0.55
→ exploration_drive += 0.1 → 0.7

Result: Personality shifts with experience
        Bot becomes more/less bold
        Bot has consistent character

*/

// ============================================================
// ANTI-LOOP MECHANISM
// ============================================================

/*

    Action: "mine_diamond"
    
    Attempt 1: Failed
    → recordFailedAttempt("mine_diamond")
    → count = 1
    
    Attempt 2: Failed
    → recordFailedAttempt("mine_diamond")
    → count = 2
    → shouldAbortAction("mine_diamond") = TRUE
    
    Attempt 3: Blocked!
    → System recommends alternative
    → "Try gathering iron instead"
    → Change strategy
    → Reset counter
    
    Result: No more infinite loops!

*/

// ============================================================
// DIARY GENERATION
// ============================================================

/*

    Trigger: Every 5 minutes
    
    Input:
    - Last 10 short-term events
    - Current mood
    - Recent trauma (if any)
    - Unfinished goals
    
    Generated Entry:
    "Today I explored the cave system.
     I found iron deposits near the lava.
     A creeper almost killed me.
     Current mood: anxious.
     Still need: diamond pickaxe.
     Must improve armor before returning to caves."
    
    Output: Saved to diary.json
    
    Result: Fascinating narrative over time!

*/

// ============================================================
// JSON FILE STRUCTURE
// ============================================================

/*

bots/AndyBot/memories/

short_term_memory.json:
[
  {"timestamp": "2024-01-15T14:30:00Z", "event": "Found iron ore", "reward": 25},
  {"timestamp": "2024-01-15T14:29:00Z", "event": "Killed zombie", "reward": 30},
  ...
]

long_term_memory.json:
{
  "home_position": [100, 65, 0],
  "danger_zones": [{"description": "Skeleton spawner", "location": [150, 30, 50]}],
  "resource_locations": [{"resource": "iron", "location": [145, 40, 55], "quantity": 8}],
  "unfinished_goals": ["Get diamond pickaxe", "Build nether portal"],
  "discovered_places": {"iron_cave": {"position": [145, 40, 55], "description": "Rich deposits"}}
}

skill_memory.json:
[
  {"name": "survive_night", "steps": ["gather_wood", "craft_bed", "sleep"], "success_rate": 0.85},
  {"name": "mine_iron", "steps": ["find_ore", "equip_pick", "mine", "collect"], "success_rate": 0.92}
]

personality_state.json:
{
  "name": "AndyBot",
  "traits": ["cautious", "curious"],
  "mood": "confident",
  "fear_level": 0.45,
  "exploration_drive": 0.7,
  "learned_fears": {"cave_combat": 0.6, "lava": 0.8},
  "skill_confidence": {"survive_night": 0.85}
}

diary.json:
[
  {"timestamp": "2024-01-15T14:30:00Z", "entry": "Today I explored east and found diamonds..."},
  {"timestamp": "2024-01-15T14:25:00Z", "entry": "Almost died to skeletons in cave..."}
]

*/

// ============================================================
// INTEGRATION POINTS IN AGENT.JS
// ============================================================

/*

Agent.start():
    ↓
    Initialize memory system
    this.memory_bank = new AdvancedMemoryBank(this.name)
    this.memory_prompter = new MemoryAwarePrompter(this)

Agent.reply(message):
    ↓
    Build system prompt with memory
    const systemPrompt = this.memory_prompter.buildSystemPrompt(situation)
    
    Call LLM with new prompt

ActionManager.executeAction(action):
    ↓
    Record result in memory
    this.memory_prompter.handleActionResult(action, result, reward)

Bot.on('death'):
    ↓
    Record death in memory
    this.memory_prompter.handleDeath(position, message)

*/

// ============================================================

