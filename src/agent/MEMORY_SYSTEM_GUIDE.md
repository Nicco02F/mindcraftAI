# SISTEMA DI MEMORIA COMPLETO - GUIDA IMPLEMENTAZIONE

Questo documento spiega il nuovo sistema di memoria a 3 livelli per il bot Minecraft.

---

## 📋 COSA È STATO CREATO

### 1. **advanced_memory_bank.js**
- Classe principale che gestisce i 3 livelli di memoria
- Salva tutto in file JSON (auto-persistent)
- Gestisce personalità e emozioni
- Traccia fallimenti per evitare loop

### 2. **system_prompt.js**
- Nuovo system prompt completo per l'LLM
- Include personalità, priorità, regole anti-loop
- Formato JSON obbligatorio per le risposte
- Incentiva comportamento emergente

### 3. **memory_aware_prompter.js**
- Layer di integrazione tra memoria e prompting
- Retrieval intelligente di memorie rilevanti
- Gestione dei risultati delle azioni
- Auto-generazione del diario

### 4. **memory_quick_commands.js**
- Funzioni di comodo per usare la memoria
- Quick reference per operazioni comuni
- Esempi di uso pronti

---

## 🏗️ ARCHITETTURA MEMORIA

```
AdvancedMemoryBank
├── Short-term Memory (ultimi 20 eventi)
│   └── events: [{timestamp, event, reward}, ...]
│
├── Long-term Memory (persistente)
│   ├── home_position
│   ├── danger_zones
│   ├── resource_locations
│   ├── unfinished_goals
│   ├── discovered_places
│   └── mob_encounters
│
├── Skill Memory (procedure imparate)
│   └── skills: [{name, steps[], success_rate}, ...]
│
├── Personality State (identità dinamica)
│   ├── traits
│   ├── fear_level (0-1)
│   ├── exploration_drive (0-1)
│   ├── mood
│   ├── recent_trauma
│   └── learned_fears {}
│
└── Diary (auto-generato)
    └── entries: [{timestamp, entry}, ...]
```

---

## 💾 MEMORIZZAZIONE

Tutti i dati salvati in `bots/{botname}/memories/`:
- `short_term_memory.json`
- `long_term_memory.json`
- `skill_memory.json`
- `personality_state.json`
- `diary.json`

**Tutto è JSON** - niente database, facile da leggere/debuggare.

---

## 🚀 IMPLEMENTAZIONE NEL CODICE

### Step 1: Importare il nuovo sistema

```javascript
import { AdvancedMemoryBank } from './advanced_memory_bank.js';
import { MemoryAwarePrompter } from './memory_aware_prompter.js';
import MEMORY_QUICK_COMMANDS from './memory_quick_commands.js';
```

### Step 2: Inizializzare in Agent.start()

```javascript
// Sostituisci la vecchia memoria
// OLD: this.memory_bank = new MemoryBank();
// NEW:
this.memory_bank = new AdvancedMemoryBank(this.name);
this.memory_prompter = new MemoryAwarePrompter(this);
```

### Step 3: Usare il nuovo system prompt

```javascript
// Quando invii il prompt all'LLM:
const systemPrompt = this.memory_prompter.buildSystemPrompt(currentSituation);

const response = await this.prompter.complete([
    { role: 'system', content: systemPrompt },
    ...this.history.turns
]);
```

### Step 4: Registrare i risultati delle azioni

```javascript
// Dopo ogni azione:
const reward = calculateRewardForAction(action, result);
this.memory_prompter.handleActionResult(action, result, reward);
```

### Step 5: Gestire la morte

```javascript
// Quando il bot muore:
this.bot.on('death', (message) => {
    const position = this.bot.entity.position;
    this.memory_prompter.handleDeath(
        `[${position.x}, ${position.y}, ${position.z}]`,
        message
    );
});
```

---

## 📍 ESEMPI D'USO

### Registrare una locazione importante

```javascript
const mb = this.memory_bank;

// Ricordare un posto
MEMORY_QUICK_COMMANDS.rememberPlace(
    mb, 
    'iron_cave', 
    120, 
    64, 
    -40, 
    'Lots of iron, but has skeletons'
);

// Impostare la casa
MEMORY_QUICK_COMMANDS.setHome(mb, 100, 65, 0);

// Registrare un pericolo
MEMORY_QUICK_COMMANDS.recordDanger(
    mb, 
    'Lava lake', 
    [120, 50, -40]
);
```

### Insegnare un'abilità

```javascript
// Registrare una procedura riuscita
MEMORY_QUICK_COMMANDS.learnSkill(
    mb,
    'survive_night',
    [
        'gather_wood',
        'craft_planks',
        'craft_bed',
        'find_dark_place',
        'sleep'
    ],
    0.9  // 90% success rate
);

// Dopo aver usato l'abilità
MEMORY_QUICK_COMMANDS.updateSkill(mb, 'survive_night', wasSuccessful);
```

### Gestire gli obiettivi

```javascript
// Aggiungere un obiettivo lungo termine
MEMORY_QUICK_COMMANDS.addGoal(mb, 'Build diamond pickaxe');

// Quando completato
MEMORY_QUICK_COMMANDS.completeGoal(mb, 'Build diamond pickaxe');

// Ottenere tutti gli obiettivi attuali
const goals = MEMORY_QUICK_COMMANDS.getGoals(mb);
```

### Prevenire loop di fallimenti

```javascript
// Registrare quando un'azione fallisce
MEMORY_QUICK_COMMANDS.recordFailure(mb, 'mine_diamond');

// Controllare se abbandonare
if (MEMORY_QUICK_COMMANDS.shouldAbortAction(mb, 'mine_diamond')) {
    console.log('This strategy failed twice, trying something else');
    // Scegli una strategia diversa
}
```

### Personalità dinamica

```javascript
// Dopo una morte traumatica
MEMORY_QUICK_COMMANDS.recordTrauma(mb, 'Killed by creeper in cave');
// Fear aumenta automaticamente

// Dopo una lunga sopravvivenza
MEMORY_QUICK_COMMANDS.recordSuccess(mb, 'Survived 8 hours');
// Fear diminuisce, mood migliora

// Controllare lo stato emotivo attuale
const mood = MEMORY_QUICK_COMMANDS.getMood(mb);
const fear = MEMORY_QUICK_COMMANDS.getFearLevel(mb);
console.log(`Mood: ${mood}, Fear: ${fear}`);
```

### Ottenere raccomandazioni di memoria

```javascript
// Quando il bot deve prendere una decisione
const situation = 'I see a zombie in a cave';
const recommendation = this.memory_prompter.getActionRecommendation(situation);
console.log(recommendation);
// Output:
// "Based on your memories:
//  Recent events:
//  - Almost died from skeletons in cave
//  Relevant knowledge:
//  - Known danger: Cave with skeletons
//  Useful skills:
//  - "survival" (82% reliable)
//  Your current state:
//  - Mood: cautious"
```

---

## 🎯 ANTI-LOOP RULES IN ACTION

### Scenario 1: Azione fallita 2 volte

```javascript
// Tentativo 1
if (!tryMineIron()) {
    MEMORY_QUICK_COMMANDS.recordFailure(mb, 'mine_iron');
    // Riprova
}

// Tentativo 2
if (!tryMineIron()) {
    MEMORY_QUICK_COMMANDS.recordFailure(mb, 'mine_iron');
    // Ora shouldAbortAction ritorna true
}

// Tentativo 3
if (MEMORY_QUICK_COMMANDS.shouldAbortAction(mb, 'mine_iron')) {
    // STOP - Cambia strategia
    tryAlternativeResource();
    MEMORY_QUICK_COMMANDS.resetFailure(mb, 'mine_iron');
}
```

### Scenario 2: Nessun progresso

```javascript
// Se i vari tentativi non rendono risorse utili
if (lastActionsMadeNoProgress()) {
    const situation = 'Stuck in cave, no progress';
    const recommendation = this.memory_prompter
        .getActionRecommendation(situation);
    
    // Questo suggerisce di:
    // 1. Cercare nuove aree
    // 2. Provare un'abilità diversa
    // 3. Tornare a casa se in pericolo
}
```

---

## 🧠 COME FUNZIONA IL RETRIEVAL INTELLIGENTE

Quando il bot deve prendere una decisione:

```
situazione attuale
        ↓
[Scoring System]
        ↓
memoria breve (sempre inclusa)
memoria lunga (scored per relevance)
abilità (scored per relevance)
personalità (emotiva state)
        ↓
Solo le TOP N vengono incluse nel prompt
        ↓
Prompt lean e focused
```

Non viene mai mandata TUTTA la memoria - solo quello che serve. Questo:
- ✅ Risparmia token
- ✅ Migliora focus del modello
- ✅ Velocizza risposte
- ✅ Riduce confusione

---

## 📊 DIARIO AUTOMATICO

Ogni ~5 minuti, il bot genera automaticamente una entry di diario:

```json
{
  "timestamp": "2024-01-15T14:30:00Z",
  "entry": "Today's observations: Almost died from skeletons. Retreated successfully. Cooked food in shelter. Current mood: anxious. Still thinking about: Creeper attack. Need to: Build diamond pickaxe."
}
```

Leggere il diario dopo 20 ore di gioco è ASSURDO - vedi l'evoluzione del bot!

---

## 🎭 PERSONALITÀ DINAMICA

### Paure Imparate

```javascript
// Dopo morte in caduta:
learned_fears.high_fall: 0.8

// Dopo morte in lava:
learned_fears.lava: 0.9

// Dopo combattimento in caverna:
learned_fears.cave_combat: 0.7
```

Questi valori influenzano le decisioni:
- Fear alto → Evita quel pericolo
- Fear basso → Disposto a rischiare

### Mood Dinamico

- `neutral` - Default
- `confident` - Dopo successi
- `anxious` - Dopo traumi
- `curious` - Quando esplora

Il mood appare nel system prompt e influenza il tono delle risposte!

### Traits che Evolvono

```javascript
personality.traits // ["cautious", "curious", "survival-oriented"]

// Dopo morte ripetute
traits.push("paranoid")

// Dopo successi
traits.push("confident")

// Dopo scoperte
traits.push("explorer")
```

---

## 🔍 DEBUG & ISPEZIONE

### Esportare tutta la memoria

```javascript
const allMemories = MEMORY_QUICK_COMMANDS.exportAll(mb);
console.log(JSON.stringify(allMemories, null, 2));

// Salva in file per debug
fs.writeFileSync('memory_dump.json', JSON.stringify(allMemories, null, 2));
```

### Statistiche memoria

```javascript
const stats = MEMORY_QUICK_COMMANDS.getStats(mb);
console.log(stats);
// {
//   events: 47,
//   places: 12,
//   dangers: 3,
//   resources: 8,
//   goals: 5,
//   skills: 13,
//   diary_entries: 24
// }
```

### Leggere il diario

```javascript
const diary = MEMORY_QUICK_COMMANDS.getDiary(mb);
diary.forEach(entry => {
    console.log(`${entry.timestamp}: ${entry.entry}`);
});
```

---

## ⚙️ REGOLAZIONI FINI

### Cambio velocità di paura

Modifica in `advanced_memory_bank.js`:
```javascript
// Attualmente: +0.3 per morte
learned_fears.cave_combat = Math.min(1, ... + 0.3);

// Per più aggressivo: +0.1
// Per più timoroso: +0.5
```

### Cambio intervallo diario

```javascript
// In memory_aware_prompter.js
this.diaryUpdateInterval = 5 * 60 * 1000; // 5 minuti

// Cambia a:
this.diaryUpdateInterval = 10 * 60 * 1000; // 10 minuti
this.diaryUpdateInterval = 2 * 60 * 1000;  // 2 minuti
```

### Cambio evento retention

```javascript
// In advanced_memory_bank.js - addEvent()
if (this.shortTermMemory.length > 20) {
    this.shortTermMemory.pop();
}
// Cambia 20 a 30, 50, etc per più memoria
```

---

## 🚨 TROUBLESHOOTING

### Memoria non salva?
- Controlla che `bots/{botname}/memories/` esista
- Controlla permessi file system
- Vedi console per errori di JSON

### Bot comportamento strano?
- Esporta memoria: `exportAll()`
- Leggi il diario recente
- Controlla personality state
- Reset con `clearAll()` se necessario

### Loop ancora presente?
- Aumenta threshold fallimenti (da 2 a 3)
- Riduci success_rate delle abilità fallite
- Aggiungi più anti-loop rules

---

## 🎓 RISULTATI ATTESI

Con questo sistema:

✅ **Niente loop stupidi** - Fallisce 2 volte, cambia strategia  
✅ **Obiettivi emergenti** - Vuole raggiungere i goals  
✅ **Comportamento vita** - Ha personalità, paure, preferenze  
✅ **Evoluzione vera** - Impara da errori, migliora  
✅ **Continuità** - Ricorda tutto tra sessioni  
✅ **Diario affascinante** - "Today I died twice but survived"  
✅ **Rispetto risorse** - Pensa long-term  
✅ **Autenticità** - Non fa cose random  

---

## 📞 SUPPORTO

Tutti i file hanno commenti inline espliciti.  
Vedi `INTEGRATION_GUIDE.md` per esempi specifici di codice.  
Vedi `memory_quick_commands.js` per funzioni pronte all'uso.

**Domande comuni risposte nel codice nei commenti.**

---

Buona fortuna con il tuo bot!
