---
title: "Konečné automaty"
slug: finite-state-machines
date: 2024-09-29T16:24:40
authors: [Mr.Nobody]
tags: [embedded]
image: /img/blog/fsm-state-machine.png
---

Pre vývoj embedded softvéru je správny návrh nevyhnutný. Mikrokontrolér musí zvládať spracovanie samotnej aplikácie a komunikáciu s množstvom pripojených obvodov cez interné alebo externé periférie. Vykonávanie aplikácie má byť čo najrýchlejšie. To je však pre každého hrozne neurčité vysvetlenie. V reálnom svete musí vývojár zabezpečiť optimálne krátku logickú cestu vykonávania kódu. Čo znamená, že vývojár nemá v každom hlavnom cykle kontrolovať všetky podmienky. Jedným zo spôsobov takejto optimalizácie je správne vnáranie podmienok. S rastúcou zložitosťou projektu to môže byť naozaj ťažké. Veľa vnorených podmienených príkazov môže viesť k nestabilite kódu a znižuje jeho čitateľnosť. Čitateľnosť kódu je ukrutne potrebná pre budúce úpravy alebo údržbu existujúceho kódu. Jeden z mojich obľúbených citátov hovorí:

<!-- truncate -->

![Ukážka tabuľky rutín automatu v jazyku C](/img/blog/fsm-state-machine.png)

> **Vždy programuj tak, akoby ten, kto bude tvoj kód udržiavať, bol násilný psychopat, ktorý vie, kde bývaš.**

Takže by sme mali radšej premýšľať, než napíšeme samotný kód. Tento proces sa volá „návrh“ (design) a veľmi ho mám rád. Pretože ak ho urobíte správne, množstvo nového kódu a následných úprav tohto nového kódu sa výrazne zníži. Niekedy sa môže zdať, že to zaberie veľa času, ale v skutočnosti je tento čas spolu s časom písania kódu kratší než písanie kódu, ktorý sa bude neustále prepisovať. Ale ako si to uľahčiť? Tu môžeme začať hovoriť o konečných automatoch (Finite State Machines), známych aj ako FSM.

Začnime teda bezvýznamným popisom vygenerovaným AI:

> Stavové automaty, najmä automaty Mealy a Moore, sú základnými modelmi pri návrhu digitálnych systémov a v teórii vypočítateľnosti. Oba tieto automaty sa používajú na reprezentáciu systémov, ktoré prechádzajú medzi stavmi na základe vstupov a v dôsledku toho produkujú výstupy. Odlišuje ich však spôsob, akým generujú výstupy.
>
>
>
>
>
>
>
> **Mealyho automat** produkuje výstupy na základe **aktuálneho stavu** aj **aktuálneho vstupu**. Vďaka tomu sú Mealyho automaty citlivejšie, pretože výstup sa môže dynamicky meniť s každým vstupným signálom.
>
>
>
>
>
>
>
> Naopak, **Mooreov automat** generuje výstupy výlučne na základe svojho **aktuálneho stavu**, nezávisle od vstupu. Vďaka tomu sú Mooreove automaty jednoduchšie a predvídateľnejšie, pretože výstup zostáva konštantný, kým sa nezmení stav.
>
>
>
>
>
>
>
> Tieto automaty sa široko používajú v embedded systémoch, riadiacich systémoch a digitálnych obvodoch, kde sú presné prechody stavov a výstupy kritické. V tomto blogu preskúmame, ako Mealyho a Mooreove automaty fungujú, aké sú ich kľúčové rozdiely a ako sa dajú uplatniť v praktickom návrhu systémov.

Ale čo to znamená? Jednoducho povedané, Mealyho konečný automat kontroluje podmienky pre požadovaný stav ***pred*** vykonaním aktuálneho stavu. Mooreov automat kontroluje podmienky ***po*** vykonaní aktuálneho stavu.

Ale čo stav predstavuje? Predstavte si žiarovku, ktorú možno zapínať a vypínať tlačidlom. Na obsluhu tohto správania by náš automat potreboval iba dva stavy. Jeden stav, ktorý aktivuje akčný člen, a druhý stav, ktorý tento akčný člen deaktivuje. Naozaj jednoduché, nie? Ale čo v zložitých systémoch? No potrebujete jednoduchú implementáciu, ktorú možno použiť v rôznych situáciách. Presne to robí šablóna nižšie.

Počas mojej práce v automobilovom priemysle sme sa s kolegom [Janom Šimom](https://www.linkedin.com/in/jano-sima/) stretli s problémami pri návrhu konečných automatov. Existovalo množstvo rôznych štýlov, ale žiadny z nich nemal dostatočnú funkcionalitu na dosiahnutie stability a čistého návrhu. Rozhodli sme sa teda navrhnúť vlastnú šablónu. S Janovým súhlasom publikujem šablónu nášho konečného automatu pod licenciou MIT.


## Stiahnite si šablónu

Šablóna je publikovaná pod licenciou MIT. Všetko je čistý text, takže si ju môžete prečítať ešte pred stiahnutím:

| Súbor | Čo to je |
| --- | --- |
| [FsmTemplate.c](pathname:///downloads/fsm/FsmTemplate.c) | Šablóna v jazyku **C** (C99), jeden súbor so stavmi, tabuľkou rutín a stubmi |
| [FsmTemplate.hpp](pathname:///downloads/fsm/FsmTemplate.hpp) a [FsmTemplate.cpp](pathname:///downloads/fsm/FsmTemplate.cpp) | Šablóna v jazyku **C++** (C++17), trieda s jedným automatom vnútri |
| [Fsm.hpp](pathname:///downloads/fsm/Fsm.hpp) | Header-only engine pre verziu v C++ (bez haldy, bez výnimiek, bez RTTI) |
| [fsm-instantiate.sh](pathname:///downloads/fsm/fsm-instantiate.sh) | Malý skript, ktorý nahradí názvy, `fsm-instantiate.sh Button FsmTemplate.c src/` vytvorí `src/Button.c` |

Názvy v lomených zátvorkách sa nahradia názvom vášho modulu: `<Module>` sa stane `Button`, `<module>` sa stane `button` a `<MODULE>` sa stane `BUTTON`.

## Ako to funguje

Je to Mooreov automat. Každý stav má štyri rutiny a automat ich pri každom behu volá v tom istom poradí:

1. **Entry**: volá sa raz, pri vstupe do stavu.
2. **Execute**: volá sa pri každom behu, tu je práca stavu.
3. **CheckLeave**: volá sa pri každom behu po Execute. Je to **jediné** miesto, kde sa žiada nový stav.
4. **Leave**: volá sa raz, pri opustení stavu.

Celý engine je jedna funkcia. Toto je verzia v C:

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

Keďže sa prechod žiada iba v `CheckLeave`, entry a leave stavu sa vždy vykonávajú ako dvojica, v známom poradí, a výstupy závisia iba od stavu. Rutina, ktorá nie je potrebná, môže byť `NULL` (`nullptr` v C++) a preskočí sa.

## Čo sa opravilo {#what-was-fixed}

Prvá verzia šablóny, ktorú som tu publikoval, mala niekoľko chýb. Prešiel som ju znova, zostavil ju a spustil proti testu, ktorý zaznamenáva poradie volaní. Toto sú zmeny:

- Počiatočná hodnota stavových premenných bola pozostatkom názvu z iného projektu (`APPCORE_HANDLER_STATE_1` namiesto `<MODULE>_STATE_1`).
- Posledný riadok tabuľky používal `State_2_Leave` namiesto `State_3_Leave`. Kód sa skompiloval a pri opustení tretieho stavu volal zlú rutinu. Tabuľka je teraz indexovaná stavom (`[<MODULE>_STATE_3] = { ... }`), takže pozíciu riadku nemožno zameniť.
- `Init` nespúšťal entry rutinu prvého stavu.
- Čísla stavov sa nekontrolovali. Poškodený aktuálny stav alebo požiadavka na neexistujúci stav indexovali mimo tabuľky. Obe sa teraz kontrolujú a automat sa vráti do prvého stavu, ktorý je bezpečný. Požiadavka sa kontroluje **po** `CheckLeave`, pretože tam vzniká. Moja prvá oprava to kontrolovala pred, a test to zachytil, čo je pekný dôkaz, prečo sa takýto test oplatí.
- Rutina s ukazovateľom `NULL` sa preskočí namiesto pádu.
- Chýbajúca forward deklarácia a komentár v hlavičke, ktorý po nahradení názvov nedával zmysel.

## Verzia v C++

V C++ je ten istý vzor trieda. Stav je `enum class`, rutiny sú súkromné členské funkcie a tabuľka je `constexpr`:

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

Požiadavka je `stateMachine.RequestState(State::Pressed)` v rutine `CheckLeave`. Riadok tabuľky musí patriť svojmu stavu a to sa kontroluje v **čase kompilácie** pomocou `static_assert`, takže chyba z prvej verzie sa už nedá ani zostaviť. Nie je tu halda, výnimky ani RTTI, takže to zodpovedá obvyklým obmedzeniam embedded a štýlu MISRA. Verzia v C++ bola skompilovaná s `-Wall -Wextra -Wconversion -pedantic -fno-exceptions -fno-rtti` a bežala pod sanitizérmi adries a nedefinovaného správania s rovnakými scenármi ako verzia v C: poradie volaní, požiadavka, neplatná požiadavka, poškodený stav a preskočené rutiny `NULL`.

Druhá časť tejto série, [tlačidlo s debounce a dlhým stlačením](/blog/fsm-in-practice-button), ukazuje šablónu v skutočnom module.

## Licencia

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
