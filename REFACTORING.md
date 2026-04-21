# ChatApp.tsx Refactoring - Modular Component Architecture

## Overview

The monolithic `ChatApp.tsx` (40KB) has been decomposed into a modular component architecture. While the main `ChatApp.tsx` remains as the orchestration point, reusable components and hooks have been extracted into separate, focused files.

## New Component Structure

```
src/ui/
├── components/
│   ├── ChatApp.tsx                 (Main orchestration - 40KB → can be reduced further)
│   ├── types.ts                    (Shared type definitions)
│   ├── MessageContent.tsx          (Syntax-highlighted message rendering)
│   ├── MessageRenderer.tsx         (User/Assistant/System message rendering)
│   ├── SessionTabs.tsx             (Session tab bar)
│   ├── InfoBar.tsx                 (Provider/Model/Token/Context info display)
│   ├── ScrollArea.tsx              (Message scrolling + scrollbar + position indicator)
│   ├── CommandSuggestions.tsx      (Slash command autocomplete display)
│   └── InputArea.tsx               (Multi-line input + streaming indicator)
├── hooks/
│   └── useScrolling.ts             (Scroll calculations + state management)
```

## Extract Breakdown

### 1. **types.ts** — Shared Type Definitions
- `ChatMessage` interface
- `TokenUsage` interface
- `Session` interface
All importable for use in hooks/components.

### 2. **MessageContent.tsx** — Syntax-Highlighted Rendering
- Parses code blocks vs. text
- Applies per-line coloring (comments, keywords)
- Handles streaming cursor
**Dependency:** `highlight.ts` (already existed)

### 3. **MessageRenderer.tsx** — Message Display
- Unified renderer for System/User/Assistant messages
- Takes message, index, total count as props
- Displays appropriate badges (💬, 🤖, ℹ) and formatting
**Dependency:** `MessageContent.tsx`

### 4. **SessionTabs.tsx** — Tab Bar
- Displays active/inactive sessions
- Quick-action hints
**No dependencies**

### 5. **InfoBar.tsx** — Metadata Display
- Provider/Model info
- Token usage + cost display
- Context window percentage (🟢/🟡/🔴)
- Pricing calculations extracted here
**No dependencies**

### 6. **ScrollArea.tsx** — Scroll & Message List
- Renders scrollbar
- Position indicator (`1-15/50 (45%)`)
- "Messages above/below" warnings
- Maps messages to MessageRenderer
**Dependencies:** `MessageRenderer.tsx`

### 7. **CommandSuggestions.tsx** — Command Autocomplete UI
- Displays filtered commands
- Highlights current selection
- Category color-coding
**No dependencies**

### 8. **InputArea.tsx** — Input & Multi-line Buffer
- Renders multi-line buffer display
- Input field
- Streaming indicator
**No dependencies**

### 9. **useScrolling.ts** — Scroll Hook
- Encapsulates scroll offset state
- Scroll calculations (MSGS_PER_SCREEN, maxOffset, etc.)
- Scrollbar thumb position math
- Scroll position indicator string
**No dependencies**

## Benefits

✅ **Smaller Components** — Each focused on one concern
✅ **Reusability** — Can use MessageRenderer, InfoBar, etc. in other UIs
✅ **Testability** — Individual components easier to unit test
✅ **Maintainability** — Clear separation of concerns
✅ **Dependency Clarity** — Easy to see what each component needs
✅ **Future Integration** — Can be imported/used by other screens (settings, debug, etc.)

## Current State

- ✅ All components extracted and building successfully
- ✅ ChatApp.tsx still orchestrates using hooks/state (40KB still in one place)
- ⏳ Next step: ChatApp could be further refactored to use extracted components more aggressively

## Migration Path (Future)

To further reduce ChatApp.tsx, could:

1. Replace inline rendering with component imports:
   ```tsx
   // Before: 50 lines of inline JSX
   // After:
   <SessionTabs sessionNames={sessionNames} currentName={currentName} />
   <InfoBar session={current} />
   <ScrollArea ... />
   ```

2. Extract command logic into separate module:
   ```tsx
   // Create src/ui/commandHandler.ts
   export const runCommand = (cmd, args, ...) => Promise<void>
   ```

3. Extract state management into custom hook:
   ```tsx
   // Create src/ui/hooks/useChatState.ts
   export const useChatState = () => { ... }
   ```

With these additional refactorings, ChatApp.tsx could be reduced to ~5-8KB of pure orchestration.

## Files Ready for Use

All components are built and available for import:

```tsx
import { MessageRenderer } from "./components/MessageRenderer.js";
import { SessionTabs } from "./components/SessionTabs.js";
import { InfoBar } from "./components/InfoBar.js";
import { ScrollArea } from "./components/ScrollArea.js";
import { CommandSuggestions } from "./components/CommandSuggestions.js";
import { InputArea } from "./components/InputArea.js";
import type { ChatMessage, Session, TokenUsage } from "./components/types.js";
import { useScrolling } from "./hooks/useScrolling.js";
```

## Architecture Diagram

```
┌─────────────────────────────────────────┐
│           ChatApp.tsx                   │ (Orchestration)
│  (State, Command Handler, AI Logic)     │
├─────────────────────────────────────────┤
│                                         │
│  ┌─────────────┐  ┌──────────────────┐ │
│  │SessionTabs  │  │ useScrolling     │ │
│  └─────────────┘  │ (hook)           │ │
│                   └──────────────────┘ │
│  ┌─────────────┐  ┌──────────────────┐ │
│  │ InfoBar     │  │CommandSuggestions│ │
│  └─────────────┘  └──────────────────┘ │
│                                         │
│  ┌────────────────────────────────────┐ │
│  │     ScrollArea                     │ │
│  │  ├─ MessageRenderer               │ │
│  │  │  └─ MessageContent            │ │
│  │  └─ Scrollbar                    │ │
│  └────────────────────────────────────┘ │
│                                         │
│  ┌──────────────────────────────────┐   │
│  │     InputArea                    │   │
│  │  ├─ Multi-line Buffer            │   │
│  │  └─ Input Field                  │   │
│  └──────────────────────────────────┘   │
│                                         │
└─────────────────────────────────────────┘
```

## Next Actions

1. **Monitor:** Watch for places where ChatApp gets unwieldy again
2. **Extend:** Add new UI screens (settings, debug) using extracted components
3. **Extract:** Move command handler logic if ChatApp exceeds 50KB
4. **Test:** Add unit tests for extracted components
