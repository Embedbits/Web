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
 * \file <Module>.cpp
 * \ingroup <module name> (reference to the software architecture, optional)
 * \brief <short description> (displayed in overview)
 * <Description about the purpose of this file>
 */

/* ============================= INCLUDES =================================== */
#include "<Module>.hpp"                         /* Self include               */

/* ========================= STATE TABLE ==================================== */

/**
 * Routines of the states. A routine that is not needed can be nullptr.
 * The line N has to belong to the state N, which is checked at the compile
 * time (see the constructor).
 */
constexpr <Module>::Machine::Table <Module>::MakeTable() noexcept
{
    return Machine::Table{{
        { State::State1, &<Module>::State1Entry, &<Module>::State1Execute, &<Module>::State1CheckLeave, &<Module>::State1Leave },
        { State::State2, &<Module>::State2Entry, &<Module>::State2Execute, &<Module>::State2CheckLeave, &<Module>::State2Leave },
        { State::State3, &<Module>::State3Entry, &<Module>::State3Execute, &<Module>::State3CheckLeave, &<Module>::State3Leave },
    }};
}

const <Module>::Machine::Table <Module>::table = <Module>::MakeTable();

/* ========================= EXPORTED FUNCTIONS ============================= */

<Module>::<Module>() noexcept
    : stateMachine(*this, table, State::State1)
{
    static_assert(Machine::IsTableValid(MakeTable()), "The line of the table does not belong to its state");
}

void <Module>::Init() noexcept
{
    stateMachine.Start();
}

void <Module>::Task() noexcept
{
    stateMachine.Run();
}

/*----------------------------------------------------------------------------*/
/*----------------------- Start of state machine functions -------------------*/
/*----------------------------------------------------------------------------*/

/**
 * \brief Entry of the state 1. Called once, when the state is entered.
 *
 * \par Used variables
 * - \ref var1 (in): <usage> (delete if not used)
 * - \ref var2 (out): <usage> (delete if not used)
 */
void <Module>::State1Entry()
{
    /* function body */
}

/** \brief Execute of the state 1. Called on every run in the state. */
void <Module>::State1Execute()
{
    /* function body */
}

/**
 * \brief CheckLeave of the state 1. Called on every run after Execute.
 *
 * The only place where a transition is requested: stateMachine.RequestState(State::State2).
 */
void <Module>::State1CheckLeave()
{
    /* function body */
}

/** \brief Leave of the state 1. Called once, when the state is left. */
void <Module>::State1Leave()
{
    /* function body */
}

/**
 * \brief Entry of the state 2. Called once, when the state is entered.
 *
 * \par Used variables
 * - \ref var1 (in): <usage> (delete if not used)
 * - \ref var2 (out): <usage> (delete if not used)
 */
void <Module>::State2Entry()
{
    /* function body */
}

/** \brief Execute of the state 2. Called on every run in the state. */
void <Module>::State2Execute()
{
    /* function body */
}

/**
 * \brief CheckLeave of the state 2. Called on every run after Execute.
 *
 * The only place where a transition is requested: stateMachine.RequestState(State::State2).
 */
void <Module>::State2CheckLeave()
{
    /* function body */
}

/** \brief Leave of the state 2. Called once, when the state is left. */
void <Module>::State2Leave()
{
    /* function body */
}

/**
 * \brief Entry of the state 3. Called once, when the state is entered.
 *
 * \par Used variables
 * - \ref var1 (in): <usage> (delete if not used)
 * - \ref var2 (out): <usage> (delete if not used)
 */
void <Module>::State3Entry()
{
    /* function body */
}

/** \brief Execute of the state 3. Called on every run in the state. */
void <Module>::State3Execute()
{
    /* function body */
}

/**
 * \brief CheckLeave of the state 3. Called on every run after Execute.
 *
 * The only place where a transition is requested: stateMachine.RequestState(State::State2).
 */
void <Module>::State3CheckLeave()
{
    /* function body */
}

/** \brief Leave of the state 3. Called once, when the state is left. */
void <Module>::State3Leave()
{
    /* function body */
}
