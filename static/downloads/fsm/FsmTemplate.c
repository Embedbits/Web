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
 * \file <Module>.c (CAUTION file name is case sensitive! e.g. myCode.c)
 * \ingroup <module name> (reference to the software architecture, optional)
 * \brief <short description> (displayed in overview)
 * <Description about the purpose of this file>
 *
 * Moore finite-state machine. Every state has four routines:
 * - Entry:      called once when the state is entered,
 * - Execute:    called on every run while the machine is in the state,
 * - CheckLeave: called on every run after Execute, requests the next state,
 * - Leave:      called once when the state is left.
 *
 * To use the template: replace the names in angle brackets (the script
 * fsm-instantiate.sh does it for the name of the module), add states to the
 * enumeration and to the table, and write the routines of the states.
 */

/* ============================= INCLUDES =================================== */
#include <stddef.h>
#include "<Module>.h"                           /* Self include               */
/* ============================== TYPEDEFS ================================== */

/** Define the module specific states */
typedef enum
{
    <MODULE>_STATE_1 = 0u, /**< Description state 1 (the default and the safe state) */
    <MODULE>_STATE_2,      /**< Description state 2 */
    <MODULE>_STATE_3,      /**< Description state 3 */
    <MODULE>_STATE_COUNT   /**< Number of the states, keep it the last one */
}   <module>_SM_States_t;

/** Function pointer datatype to be used for the entry, execution, checkLeave
 *  and leave routines used by the state machine */
typedef void (*<module>_SM_PtrToRoutine_t)(void);


/** Structure data type that integrates the function pointers to entry,
 *  execute, checkLeave and leave routines of one state. A routine that is not
 *  needed can be NULL. */
typedef struct
{
    <module>_SM_PtrToRoutine_t entry;      /**< Entry part of state */
    <module>_SM_PtrToRoutine_t execute;    /**< Execute part of state */
    <module>_SM_PtrToRoutine_t checkLeave; /**< Check leave part of state */
    <module>_SM_PtrToRoutine_t leave;      /**< Leave part of state */
}   <module>_SM_Routines_t;

/* ======================== FORWARD DECLARATIONS ============================ */

/* State machine transition handler */
static void <Module>_HandleStateTransition(void);

/* Calls a routine of a state, if there is one */
static void <Module>_CallRoutine(<module>_SM_PtrToRoutine_t routine);

/* Short description of state 1 */
static void <Module>_State_1_Entry(void);
static void <Module>_State_1_Execute(void);
static void <Module>_State_1_CheckLeave(void);
static void <Module>_State_1_Leave(void);

/* Short description of state 2 */
static void <Module>_State_2_Entry(void);
static void <Module>_State_2_Execute(void);
static void <Module>_State_2_CheckLeave(void);
static void <Module>_State_2_Leave(void);

/* Short description of state 3 */
static void <Module>_State_3_Entry(void);
static void <Module>_State_3_Execute(void);
static void <Module>_State_3_CheckLeave(void);
static void <Module>_State_3_Leave(void);

/* ========================== SYMBOLIC CONSTANTS ============================ */

/* =============================== MACROS =================================== */

/* ========================== EXPORTED VARIABLES ============================ */

/* =========================== LOCAL VARIABLES ============================== */

/** holds the current state of the state machine */
static <module>_SM_States_t       <module>_SM_ActualState = <MODULE>_STATE_1;

/** holds the desired next state */
static <module>_SM_States_t       <module>_SM_NewState    = <MODULE>_STATE_1;

/**
 * Routines of the states. The table is indexed by the state, so the order of
 * the lines does not matter and a state cannot be linked to the routines of
 * another one.
 */
static const <module>_SM_Routines_t <module>_SM_StateRoutines[<MODULE>_STATE_COUNT] =
{
    [<MODULE>_STATE_1] = { <Module>_State_1_Entry,
                              <Module>_State_1_Execute,
                              <Module>_State_1_CheckLeave,
                              <Module>_State_1_Leave },
    [<MODULE>_STATE_2] = { <Module>_State_2_Entry,
                              <Module>_State_2_Execute,
                              <Module>_State_2_CheckLeave,
                              <Module>_State_2_Leave },
    [<MODULE>_STATE_3] = { <Module>_State_3_Entry,
                              <Module>_State_3_Execute,
                              <Module>_State_3_CheckLeave,
                              <Module>_State_3_Leave },
};

/* ========================= EXPORTED FUNCTIONS ============================= */

/**
 * \brief Initialization of Moore Finite-State Machine
 *
 * Sets the initial state and runs its entry routine.
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

    <Module>_CallRoutine(<module>_SM_StateRoutines[<module>_SM_ActualState].entry);
}

/* ================================ TASKS =================================== */

/**
 * \brief Task callback
 *
 * Runs the state machine once. Call it periodically, e.g. from a 100 ms task.
 *
 * \par Used global variables
 * - \ref <module>_SM_NewState    (in,out): State machine new state request variable.
 * - \ref <module>_SM_ActualState (in,out): State machine actual state variable.
 *
 * \return void
 */
void <Module>_Task(void)
{
    <Module>_HandleStateTransition();
}

/* =========================== LOCAL FUNCTIONS ============================== */

/**
 * \brief Calls a routine of a state, if there is one.
 *
 * \param routine [in]: The routine, or NULL.
 */
static void <Module>_CallRoutine(<module>_SM_PtrToRoutine_t routine)
{
    if (NULL != routine)
    {
        routine();
    }
}

/**
 * \brief Finite-State Machine - cyclic run function
 *
 * INFO: The state machine must contain only state machine code! Inside of the
 *       state machine no check/specific function has to be implemented. This
 *       has to be done in Execute or CheckLeave function.
 *       Entry function has to be used only for preparing the states for actually
 *       set new function.
 *
 * \par Used global variables
 * - \ref <module>_SM_NewState    (in,out): State machine new state request variable.
 * - \ref <module>_SM_ActualState (in,out): State machine actual state variable.
 *
 * \return void
 */
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

/*----------------------------------------------------------------------------*/
/*----------------------- Start of state machine functions -------------------*/
/*----------------------------------------------------------------------------*/

/**
 * \brief Entry of the state 1: <short description>
 *
 * Called once, when the state is entered. Prepare the state here (clear the
 * counters, set the outputs). The routine is optional, the table can contain NULL.
 *
 * \par Used global variables
 * - \ref var1 (in): <usage> (delete if not used)
 * - \ref var2 (out): <usage> (delete if not used)
 * - \ref var3 (in,out): <usage> (delete if not used)
 */
static void <Module>_State_1_Entry(void)
{
    /* function body */
}


/**
 * \brief Execute of the state 1
 *
 * Called on every run of the machine while the machine is in the state. The
 * work of the state is done here. Do not request a new state here.
 */
static void <Module>_State_1_Execute(void)
{
    /* function body */
}


/**
 * \brief CheckLeave of the state 1
 *
 * Called on every run of the machine after Execute. This is the only place
 * where a transition is requested, by setting <module>_SM_NewState.
 */
static void <Module>_State_1_CheckLeave(void)
{
    /* function body */
}


/**
 * \brief Leave of the state 1
 *
 * Called once, when the state is left, before the entry of the next state.
 */
static void <Module>_State_1_Leave(void)
{
    /* function body */
}

/**
 * \brief Entry of the state 2: <short description>
 *
 * Called once, when the state is entered. Prepare the state here (clear the
 * counters, set the outputs). The routine is optional, the table can contain NULL.
 *
 * \par Used global variables
 * - \ref var1 (in): <usage> (delete if not used)
 * - \ref var2 (out): <usage> (delete if not used)
 * - \ref var3 (in,out): <usage> (delete if not used)
 */
static void <Module>_State_2_Entry(void)
{
    /* function body */
}


/**
 * \brief Execute of the state 2
 *
 * Called on every run of the machine while the machine is in the state. The
 * work of the state is done here. Do not request a new state here.
 */
static void <Module>_State_2_Execute(void)
{
    /* function body */
}


/**
 * \brief CheckLeave of the state 2
 *
 * Called on every run of the machine after Execute. This is the only place
 * where a transition is requested, by setting <module>_SM_NewState.
 */
static void <Module>_State_2_CheckLeave(void)
{
    /* function body */
}


/**
 * \brief Leave of the state 2
 *
 * Called once, when the state is left, before the entry of the next state.
 */
static void <Module>_State_2_Leave(void)
{
    /* function body */
}

/**
 * \brief Entry of the state 3: <short description>
 *
 * Called once, when the state is entered. Prepare the state here (clear the
 * counters, set the outputs). The routine is optional, the table can contain NULL.
 *
 * \par Used global variables
 * - \ref var1 (in): <usage> (delete if not used)
 * - \ref var2 (out): <usage> (delete if not used)
 * - \ref var3 (in,out): <usage> (delete if not used)
 */
static void <Module>_State_3_Entry(void)
{
    /* function body */
}


/**
 * \brief Execute of the state 3
 *
 * Called on every run of the machine while the machine is in the state. The
 * work of the state is done here. Do not request a new state here.
 */
static void <Module>_State_3_Execute(void)
{
    /* function body */
}


/**
 * \brief CheckLeave of the state 3
 *
 * Called on every run of the machine after Execute. This is the only place
 * where a transition is requested, by setting <module>_SM_NewState.
 */
static void <Module>_State_3_CheckLeave(void)
{
    /* function body */
}


/**
 * \brief Leave of the state 3
 *
 * Called once, when the state is left, before the entry of the next state.
 */
static void <Module>_State_3_Leave(void)
{
    /* function body */
}
