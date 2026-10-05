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
 * \file Fsm.hpp
 * \brief Moore finite-state machine engine for C++ (header only).
 *
 * Every state has four routines, which are member functions of the owner:
 * - entry:      called once when the state is entered,
 * - execute:    called on every run while the machine is in the state,
 * - checkLeave: called on every run after execute, requests the next state,
 * - leave:      called once when the state is left.
 *
 * A routine that is not needed is nullptr. The engine does not use the heap,
 * the exceptions or the RTTI, and the table of the states is checked at the
 * compile time.
 */

#ifndef FSM_HPP
#define FSM_HPP

#include <array>
#include <cstddef>

namespace fsm
{

/**
 * \tparam Owner      The class whose member functions are the routines of the states.
 * \tparam StateId    The enumeration of the states, values 0 .. StateCount - 1.
 * \tparam StateCount The number of the states.
 */
template <typename Owner, typename StateId, std::size_t StateCount>
class StateMachine
{
public:
    using Routine = void (Owner::*)();

    /** The routines of one state. */
    struct StateRoutines
    {
        StateId state;      /**< The state, it has to be equal to the position in the table */
        Routine entry;      /**< Entry part of the state */
        Routine execute;    /**< Execute part of the state */
        Routine checkLeave; /**< Check leave part of the state */
        Routine leave;      /**< Leave part of the state */
    };

    using Table = std::array<StateRoutines, StateCount>;

    /** True if the line number N of the table belongs to the state N. Use it in a static_assert. */
    static constexpr bool IsTableValid(const Table& table) noexcept
    {
        for (std::size_t index = 0u; index < StateCount; ++index)
        {
            if (static_cast<std::size_t>(table[index].state) != index)
            {
                return false;
            }
        }
        return true;
    }

    /**
     * \param owner        The object whose routines are called.
     * \param table        The routines of the states, it has to outlive the machine.
     * \param defaultState The initial state, which is also the safe state for an invalid request.
     */
    constexpr StateMachine(Owner& owner, const Table& table, StateId defaultState) noexcept
        : owner(owner), table(table), defaultState(defaultState), actualState(defaultState), newState(defaultState)
    {
    }

    /** Sets the default state and runs its entry routine. */
    void Start() noexcept
    {
        actualState = defaultState;
        newState    = defaultState;
        Call(table[Index(actualState)].entry);
    }

    /** Runs the machine once. Call it periodically. */
    void Run() noexcept
    {
        /* A corrupted actual state must not index outside of the table: start again from the default state. */
        if (!IsValid(actualState))
        {
            Start();
        }

        Call(table[Index(actualState)].execute);
        Call(table[Index(actualState)].checkLeave);

        /* In case of an invalid request (made in checkLeave), switch to the default state. */
        if (!IsValid(newState))
        {
            newState = defaultState;
        }

        /* Leave and entry are executed only if the state has to be changed. */
        if (actualState != newState)
        {
            Call(table[Index(actualState)].leave);
            actualState = newState;
            Call(table[Index(actualState)].entry);
        }
    }

    /** Requests a new state. Call it from the checkLeave routines only. */
    void RequestState(StateId state) noexcept { newState = state; }

    StateId GetState() const noexcept { return actualState; }

private:
    static constexpr std::size_t Index(StateId state) noexcept { return static_cast<std::size_t>(state); }
    static constexpr bool IsValid(StateId state) noexcept { return Index(state) < StateCount; }

    void Call(Routine routine) noexcept
    {
        if (nullptr != routine)
        {
            (owner.*routine)();
        }
    }

    Owner&       owner;
    const Table& table;
    StateId      defaultState;
    StateId      actualState;
    StateId      newState;
};

}   // namespace fsm

#endif /* FSM_HPP */
