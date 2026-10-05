---
title: "Finite state machines"
slug: finite-state-machines
date: 2024-09-29T16:24:40
authors: [Mr.Nobody]
tags: [embedded]
image: /img/blog/fsm-state-machine.png
---

For embedded software development is propper design necessary. Microcontroller has to handle processing of application itself and communication with plenty of connected circuits through internal or external peripherals. The execution of application shall be as fast as possible. But that is really terrible explanation for anyone. In real world, the developer has to ensure optimal short logical path of code execution. Which means, that developer shall not check all the conditions during each main cycle. The one way of this optimization, is to correct nesting of conditions. This can be really difficult with increasing complexity of project. A lot of nested conditional statements can lead to unstability of code and making code less readable. The code readability is cruel necessary for future updates, or for maintenance of existing code. One of my beloved quote says:

<!-- truncate -->

![Excerpt of a state machine routine table in C](/img/blog/fsm-state-machine.png)

> **Always code as if the guy, who end up maintaining your code will be a violent psychopath who knows where you live.**

So we should better think before writing actual code. This process is called “design” and i really like it. Because if you do it right, the amount of new code and subsequent editation of this new code is really reduced. Sometimes you could think it take so much time, but in reality, is this time summed with time of writing code shorter than writing code which will be continuously rewritten. But how to make it easier? Here we can start to talk about Finite State Machines also known as FSM.

So lets start with AI generated meaningless description:

> State machines, particularly Mealy and Moore machines, are fundamental models in the design of digital systems and computational theory. Both of these machines are used to represent systems that transition between different states based on inputs and produce outputs as a result. However, the way they handle output generation is what sets them apart.
>
>
>
>
>
>
>
> A **Mealy machine** produces outputs based on both the **current state** and the **current input**. This makes Mealy machines more responsive, as the output can change dynamically with each input signal.
>
>
>
>
>
>
>
> On the other hand, a **Moore machine** generates outputs solely based on its **current state**, independent of the input. This makes Moore machines simpler and more predictable, as the output remains constant until the state changes.
>
>
>
>
>
>
>
> These state machines are widely used in embedded systems, control systems, and digital circuits where precise state transitions and outputs are critical. In this blog, we’ll explore how Mealy and Moore machines function, their key differences, and how they can be applied in practical system design.

But what does it mean? In simple way, the Mealy finite stae machine is checking the conditions for required state ***before*** the actual state execution. The Moore state machine is checking the conditions ***after*** the actual state execution.

But what the state represent? Imagine a light bulb which can be turned on and off by pressing a button. For handling of this behavior, our state machine would need only two states. One state which activates the actuator, and another state which this actuator deactivates.Really simple, isnt it? But what in complex systems? Well, you need a simple implementation which is applicable for various situations. That is what the template below does.

During my work at automotive industry, we have faced with my colleague [Jan Sima](https://www.linkedin.com/in/jano-sima/) the problems with Finite State Machines designs. There has been plenty of different styles but none of them had sufficient functionality to reach stability and clean design. So we decided to design own template. With permission of Jan, i am publishing the template of our Finite State Machine under MIT license.


## Download the template

The template is published under the MIT license. Everything is plain text, so you can read it before you download it:

| File | What it is |
| --- | --- |
| [FsmTemplate.c](pathname:///Web/downloads/fsm/FsmTemplate.c) | The template in **C** (C99), one file with the states, the table of the routines and the stubs |
| [FsmTemplate.hpp](pathname:///Web/downloads/fsm/FsmTemplate.hpp) and [FsmTemplate.cpp](pathname:///Web/downloads/fsm/FsmTemplate.cpp) | The template in **C++** (C++17), a class with one state machine inside |
| [Fsm.hpp](pathname:///Web/downloads/fsm/Fsm.hpp) | The header-only engine for the C++ version (no heap, no exceptions, no RTTI) |
| [fsm-instantiate.sh](pathname:///Web/downloads/fsm/fsm-instantiate.sh) | A small script that replaces the names, `fsm-instantiate.sh Button FsmTemplate.c src/` creates `src/Button.c` |

The names in angle brackets are replaced by the name of your module: `<Module>` becomes `Button`, `<module>` becomes `button` and `<MODULE>` becomes `BUTTON`.

## How it works

It is a Moore machine. Every state has four routines and the machine calls them in the same order on every run:

1. **Entry**: called once, when the state is entered.
2. **Execute**: called on every run, here is the work of the state.
3. **CheckLeave**: called on every run after Execute. This is the **only** place where a new state is requested.
4. **Leave**: called once, when the state is left.

The whole engine is one function. This is the C version:

```c
static void <Module>_HandleStateTransition(void)
{
    /* A corrupted actual state must not index outside of the table: start again from the default state. */
    if (<MODULE>_STATE_COUNT <= <module>_SM_ActualState)
    {
        <module>_SM_ActualState = <MODULE>_STATE_1;
        <module>_SM_NewState    = <MODULE>_STATE_1;

        <Module>_CallRoutine(<module>_SM_StateRoutines[<module>_SM_ActualState].entry);
    }
    else
    {
        /* Actual state is in the valid range */
    }

    /* Execute function shall be used for main execution of actual state */
    <Module>_CallRoutine(<module>_SM_StateRoutines[<module>_SM_ActualState].execute);

    /* CheckLeave function shall be used for check leave condition of actual state */
    <Module>_CallRoutine(<module>_SM_StateRoutines[<module>_SM_ActualState].checkLeave);

    /* In case of an invalid request (made in checkLeave), switch to the default/error state. */
    if (<MODULE>_STATE_COUNT <= <module>_SM_NewState)
    {
        <module>_SM_NewState = <MODULE>_STATE_1;
    }
    else
    {
        /* Requested state is in the valid range */
    }

    /* Leave and entry functions shall be executed only in case if the state has to be changed to another state */
    if (<module>_SM_ActualState != <module>_SM_NewState)
    {
        <Module>_CallRoutine(<module>_SM_StateRoutines[<module>_SM_ActualState].leave);

        <module>_SM_ActualState = <module>_SM_NewState;

        <Module>_CallRoutine(<module>_SM_StateRoutines[<module>_SM_ActualState].entry);
    }
    else
    {
        /* No new state required */
    }
}
```

Because a transition is requested only in `CheckLeave`, the entry and the leave of a state are executed always as a pair, in a known order, and the outputs depend only on the state. A routine that is not needed can be `NULL` (`nullptr` in C++) and it is skipped.

## What was fixed

The first version of the template that I published here had a few mistakes. I went through it again, built it and ran it against a test that records the order of the calls. These are the changes:

- The initial value of the state variables was a leftover name from another project (`APPCORE_HANDLER_STATE_1` instead of `<MODULE>_STATE_1`).
- The last row of the table used `State_2_Leave` instead of `State_3_Leave`. The code compiled and called the wrong routine when the third state was left. The table is now indexed by the state (`[<MODULE>_STATE_3] = { ... }`), so the position of a row cannot be confused.
- `Init` did not run the entry routine of the first state.
- The state numbers were not checked. A corrupted actual state or a request of a nonexistent state indexed outside of the table. Both are checked now and the machine falls back to the first state, which is the safe one. The request is checked **after** `CheckLeave`, because that is the place where it is made. My first fix of this checked it before, and the test caught that, which is a nice proof of why such a test is worth it.
- A routine with the `NULL` pointer is skipped instead of crashing.
- A missing forward declaration, and a header comment that turned into nonsense after the names were replaced.

## The C++ version

In C++ the same pattern is a class. The state is an `enum class`, the routines are private member functions and the table is `constexpr`:

```cpp
class Button
{
public:
    enum class State : std::uint8_t { Idle = 0u, Pressed, Count };

    void Init() noexcept;
    void Task() noexcept;
    State GetState() const noexcept { return stateMachine.GetState(); }

private:
    using Machine = fsm::StateMachine<Button, State, static_cast<std::size_t>(State::Count)>;

    void IdleEntry();   void IdleExecute();   void IdleCheckLeave();   void IdleLeave();
    void PressedEntry(); /* ... */

    static constexpr Machine::Table MakeTable() noexcept;
    static const Machine::Table table;
    Machine stateMachine;
};
```

A request is `stateMachine.RequestState(State::Pressed)` in a `CheckLeave` routine. The row of the table has to belong to its state, and this is checked at **compile time** with a `static_assert`, so the mistake from the first version cannot even be built. There is no heap, no exception and no RTTI, so it fits the usual embedded and MISRA-like restrictions. The C++ version was compiled with `-Wall -Wextra -Wconversion -pedantic -fno-exceptions -fno-rtti` and ran under the address and undefined behavior sanitizers with the same scenarios as the C version: the order of the calls, a request, an invalid request, a corrupted state and the skipped `NULL` routines.

The second part of this series, [a button with debounce and long press](/blog/fsm-in-practice-button), shows the template in a real module.

## License

```text
Copyright (c) 2024 Marek Petrinec, Jan Sima

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
