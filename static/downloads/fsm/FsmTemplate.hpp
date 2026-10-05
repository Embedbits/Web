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
 * \file <Module>.hpp
 * \ingroup <module name> (reference to the software architecture, optional)
 * \brief <short description> (displayed in overview)
 *
 * Moore finite-state machine built on fsm::StateMachine (Fsm.hpp).
 *
 * To use the template: replace the names in angle brackets (the script
 * fsm-instantiate.sh does it for the name of the module), add states to the
 * enumeration and to the table in <Module>.cpp, and write the routines.
 */

#ifndef <MODULE>_HPP
#define <MODULE>_HPP

#include <cstddef>
#include <cstdint>

#include "Fsm.hpp"

class <Module>
{
public:
    /** The states of the module. */
    enum class State : std::uint8_t
    {
        State1 = 0u, /**< Description state 1 (the default and the safe state) */
        State2,      /**< Description state 2 */
        State3,      /**< Description state 3 */
        Count        /**< Number of the states, keep it the last one */
    };

    <Module>() noexcept;

    /** Sets the initial state and runs its entry routine. */
    void Init() noexcept;

    /** Runs the state machine once. Call it periodically, e.g. from a 100 ms task. */
    void Task() noexcept;

    State GetState() const noexcept { return stateMachine.GetState(); }

private:
    using Machine = fsm::StateMachine<<Module>, State, static_cast<std::size_t>(State::Count)>;

    /* Short description of state 1 */
    void State1Entry();
    void State1Execute();
    void State1CheckLeave();
    void State1Leave();

    /* Short description of state 2 */
    void State2Entry();
    void State2Execute();
    void State2CheckLeave();
    void State2Leave();

    /* Short description of state 3 */
    void State3Entry();
    void State3Execute();
    void State3CheckLeave();
    void State3Leave();

    static constexpr Machine::Table MakeTable() noexcept;

    static const Machine::Table table;   /**< The routines of the states */
    Machine stateMachine;
};

#endif /* <MODULE>_HPP */
