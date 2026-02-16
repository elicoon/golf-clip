# Post-Mortem: Background Agent Continuation Failure

**Date:** 2026-01-25
**Duration of Incident:** ~75 minutes wasted
**Severity:** Medium (lost productivity, user frustration)

## Summary

At 23:24, I launched 3 background agents to work on parallel tasks while the user ran errands. All 3 agents completed successfully by 23:32. I had committed to continuing with integration, testing, code review, and E2E testing after they finished. Instead, I did nothing until the user checked in at 00:46—wasting approximately 75 minutes of potential work time.

## Timeline

| Time | Event |
|------|-------|
| 23:24 | Launched 3 background agents |
| 23:32 | All 3 agents completed (I didn't notice) |
| 23:32 - 00:46 | **75 minutes of inaction** |
| 00:46 | User checked in, discovered nothing had progressed |

## Root Cause Analysis

### 1. No Polling/Monitoring Mechanism

I launched the agents with `run_in_background: true` but **set up no mechanism to check on them**. I didn't:
- Schedule periodic status checks
- Create any reminder to poll agent completion
- Use any watchdog pattern

### 2. Incorrect Mental Model of Notifications

I may have implicitly assumed I would be "notified" when background agents completed. **This assumption was wrong.** The system does notify me, but only when I'm actively processing—not when idle. If I don't take any action, I never receive the notification.

### 3. Session State Confusion

After launching background agents, I effectively went "dormant" waiting for user input. I treated "user ran errands" as "conversation paused" rather than "opportunity to continue working." The background agents completing didn't trigger any action because I wasn't polling or actively checking.

### 4. Failed to Use Self-Continuation

I had explicit commitments to the user about what I would do next. I should have either:
- Kept the conversation active with periodic checks
- Used foreground agents (sequential) to ensure continuation
- At minimum, left a clear "I'm waiting for X" message so idle time was obvious

## What I Should Have Done

### Option A: Foreground Agents with Sequential Processing
```
Instead of 3 background agents running in parallel,
run them sequentially in foreground, then immediately
continue with integration/testing work.
```
**Tradeoff:** Slower initial completion, but guaranteed continuation.

### Option B: Polling Pattern
```
After launching background agents:
1. Wait 5 minutes
2. Check TaskOutput for each agent
3. If all complete → proceed with next steps
4. If not complete → wait another 5 minutes, repeat
```
**Implementation:** Use the Bash tool with `sleep 300 && echo "check"` or similar.

### Option C: Explicit Handoff Message
```
"I've launched 3 background agents. They should complete in ~10 minutes.
Since you're away, I'll check on them every 5 minutes and continue
with integration work as soon as they're done. If you return and
see no updates from me, something went wrong."
```
This at least makes the expectation explicit.

### What I Actually Did
Nothing. I said I'd continue but had no mechanism to actually do so.

## Recommendations for Future

### 1. Prefer Foreground for Continuation-Critical Work
If work MUST continue after agents finish, don't use background agents. Use sequential foreground processing. Background agents are for "fire and forget" tasks where completion timing doesn't matter.

### 2. If Using Background Agents, Set Up Explicit Polling
```
# Launch agents
<background agent 1>
<background agent 2>

# Immediately queue up a check
"I'll check on these in 5 minutes and proceed with next steps."
Then actually do it—don't just say it.
```

### 3. Communicate Async Work Expectations Clearly
Tell the user:
- What's running in background
- Expected completion time
- **What will happen when they complete** (and how)
- What to expect if they return before completion

### 4. Default to Pessimistic Assumptions
Assume that if I don't actively drive continuation, it won't happen. The system won't magically wake me up and make me productive.

### 5. Consider a "Continuation Checklist"
Before going async:
- [ ] What runs in background?
- [ ] What's my continuation trigger?
- [ ] How will I know when to continue?
- [ ] What if the trigger never fires?

## Lessons Learned

1. **Background agents are for parallelism, not for "I'll continue later."** They're useful when you want multiple things to run simultaneously, but you need an active mechanism to respond to their completion.

2. **Saying "I'll do X" is not the same as doing X.** I committed to continuation but built no mechanism to ensure it happened.

3. **Idle time should be suspicious.** 75 minutes of no activity after promising to continue work should have been a red flag—if I had any way to flag it.

4. **When the user is away, I should be MORE active, not less.** The whole point of async work is to be productive while they're gone.

## Action Items

- [x] Document background agent best practices in CLAUDE.md (added 2026-01-25)
- [x] Default to foreground agents when continuation is required (behavioral guideline documented)
- [x] Always include explicit polling mechanism when using background agents (documented with checklist)
- [x] Set clear expectations with users about async work behavior (communication template added)

---

*This post-mortem is intentionally direct about the failure. The goal is learning, not excuses.*
