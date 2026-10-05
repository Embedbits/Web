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

But what the state represent? Imagine a light bulb which can be turned on and off by pressing a button. For handling of this behavior, our state machine would need only two states. One state which activates the actuator, and another state which this actuator deactivates.Really simple, isnt it? But what in complex systems? Well, you need a simple implementation which is applicable for varia

During my work at automotive industry, we have faced with my colleague [Jan Sima](https://www.linkedin.com/in/jano-sima/) the problems with Finite State Machines designs. There has been plenty of different styles but none of them had sufficient functionality to reach stability and clean design. So we decided to design own template. With permission of Jan, i am publishing the template of our Finite State Machine under MIT license.

```c
/*
 * Copyright (c) 2024 Marek Petrinec, Jan Sima
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 *
 */

/**
 * \file <name of file> (CAUTION file name is case sensitive! e.g. myCode.c)
 * \ingroup <module name> (reference to the software architecture, optional)
 * \brief <short description> (displayed in overview)
 * <Description about the purpose of this file>
 *
 */

/* ============================= INCLUDES =================================== */
#include "myDir\myHeader.h"                     /* Self include               */
/* ============================== TYPEDEFS ================================== */

/** Define the module specific states */
typedef enum
{
    <MODULE>_STATE_1 = 0u, /**< Description state 1 */
    <MODULE>_STATE_2,      /**< Description state 2 */
    <MODULE>_STATE_3       /**< Description state 3 */
}   <module>_SM_States_t;

/** Function pointer datatype to be used for the entry, execution and checkLeave routines
 *  used by the state machine  */
typedef void (*<module>_SM_PtrToRoutine_t)(void);


/** Structure data type that integrates the function pointers to entry,
 *  execution and checkLeave routines of one state. */
typedef struct
{
    <module>_SM_PtrToRoutine_t entry;      /**< Entry part of state */
    <module>_SM_PtrToRoutine_t execute;    /**< Execute part of state */
    <module>_SM_PtrToRoutine_t checkLeave; /**< Check leave part of state */
	  <module>_SM_PtrToRoutine_t leave;      /**< Leave part of state */
}   <module>_SM_Routines_t;


/** Structure data type that links the function pointers of entry,
 *  execute and checkLeave routines to its specific state */
typedef struct
{
    <module>_SM_States_t   state;   /**< State ID (name) */
    <module>_SM_Routines_t routine; /**< Routines list for current state ID */
}   <module>_SM_StateLinkedRoutines_t;

/* ======================== FORWARD DECLARATIONS ============================ */

/* State machine transition handler */
static void <Module>_HandleStateTransition(void);

/* Short description of state */
static void <Module>_State_1_Entry(void);
static void <Module>_State_1_Execute(void);
static void <Module>_State_1_CheckLeave(void);
static void <Module>_State_1_Leave(void);

/* Short description of state */
static void <Module>_State_2_Entry(void);
static void <Module>_State_2_Execute(void);
static void <Module>_State_2_CheckLeave(void);
static void <Module>_State_2_Leave(void);

/* Short description of state */
static void <Module>_State_3_Entry(void);
static void <Module>_State_3_Execute(void);
static void <Module>_State_3_CheckLeave(void);
static void <Module>_State_3_Leave(void);


/* ========================== SYMBOLIC CONSTANTS ============================ */

/* =============================== MACROS =================================== */

/* ========================== EXPORTED VARIABLES ============================ */

/* =========================== LOCAL VARIABLES ============================== */

/** holds the current state of the state machine */
static <module>_SM_States_t       <module>_SM_ActualState
                                            = <MODULE>_STATE_1;

/** holds the desired next state */
static <module>_SM_States_t       <module>_SM_NewState
                                            = <MODULE>_STATE_1;

/* ========================= EXPORTED FUNCTIONS ============================= */

/**
 * \brief Initialization of Moore Finite-State Machine
 *
 * <Detailed description>
 *
 * \pre <Needed preconditions> (optional)
 *
 * \par Used global variables
 * - \ref <module>_SM_NewState               (out): State machine new state request variable.
 * - \ref <module>_SM_ActualState            (out): State machine actual state variable.
 *
 * \return void
 */
void <Module>_Init(void)
{
    <module>_SM_ActualState = <MODULE>_STATE_1;
    <module>_SM_NewState    = <MODULE>_STATE_1;
}

/* ================================ TASKS =================================== */

/**
 * \brief Task callback
 *
 * <Detailed description>
 *
 * \pre <Needed preconditions> (optional)
 *
 * \par Used global variables
 * - \ref <module>_SM_NewState               (out): State machine new state request variable.
 * - \ref <module>_SM_ActualState            (out): State machine actual state variable.
 *
 * \return void
 */
void <Module>_Task(void)
{

}

/* =========================== LOCAL FUNCTIONS ============================== */

/**
 * \brief Finite-State Machine - cyclic run function
 *
 * <Detailed description: Function is running in 100ms task >
 *
 * INFO: The state machine must contain only state machine code! Inside of the
 *       state machine no check/specific function has to be implemented. This
 *       has to be done in Execute or CheckLeave function.
 *       Entry function has to be used only for preparing the states for actually
 *       set new function.
 *
 * \pre <Needed preconditions> (optional)
 *
 * \par Used global variables
 * - \ref <module>_SM_NewState    (in,out): State machine new state request variable.
 * - \ref <module>_SM_ActualState (in,out): State machine actual state variable.
 *
 * \return void
 */
static void <Module>_HandleStateTransition(void)
{
    /* This array must have the same order as the state enum! */
    static const <module>_SM_StateLinkedRoutines_t stateRoutines [] =
    {
        { <MODULE>_STATE_1,
            { <Module>_State_1_Entry,
              <Module>_State_1_Execute,
              <Module>_State_1_CheckLeave,
              <Module>_State_1_Leave       }  },

        { <MODULE>_STATE_2,
            { <Module>_State_2_Entry,
              <Module>_State_2_Execute,
              <Module>_State_2_CheckLeave,
              <Module>_State_2_Leave       }  },

        { <MODULE>_STATE_3,
            { <Module>_State_3_Entry,
              <Module>_State_3_Execute,
              <Module>_State_3_CheckLeave,
              <Module>_State_3_Leave       }  }
    };

    /* Check if the state is in valid range of available modes, if no set the default/error state. */
    if( <MODULE>_STATE_3 < <module>_SM_NewState )
    {
        /* In case of an invalid input status, switch to default/error state. */
        <module>_SM_NewState = <MODULE>_STATE_1;
    }
    else
    {
        /* Requested state is in valid range */
    }

    /* Execute function shall be used for main execution of actual state */
    stateRoutines[<module>_SM_ActualState].routine.execute();

    /* CheckLeave function shall be used for check leave condition of actual state */
    stateRoutines[<module>_SM_ActualState].routine.checkLeave();

    /* Entry function shall be executed only in case if the state has to be changed to another state */
    if (<module>_SM_ActualState != <module>_SM_NewState)
    {
        stateRoutines[<module>_SM_ActualState].routine.leave();

        <module>_SM_ActualState = <module>_SM_NewState;

        stateRoutines[<module>_SM_ActualState].routine.entry();
    }
    else
    {
        /* No new state required */
    }
}

/*----------------------------------------------------------------------------*/
/*----------------------- Start of state machine functions -------------------*/
/*----------------------------------------------------------------------------*/

/**
 * \brief <Short description> (optional)
 *
 * <Detailed description>
 *
 * \pre <Needed preconditions> (optional)
 *
 *
 * \par Used global variables
 * - \ref var1 (in): <usage> (delete if not used)
 * - \ref var2 (out): <usage> (delete if not used)
 * - \ref var3 (in,out): <usage> (delete if not used)
 *
 */
static void <Module>_State_1_Entry(void)
{
    /* function body */
}


/**
 * \brief <Short description> (optional)
 *
 * <Detailed description>
 *
 * \pre <Needed preconditions> (optional)
 *
 *
 * \par Used global variables
 * - \ref var1 (in): <usage> (delete if not used)
 * - \ref var2 (out): <usage> (delete if not used)
 * - \ref var3 (in,out): <usage> (delete if not used)
 *
 */
static void <Module>_State_1_Execute(void)
{
    /* function body */
}


 /**
 * \brief <Short description> (optional)
 *
 * <Detailed description>
 *
 * \pre <Needed preconditions> (optional)
 *
 *
 * \par Used global variables
 * - \ref var1 (in): <usage> (delete if not used)
 * - \ref var2 (out): <usage> (delete if not used)
 * - \ref var3 (in,out): <usage> (delete if not used)
 *
 */
static void <Module>_State_1_CheckLeave(void)
{
    /* function body */
}


 /**
 * \brief <Short description> (optional)
 *
 * <Detailed description>
 *
 * \pre <Needed preconditions> (optional)
 *
 *
 * \par Used global variables
 * - \ref var1 (in): <usage> (delete if not used)
 * - \ref var2 (out): <usage> (delete if not used)
 * - \ref var3 (in,out): <usage> (delete if not used)
 *
 */
static void <Module>_State_1_Leave(void)
{
    /* function body */
}
```
