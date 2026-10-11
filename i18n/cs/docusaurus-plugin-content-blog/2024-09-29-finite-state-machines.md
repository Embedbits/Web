---
title: "Konečné automaty"
slug: finite-state-machines
date: 2024-09-29T16:24:40
authors: [Mr.Nobody]
tags: [embedded]
image: /img/blog/fsm-state-machine.png
---

Pro vývoj embedded softwaru je správný návrh nezbytný. Mikrokontrolér musí zvládat zpracování samotné aplikace i komunikaci s množstvím připojených obvodů přes interní či externí periferie. Provádění aplikace má být co nejrychlejší. To je ale pro kohokoli dost hrozné vysvětlení. V reálném světě musí vývojář zajistit optimálně krátkou logickou cestu provádění kódu. To znamená, že vývojář nemá v každém hlavním cyklu kontrolovat všechny podmínky. Jedním ze způsobů této optimalizace je správné vnořování podmínek. S rostoucí složitostí projektu to může být opravdu obtížné. Množství vnořených podmíněných příkazů může vést k nestabilitě kódu a zhoršit jeho čitelnost. Čitelnost kódu je přitom kruté nutná pro budoucí úpravy nebo údržbu existujícího kódu. Jeden z mých oblíbených citátů říká:

<!-- truncate -->

![Výřez tabulky rutin konečného automatu v jazyce C](/img/blog/fsm-state-machine.png)

> **Vždy programujte tak, jako by ten, kdo bude váš kód udržovat, byl násilnický psychopat, který ví, kde bydlíte.**

Měli bychom tedy raději přemýšlet, než napíšeme skutečný kód. Tomuto procesu se říká „návrh“ a já ho mám opravdu rád. Protože když ho uděláte správně, množství nového kódu a následných úprav tohoto nového kódu se výrazně sníží. Někdy si můžete myslet, že to zabere příliš času, ale ve skutečnosti je tento čas sečtený s časem psaní kódu kratší než psaní kódu, který se bude neustále přepisovat. Jak to ale usnadnit? Tady můžeme začít mluvit o konečných automatech (Finite State Machines), známých také jako FSM.

Začněme tedy popisem generovaným umělou inteligencí, který nic neříká:

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

Co to ale znamená? Jednoduše řečeno, Mealyho konečný automat kontroluje podmínky pro požadovaný stav ***před*** provedením aktuálního stavu. Mooreův automat kontroluje podmínky ***po*** provedení aktuálního stavu.

Co ale stav představuje? Představte si žárovku, kterou lze zapnout a vypnout stisknutím tlačítka. Pro obsluhu tohoto chování by náš automat potřeboval jen dva stavy. Jeden stav, který aktivuje akční člen, a druhý, který tento akční člen deaktivuje. Opravdu jednoduché, že? Ale co u složitých systémů? Inu, potřebujete jednoduchou implementaci použitelnou pro různé situace. To je přesně to, co dělá šablona níže.

Při práci v automobilovém průmyslu jsme se s kolegou [Janem Šimou](https://www.linkedin.com/in/jano-sima/) setkali s problémy při návrhu konečných automatů. Existovalo množství různých stylů, ale žádný z nich neměl dostatečnou funkčnost k dosažení stability a čistého návrhu. Rozhodli jsme se proto navrhnout vlastní šablonu. S Janovým svolením zveřejňuji šablonu našeho konečného automatu pod licencí MIT.


## Stažení šablony

Šablona je zveřejněna pod licencí MIT. Vše je čistý text, takže si ji můžete přečíst ještě před stažením:

| Soubor | Co to je |
| --- | --- |
| [FsmTemplate.c](pathname:///downloads/fsm/FsmTemplate.c) | Šablona v jazyce **C** (C99), jeden soubor se stavy, tabulkou rutin a zástupnými funkcemi |
| [FsmTemplate.hpp](pathname:///downloads/fsm/FsmTemplate.hpp) a [FsmTemplate.cpp](pathname:///downloads/fsm/FsmTemplate.cpp) | Šablona v jazyce **C++** (C++17), třída s jedním automatem uvnitř |
| [Fsm.hpp](pathname:///downloads/fsm/Fsm.hpp) | Header-only jádro pro verzi v C++ (bez haldy, bez výjimek, bez RTTI) |
| [fsm-instantiate.sh](pathname:///downloads/fsm/fsm-instantiate.sh) | Malý skript, který nahradí názvy, `fsm-instantiate.sh Button FsmTemplate.c src/` vytvoří `src/Button.c` |

Názvy ve špičatých závorkách se nahradí názvem vašeho modulu: `<Module>` se změní na `Button`, `<module>` na `button` a `<MODULE>` na `BUTTON`.

## Jak to funguje

Jde o Mooreův automat. Každý stav má čtyři rutiny a automat je při každém běhu volá ve stejném pořadí:

1. **Entry**: volá se jednou, při vstupu do stavu.
2. **Execute**: volá se při každém běhu, zde je práce stavu.
3. **CheckLeave**: volá se při každém běhu po Execute. Je to **jediné** místo, kde se žádá o nový stav.
4. **Leave**: volá se jednou, při opuštění stavu.

Celé jádro je jedna funkce. Toto je verze v C:

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

Protože se o přechod žádá jen v `CheckLeave`, provádějí se entry a leave stavu vždy jako dvojice, ve známém pořadí, a výstupy závisejí jen na stavu. Rutina, která není potřeba, může být `NULL` (`nullptr` v C++) a přeskočí se.

## Co bylo opraveno {#what-was-fixed}

První verze šablony, kterou jsem tu zveřejnil, měla několik chyb. Znovu jsem ji prošel, přeložil a spustil proti testu, který zaznamenává pořadí volání. Toto jsou změny:

- Počáteční hodnota stavových proměnných byla zbytkový název z jiného projektu (`APPCORE_HANDLER_STATE_1` místo `<MODULE>_STATE_1`).
- Poslední řádek tabulky používal `State_2_Leave` místo `State_3_Leave`. Kód se přeložil a při opuštění třetího stavu volal špatnou rutinu. Tabulka je nyní indexovaná stavem (`[<MODULE>_STATE_3] = { ... }`), takže pozici řádku nelze splést.
- `Init` nespouštěla entry rutinu prvního stavu.
- Čísla stavů se nekontrolovala. Poškozený aktuální stav nebo žádost o neexistující stav indexovaly mimo tabulku. Obojí se nyní kontroluje a automat se vrací do prvního stavu, který je bezpečný. Žádost se kontroluje **po** `CheckLeave`, protože tam vzniká. Moje první oprava to kontrolovala před, a test to odhalil, což je pěkný důkaz, proč takový test stojí za to.
- Rutina s ukazatelem `NULL` se přeskočí místo pádu.
- Chybějící forward deklarace a komentář v hlavičce, který po nahrazení názvů ztratil smysl.

## Verze v C++

V C++ je stejný vzor třída. Stav je `enum class`, rutiny jsou privátní členské funkce a tabulka je `constexpr`:

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

Žádost je `stateMachine.RequestState(State::Pressed)` v rutině `CheckLeave`. Řádek tabulky musí patřit svému stavu, což se kontroluje už při **překladu** pomocí `static_assert`, takže chyba z první verze se ani nepřeloží. Není tu halda, výjimky ani RTTI, takže to vyhovuje obvyklým embedded omezením a omezením podobným MISRA. Verze v C++ byla přeložena s `-Wall -Wextra -Wconversion -pedantic -fno-exceptions -fno-rtti` a běžela pod sanitizery adres a nedefinovaného chování se stejnými scénáři jako verze v C: pořadí volání, žádost, neplatná žádost, poškozený stav a přeskočené rutiny `NULL`.

Druhá část této série, [tlačítko s debounce a dlouhým stiskem](/blog/fsm-in-practice-button), ukazuje šablonu ve skutečném modulu.

## Licence

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
