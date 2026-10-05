---
title: "Finite state machines in practice: a button with debounce and long press"
slug: fsm-in-practice-button
date: 2026-10-06T10:00:00
authors: [Mr.Nobody]
tags: [embedded, c, architecture]
---

In the [first article about finite state machines](/blog/finite-state-machines) I gave you the template and ended with "to be continued". This is the continuation, and the best way to continue a theory is a problem. I chose the one that every embedded project has and that nobody gets right on the first try: **a push button**.

A button looks trivial: a pin, high or low. But a mechanical contact *bounces*, so the pin does 1 0 1 1 0 1 before it settles, and the product usually wants two different things from the same button: a short press and a long press. Written with flags and counters in the main loop, it ends as a few `if`s that depend on each other in a way that nobody can explain after a month. A state machine solves it in a way that you can explain with a table.

<!-- truncate -->

## The template in one paragraph

Every state has four routines, and each of them has exactly one job:

| Routine | Called | Job |
|---|---|---|
| `Entry` | once, when the state is entered | prepare the state (clear the counter, create an event) |
| `Execute` | on every run of the machine, while it is in the state | do the work of the state (count, sample) |
| `CheckLeave` | on every run, after `Execute` | decide whether to leave and where to: **the only place where a transition is requested** |
| `Leave` | once, when the state is left | clean up |

The core of the machine runs `Execute` and `CheckLeave` of the actual state, and when the state changed, runs `Leave` of the old one and `Entry` of the new one. The routines never call each other and the code of the state machine contains nothing but the state machine. If you want to know why the device is in a state, you read `CheckLeave` of the previous one.

## Design first: the states and the transitions

The task runs every 10 ms and reads the raw contact. The debounce time is 50 ms and the limit of a long press is 1 second. Five states are enough:

| State | Execute | Leaves when | To |
|---|---|---|---|
| `RELEASED` | nothing | the contact is closed | `DEBOUNCE_PRESS` |
| `DEBOUNCE_PRESS` | counts the ticks | the contact opens again (it was a glitch) | `RELEASED` |
| | | the contact was closed for 50 ms | `PRESSED` |
| `PRESSED` | counts the ticks | the contact opens: **short press** event | `DEBOUNCE_RELEASE` |
| | | the contact is closed for 1 s | `LONG_PRESS` |
| `LONG_PRESS` | nothing, the **long press** event was created on the entry | the contact opens | `DEBOUNCE_RELEASE` |
| `DEBOUNCE_RELEASE` | counts the ticks of an open contact, a bounce resets the count | the contact was open for 50 ms | `RELEASED` |

Writing the table is the real work. When it is complete, the code is only a typing exercise. When it is not (what happens in the `LONG_PRESS` when the contact bounces on the release?), the table shows the hole before you write a line of C.

## The code

The input comes from the BSP, so the module has no hardware dependency and can be tested on a PC (the same *seam* as in the article about [unit testing](/blog/unit-testing-unity-cmock)). The port of the module is an `Init`, a `Task` and a function that returns the event once:

```c title="Button_Port.h"
#ifndef BUTTON_BUTTON_PORT_H
#define BUTTON_BUTTON_PORT_H

typedef enum
{
    BUTTON_EVENT_NONE = 0u,
    BUTTON_EVENT_SHORT_PRESS,
    BUTTON_EVENT_LONG_PRESS
}   button_Event_t;

void           Button_Init(void);
void           Button_Task(void);          /* call it every 10 ms */
button_Event_t Button_Get_Event(void);     /* returns the event once and clears it */

#endif
```

The types follow the template. There is one change that I made on purpose: the table of the routines is **indexed by the state** and not searched, and the enumeration ends with `BUTTON_STATE_COUNT`, which has two uses.

```c title="Button.c"
typedef enum
{
    BUTTON_STATE_RELEASED = 0u,    /**< Contact open, waiting for a press      */
    BUTTON_STATE_DEBOUNCE_PRESS,   /**< Contact closed, is it stable?          */
    BUTTON_STATE_PRESSED,          /**< Stable press, short or long?           */
    BUTTON_STATE_LONG_PRESS,       /**< Held longer than the limit             */
    BUTTON_STATE_DEBOUNCE_RELEASE, /**< Contact open again, is it stable?      */
    BUTTON_STATE_COUNT             /**< Number of the states, keep it the last */
}   button_SM_States_t;

typedef void (*button_SM_PtrToRoutine_t)(void);

typedef struct
{
    button_SM_PtrToRoutine_t entry;
    button_SM_PtrToRoutine_t execute;
    button_SM_PtrToRoutine_t checkLeave;
    button_SM_PtrToRoutine_t leave;
}   button_SM_Routines_t;
```

The first use is the table itself. With the designated initializers the position of a line does not matter, so a state cannot be linked to the wrong routines when someone adds a line in the middle (the template needs the comment "this array must have the same order as the state enum"):

```c title="Button.c"
/* The table is indexed by the state, so the order of the lines does not matter. */
static const button_SM_Routines_t stateRoutines[BUTTON_STATE_COUNT] =
{
    [BUTTON_STATE_RELEASED]         = { Button_Released_Entry,        Button_Released_Execute,
                                        Button_Released_CheckLeave,   Button_Released_Leave        },
    [BUTTON_STATE_DEBOUNCE_PRESS]   = { Button_DebouncePress_Entry,   Button_DebouncePress_Execute,
                                        Button_DebouncePress_CheckLeave, Button_DebouncePress_Leave },
    [BUTTON_STATE_PRESSED]          = { Button_Pressed_Entry,         Button_Pressed_Execute,
                                        Button_Pressed_CheckLeave,    Button_Pressed_Leave         },
    [BUTTON_STATE_LONG_PRESS]       = { Button_LongPress_Entry,       Button_LongPress_Execute,
                                        Button_LongPress_CheckLeave,  Button_LongPress_Leave       },
    [BUTTON_STATE_DEBOUNCE_RELEASE] = { Button_DebounceRelease_Entry, Button_DebounceRelease_Execute,
                                        Button_DebounceRelease_CheckLeave, Button_DebounceRelease_Leave },
};
```

The second use is the core of the machine, in which the same constant replaces a hard-coded "last state" in the check of the range:

```c title="Button.c"
static void Button_HandleStateTransition(void)
{
    if (BUTTON_STATE_COUNT <= newState)
    {
        newState = BUTTON_STATE_RELEASED;      /* invalid request: go to the safe state */
    }

    stateRoutines[actualState].execute();
    stateRoutines[actualState].checkLeave();

    if (actualState != newState)
    {
        stateRoutines[actualState].leave();
        actualState = newState;
        stateRoutines[actualState].entry();
    }
}
```

Look at what the core does *not* know: the buttons, the time, the events. Now the states. Most of the routines are one-liners:

```c title="Button.c"
/* ---- RELEASED ---- */
static void Button_Released_Entry(void)      { stateTicks = 0u; }
static void Button_Released_Execute(void)    { }
static void Button_Released_CheckLeave(void) { if (isContactClosed) { newState = BUTTON_STATE_DEBOUNCE_PRESS; } }
static void Button_Released_Leave(void)      { }

/* ---- DEBOUNCE_PRESS: closed, but is it only a bounce? ---- */
static void Button_DebouncePress_Entry(void)      { stateTicks = 0u; }
static void Button_DebouncePress_Execute(void)    { stateTicks++; }
static void Button_DebouncePress_CheckLeave(void)
{
    if (!isContactClosed)
    {
        newState = BUTTON_STATE_RELEASED;               /* a glitch, nothing happened */
    }
    else if (BUTTON_DEBOUNCE_TICKS <= stateTicks)
    {
        newState = BUTTON_STATE_PRESSED;
    }
}
static void Button_DebouncePress_Leave(void)      { }

/* ---- PRESSED: a short press if released early, a long one if held ---- */
static void Button_Pressed_Entry(void)      { stateTicks = 0u; }
static void Button_Pressed_Execute(void)    { stateTicks++; }
static void Button_Pressed_CheckLeave(void)
{
    if (!isContactClosed)
    {
        pendingEvent = BUTTON_EVENT_SHORT_PRESS;
        newState     = BUTTON_STATE_DEBOUNCE_RELEASE;
    }
    else if (BUTTON_LONG_PRESS_TICKS <= stateTicks)
    {
        newState = BUTTON_STATE_LONG_PRESS;
    }
}
static void Button_Pressed_Leave(void)      { }

/* ---- LONG_PRESS: the event is created once, on the entry ---- */
static void Button_LongPress_Entry(void)      { pendingEvent = BUTTON_EVENT_LONG_PRESS; }
static void Button_LongPress_Execute(void)    { }
static void Button_LongPress_CheckLeave(void) { if (!isContactClosed) { newState = BUTTON_STATE_DEBOUNCE_RELEASE; } }
static void Button_LongPress_Leave(void)      { }

/* ---- DEBOUNCE_RELEASE: open, has to stay open for the debounce time ---- */
static void Button_DebounceRelease_Entry(void)      { stateTicks = 0u; }
static void Button_DebounceRelease_Execute(void)    { stateTicks = isContactClosed ? 0u : (uint16_t)(stateTicks + 1u); }
static void Button_DebounceRelease_CheckLeave(void) { if (BUTTON_DEBOUNCE_TICKS <= stateTicks) { newState = BUTTON_STATE_RELEASED; } }
static void Button_DebounceRelease_Leave(void)      { }
```

Some details that are worth a look:

- `Button_Task()` reads the input **once** per run and keeps it in `isContactClosed`. All routines of one run see the same value, even if the pin changes in the middle of the run.
- The short press event is created in `Button_Pressed_CheckLeave()`, in the same place where the decision is made. The long press event is created in `Button_LongPress_Entry()`: the entry is called exactly once per transition, so the event cannot be created twice, whatever the contact does while the button is held.
- The debounce of the release (`DEBOUNCE_RELEASE`) resets its counter whenever the contact is closed again. This is the answer to the bounce on the release: the machine waits until the contact is quiet for 50 ms.

## The test

The test replaces `Bsp_Get_ButtonRaw()` by a function that reads a string: one character per 10 ms tick, `1` is the closed contact. The patterns are the story of the button, and the result is the string of the events, `S` for a short press and `L` for a long one:

```c title="test_Button.c"
/* The fake input: one character per 10 ms tick, '1' = contact closed. */
static const char *inputPattern;
static size_t      inputIndex;

bool Bsp_Get_ButtonRaw(void)
{
    const char symbol = inputPattern[inputIndex];
    if ('\0' != symbol) { inputIndex++; }
    return ('1' == symbol);
}

/* Runs the machine over the whole pattern and returns the events as a string, S = short, L = long. */
static const char *Run(const char *pattern)
{
    static char events[16];
    size_t count = 0u;

    inputPattern = pattern;
    inputIndex   = 0u;
    memset(events, 0, sizeof events);
    Button_Init();

    for (size_t tick = 0u; tick < strlen(pattern) + 20u; tick++)   /* 20 extra ticks of an open contact */
    {
        Button_Task();
        const button_Event_t event = Button_Get_Event();
        if (BUTTON_EVENT_SHORT_PRESS == event) { events[count++] = 'S'; }
        if (BUTTON_EVENT_LONG_PRESS  == event) { events[count++] = 'L'; }
    }
    return events;
}

static void Expect(const char *name, const char *pattern, const char *expected)
{
    const char *result = Run(pattern);
    printf("%-34s -> %s\n", name, ('\0' == result[0]) ? "(no event)" : result);
    assert(0 == strcmp(expected, result));
}

int main(void)
{
    char longHold[220];

    Expect("nothing happens",                 "0000000000",                              "");
    Expect("a 20 ms glitch",                  "0011000000",                              "");
    Expect("a clean 200 ms press",            "00111111111111111111110000000000",        "S");
    Expect("a press with a bouncing contact", "0101101111111111111111011010000000000",   "S");
    Expect("a bounce on the release",         "001111111111111111111101001000000000",    "S");

    memset(longHold, '1', 150u); longHold[150] = '\0';       /* 1.5 s */
    Expect("a 1.5 s hold",                    longHold,                                  "L");

    memset(longHold, '1', 99u);  longHold[99] = '\0';        /* just under the limit (+ debounce) */
    Expect("a 0.99 s hold",                   longHold,                                  "S");

    puts("all state machine tests passed");
    return 0;
}
```

The output of the run is the real one:

```text
nothing happens                    -> (no event)
a 20 ms glitch                     -> (no event)
a clean 200 ms press               -> S
a press with a bouncing contact    -> S
a bounce on the release            -> S
a 1.5 s hold                       -> L
a 0.99 s hold                      -> S
all state machine tests passed
```

The two last lines are the case that the flags always get wrong. A 1.5 second hold produces **one** long press and no short press after the release, and a hold just under the limit is a short press. Both are a consequence of the table and not of the careful programming.

## What you get, and what it costs

**You get:**

- a **readable specification**: the table above and the code are the same thing,
- the **guarantee of the once**: `Entry` and `Leave` run once per transition, the events are not duplicated,
- a **place for everything**: a new requirement (a double click) is a new state or a new row in the table, and not an edit of three nested conditions,
- a **machine that can be tested on a PC** with a string as the input, as you have just seen.

**It costs:**

- the **boilerplate**: four functions per state, most of them empty. It is a price for the uniformity, and it pays off with the 5th state. For a machine with two states, a `switch` is better,
- the **table of the transitions has to be thought through** before you write code. That is not a cost, but it feels like one at the beginning.

## Pitfalls

1. **Time belongs to the task period, not to a delay.** The machine counts the runs, so the limits (50 ms, 1 s) are the numbers of the ticks. Never call a delay in a state, it blocks all the other machines.
2. **Sample in the task, not in the interrupt.** The interrupt of the pin would see every bounce. The task that runs every 10 ms is a low-pass filter for free.
3. **A single event slot loses events** if the application reads it slower than the machine produces it. For a button it does not matter, for a protocol it does: use a queue.
4. **The invalid state is a state.** The check of the range in the core sends a corrupted variable to the safe state instead of reading the table outside of its bounds (the MISRA rules about the [undefined behavior](/blog/misra-c-rules-in-practice) apply here).
5. **A state machine with 30 states is a sign of a missing hierarchy.** Split it into several machines, where one is a *state* of another, and keep every one of them small enough to fit into a table on a single screen.

## Corrections in the template

When I compared the example with the template from the first article, I found two slips in the template and I fixed them there (a later review of the template found more, see [the list of the fixes](/blog/finite-state-machines#what-was-fixed)): the initial value of the state variables was a leftover name from another project (`APPCORE_HANDLER_STATE_1` instead of `<MODULE>_STATE_1`), and the last row of the table used `State_2_Leave` instead of `State_3_Leave`. The second one is the type of a bug that this article is about: the code compiles, and the machine calls the wrong routine on the exit of the third state. The table with the designated initializers makes it a bit harder to do, and a test that goes through all the states makes it impossible.
