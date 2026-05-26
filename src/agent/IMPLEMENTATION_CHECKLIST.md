# 📋 IMPLEMENTATION CHECKLIST

## Phase 1: Setup (30 minutes)

- [ ] Copy all 4 core files to `src/agent/`:
  - [ ] `advanced_memory_bank.js`
  - [ ] `memory_aware_prompter.js`
  - [ ] `system_prompt.js`
  - [ ] `memory_quick_commands.js`

- [ ] Verify files compile (no syntax errors):
  ```bash
  node -c src/agent/advanced_memory_bank.js
  node -c src/agent/memory_aware_prompter.js
  node -c src/agent/system_prompt.js
  node -c src/agent/memory_quick_commands.js
  ```

- [ ] Run memory system test:
  ```bash
  node src/agent/memory_system_test.js
  ```
  Expected: All 12 tests pass ✓

- [ ] Verify memory directory created:
  ```bash
  ls bots/TestBot/memories/
  ```
  Should see: 5 JSON files

## Phase 2: Core Integration (45 minutes)

### Step 1: Update imports in `src/agent/agent.js`

```javascript
// Add imports at top
import { AdvancedMemoryBank } from './advanced_memory_bank.js';
import { MemoryAwarePrompter } from './memory_aware_prompter.js';
```

- [ ] Imports added
- [ ] No syntax errors after adding imports

### Step 2: Initialize memory in Agent.start()

```javascript
// In Agent.start(), replace:
// OLD: this.memory_bank = new MemoryBank();
// NEW:
this.memory_bank = new AdvancedMemoryBank(this.name);
this.memory_prompter = new MemoryAwarePrompter(this);
```

- [ ] Old MemoryBank replaced with AdvancedMemoryBank
- [ ] MemoryAwarePrompter initialized
- [ ] Agent starts without errors

### Step 3: Update system prompt building

Find where you build the system message for LLM calls:

```javascript
// OLD:
const systemMessage = {
    role: 'system',
    content: 'You are a Minecraft agent...'
};

// NEW:
const systemMessage = {
    role: 'system',
    content: this.memory_prompter.buildSystemPrompt('current situation')
};
```

- [ ] System prompt building updated
- [ ] New prompt includes personality
- [ ] No errors in prompt generation

### Step 4: Record action results

After each action execution:

```javascript
const reward = calculateActionReward(action, result);
this.memory_prompter.handleActionResult(action, result.output, reward);
```

- [ ] Action result recording added
- [ ] Reward calculation implemented
- [ ] Memory saves successful

### Step 5: Handle agent death

In death event handler:

```javascript
this.bot.on('death', (message) => {
    const position = this.bot.entity.position;
    this.memory_prompter.handleDeath(
        `[${position.x}, ${position.y}, ${position.z}]`,
        message
    );
    // ... rest of death handling ...
});
```

- [ ] Death handler added
- [ ] Position recorded correctly
- [ ] Fear level updates on death

## Phase 3: Testing (30 minutes)

### Manual Tests

- [ ] Bot starts successfully:
  ```bash
  npm start
  ```
  No memory-related errors

- [ ] Memory files created:
  ```bash
  ls bots/{botname}/memories/
  ```
  All 5 JSON files present

- [ ] Test action recording:
  Have bot perform action, check:
  ```bash
  cat bots/{botname}/memories/short_term_memory.json
  ```
  Recent event present ✓

- [ ] Test personality evolution:
  1. Check initial mood:
     ```bash
     cat bots/{botname}/memories/personality_state.json | grep mood
     ```
  2. Record success:
     ```javascript
     MEMORY_QUICK_COMMANDS.recordSuccess(agent.memory_bank, 'test');
     ```
  3. Check new mood changed ✓

- [ ] Test anti-loop:
  1. Record 2 failures:
     ```javascript
     MEMORY_QUICK_COMMANDS.recordFailure(mb, 'test_action');
     MEMORY_QUICK_COMMANDS.recordFailure(mb, 'test_action');
     ```
  2. Check should abort:
     ```javascript
     MEMORY_QUICK_COMMANDS.shouldAbortAction(mb, 'test_action'); // true ✓
     ```

- [ ] Test memory retrieval:
  ```javascript
  const memories = agent.memory_bank
    .retrieveRelevantMemories('mining diamonds');
  console.log(memories); // Should show scored memories ✓
  ```

### Console Checks

- [ ] No errors about missing modules
- [ ] No undefined property errors
- [ ] No JSON parse errors
- [ ] Memory files being created and updated

## Phase 4: Verification (15 minutes)

### Behavior Verification

Run the bot for at least 1 hour game time and verify:

- [ ] **Memory persistence**:
  - Restart bot
  - Check if memories still present
  - Should remember all locations, skills, goals ✓

- [ ] **Anti-loop working**:
  - Try same failed action 3 times
  - Should abort after 2 failures ✓
  - Should try alternative approach

- [ ] **Personality evolution**:
  - After successful actions: mood confident, fear lower
  - After death: mood anxious, fear higher
  - Different behavior reflecting mood ✓

- [ ] **Skill learning**:
  - Complete a complex task (e.g., survive night)
  - Check `skill_memory.json` has entry
  - Success rate should reflect actual performance ✓

- [ ] **Diary generation**:
  - Wait 5+ minutes of gameplay
  - Check `diary.json`
  - Should have auto-generated entries ✓

- [ ] **Goal tracking**:
  - Add goal to memory
  - Complete it
  - Check it's removed from `unfinished_goals` ✓

### Performance Checks

- [ ] No noticeable slowdown
- [ ] Prompt generation time reasonable
- [ ] Memory files not corrupted
- [ ] Disk space usage acceptable

## Phase 5: Advanced Features (Optional, 30 minutes)

### Manual Location Recording

```javascript
MEMORY_QUICK_COMMANDS.rememberPlace(
    agent.memory_bank,
    'iron_cave',
    120, 64, -40,
    'Rich iron deposits'
);
```

- [ ] Locations successfully recorded
- [ ] Visible in `long_term_memory.json`

### Skill Teaching

```javascript
MEMORY_QUICK_COMMANDS.learnSkill(
    agent.memory_bank,
    'gather_wood',
    ['find_tree', 'equip_axe', 'chop', 'collect'],
    0.9
);
```

- [ ] Skills stored correctly
- [ ] Success rates tracked
- [ ] Updates on reuse

### Danger Recording

```javascript
MEMORY_QUICK_COMMANDS.recordDanger(
    agent.memory_bank,
    'Skeleton spawner',
    [150, 30, 50]
);
```

- [ ] Dangers visible in memory
- [ ] Retrieved when in dangerous area

## Phase 6: Debugging & Monitoring

### Setup Memory Monitoring

```javascript
function getMemoryStatus(agent) {
    return {
        stats: MEMORY_QUICK_COMMANDS.getStats(agent.memory_bank),
        mood: MEMORY_QUICK_COMMANDS.getMood(agent.memory_bank),
        fear_level: MEMORY_QUICK_COMMANDS.getFearLevel(agent.memory_bank)
    };
}

setInterval(() => {
    console.log('Memory Status:', getMemoryStatus(agent));
}, 60000); // Every minute
```

- [ ] Memory status logging added
- [ ] Monitor shows all key metrics
- [ ] Can observe evolution over time

### Export Memory for Analysis

```javascript
const memoryExport = agent.memory_prompter.exportMemoryState();
fs.writeFileSync('memory_export.json', JSON.stringify(memoryExport, null, 2));
```

- [ ] Can export memory to file
- [ ] Export is readable JSON
- [ ] Can analyze bot "experiences"

## Final Checklist

- [ ] All 4 core files in place
- [ ] agent.js updated with new imports
- [ ] Memory initialized in Agent.start()
- [ ] System prompt uses memory
- [ ] Action results recorded
- [ ] Death handling implemented
- [ ] Test suite passes
- [ ] Memory files created automatically
- [ ] Bot behavior shows personality
- [ ] No loops on repeated failures
- [ ] Diary generating automatically
- [ ] Performance acceptable
- [ ] All documentation reviewed

## Quick Validation Script

```javascript
// Run this to validate everything is working

async function validateMemorySystem(agent) {
    const checks = [];
    
    // Check 1: Memory bank exists
    checks.push({
        name: 'Memory bank initialized',
        pass: agent.memory_bank !== undefined
    });
    
    // Check 2: Prompter exists
    checks.push({
        name: 'Memory prompter initialized',
        pass: agent.memory_prompter !== undefined
    });
    
    // Check 3: Can add event
    try {
        agent.memory_bank.addEvent('test');
        checks.push({ name: 'Can add events', pass: true });
    } catch (e) {
        checks.push({ name: 'Can add events', pass: false });
    }
    
    // Check 4: Can build prompt
    try {
        const prompt = agent.memory_prompter.buildSystemPrompt('test');
        checks.push({ 
            name: 'Can build system prompt', 
            pass: prompt.length > 100 
        });
    } catch (e) {
        checks.push({ name: 'Can build system prompt', pass: false });
    }
    
    // Check 5: Can record result
    try {
        agent.memory_prompter.handleActionResult('test', 'ok', 10);
        checks.push({ name: 'Can record action', pass: true });
    } catch (e) {
        checks.push({ name: 'Can record action', pass: false });
    }
    
    // Print results
    console.log('\n========== VALIDATION RESULTS ==========');
    checks.forEach(check => {
        const status = check.pass ? '✓' : '✗';
        console.log(`${status} ${check.name}`);
    });
    
    const allPass = checks.every(c => c.pass);
    console.log(`\n${allPass ? '✓ ALL CHECKS PASS' : '✗ SOME CHECKS FAILED'}`);
    return allPass;
}

// Run it
await validateMemorySystem(agent);
```

- [ ] Run validation script
- [ ] All checks pass
- [ ] Ready for production!

---

**You're done! Your bot now has a complete memory system.** 🎉

Start the bot and watch it develop personality, remember discoveries, avoid repeated mistakes, and write fascinating diary entries!
