---
title: "Konečné automaty v praxi: tlačítko s debounce a dlouhým stiskem"
slug: fsm-in-practice-button
date: 2026-10-06T10:00:00
authors: [Mr.Nobody]
tags: [embedded, c, architecture]
---

V [prvním článku o konečných automatech](/blog/finite-state-machines) jsem vám dal šablonu a skončil jsem slovy „pokračování příště“. Tohle je to pokračování a nejlepší způsob, jak pokračovat po teorii, je problém. Vybral jsem takový, který má každý embedded projekt a který nikdo nenapíše správně na první pokus: **tlačítko**.

Tlačítko vypadá triviálně: pin, high nebo low. Jenže mechanický kontakt *zakmitává*, takže pin udělá 1 0 1 1 0 1, než se ustálí, a produkt obvykle chce od stejného tlačítka dvě různé věci: krátký a dlouhý stisk. Napsané pomocí příznaků a čítačů v hlavní smyčce to skončí jako pár `if`ů, které na sobě závisejí způsobem, který po měsíci nikdo nevysvětlí. Konečný automat to vyřeší tak, že to vysvětlíte tabulkou.

<!-- truncate -->

## Šablona v jednom odstavci

Každý stav má čtyři rutiny a každá z nich má právě jeden úkol:

| Rutina | Volá se | Úkol |
|---|---|---|
| `Entry` | jednou, při vstupu do stavu | připravit stav (vynulovat čítač, vytvořit událost) |
| `Execute` | při každém běhu automatu, dokud je ve stavu | udělat práci stavu (počítat, vzorkovat) |
| `CheckLeave` | při každém běhu, po `Execute` | rozhodnout, zda stav opustit a kam: **jediné místo, kde se žádá o přechod** |
| `Leave` | jednou, při opuštění stavu | uklidit |

Jádro automatu spouští `Execute` a `CheckLeave` aktuálního stavu a když se stav změnil, spustí `Leave` starého a `Entry` nového. Rutiny se nikdy nevolají navzájem a kód automatu neobsahuje nic jiného než automat. Pokud chcete vědět, proč je zařízení v nějakém stavu, přečtete si `CheckLeave` předchozího.

## Nejdřív návrh: stavy a přechody

Úloha běží každých 10 ms a čte surový kontakt. Doba debounce je 50 ms a hranice dlouhého stisku je 1 sekunda. Stačí pět stavů:

| Stav | Execute | Opouští se, když | Kam |
|---|---|---|---|
| `RELEASED` | nic | kontakt je sepnutý | `DEBOUNCE_PRESS` |
| `DEBOUNCE_PRESS` | počítá tiky | kontakt se opět rozepne (byl to glitch) | `RELEASED` |
| | | kontakt byl sepnutý 50 ms | `PRESSED` |
| `PRESSED` | počítá tiky | kontakt se rozepne: událost **krátký stisk** | `DEBOUNCE_RELEASE` |
| | | kontakt je sepnutý 1 s | `LONG_PRESS` |
| `LONG_PRESS` | nic, událost **dlouhý stisk** vznikla při vstupu | kontakt se rozepne | `DEBOUNCE_RELEASE` |
| `DEBOUNCE_RELEASE` | počítá tiky rozepnutého kontaktu, zakmitnutí vynuluje počet | kontakt byl rozepnutý 50 ms | `RELEASED` |

Skutečná práce je napsat tabulku. Když je úplná, kód je jen cvičení v psaní. Když není (co se stane ve stavu `LONG_PRESS`, když kontakt při uvolnění zakmitne?), tabulka ukáže díru dřív, než napíšete řádek C.

## Kód

Vstup přichází z BSP, takže modul nemá žádnou závislost na hardwaru a dá se testovat na PC (stejné *švy* jako v článku o [unit testování](/blog/unit-testing-unity-cmock)). Port modulu tvoří `Init`, `Task` a funkce, která vrátí událost jednou:

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

Typy sledují šablonu. Jednu změnu jsem udělal záměrně: tabulka rutin je **indexovaná stavem** a nehledá se v ní, a výčet končí hodnotou `BUTTON_STATE_COUNT`, která má dvojí využití.

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

První využití je samotná tabulka. S designated initializers nezáleží na pozici řádku, takže stav nelze propojit se špatnými rutinami, když někdo přidá řádek doprostřed (šablona potřebuje komentář „toto pole musí mít stejné pořadí jako výčet stavů“):

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

Druhé využití je jádro automatu, ve kterém stejná konstanta nahrazuje napevno zapsaný „poslední stav“ při kontrole rozsahu:

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

Všimněte si, co jádro *neví*: tlačítka, čas, události. Teď stavy. Většina rutin jsou jednořádkové:

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

Několik detailů, které stojí za pozornost:

- `Button_Task()` čte vstup **jednou** za běh a uchovává ho v `isContactClosed`. Všechny rutiny jednoho běhu vidí stejnou hodnotu, i když se pin uprostřed běhu změní.
- Událost krátkého stisku vzniká v `Button_Pressed_CheckLeave()`, na stejném místě, kde se dělá rozhodnutí. Událost dlouhého stisku vzniká v `Button_LongPress_Entry()`: entry se volá přesně jednou na přechod, takže událost nemůže vzniknout dvakrát, ať kontakt dělá při držení tlačítka cokoli.
- Debounce uvolnění (`DEBOUNCE_RELEASE`) vynuluje čítač pokaždé, když se kontakt znovu sepne. To je odpověď na zakmitání při uvolnění: automat počká, až je kontakt 50 ms v klidu.

## Test

Test nahradí `Bsp_Get_ButtonRaw()` funkcí, která čte řetězec: jeden znak na tik po 10 ms, `1` je sepnutý kontakt. Vzorky jsou příběhem tlačítka a výsledkem je řetězec událostí, `S` pro krátký stisk a `L` pro dlouhý:

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

Výstup běhu je skutečný:

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

Poslední dva řádky jsou případ, který příznaky vždycky pokazí. Držení 1,5 sekundy vyvolá **jeden** dlouhý stisk a po uvolnění žádný krátký a držení těsně pod hranicí je krátký stisk. Obojí je důsledkem tabulky, a ne pečlivého programování.

## Co získáte a co to stojí

**Získáte:**

- **čitelnou specifikaci**: tabulka výše a kód jsou totéž,
- **záruku jednorázovosti**: `Entry` a `Leave` běží jednou na přechod, události se neduplikují,
- **místo pro všechno**: nový požadavek (dvojklik) je nový stav nebo nový řádek v tabulce, a ne úprava tří vnořených podmínek,
- **automat, který lze testovat na PC** s řetězcem jako vstupem, jak jste právě viděli.

**Stojí to:**

- **boilerplate**: čtyři funkce na stav, většina z nich prázdná. Je to cena za jednotnost a vyplatí se od pátého stavu. Pro automat se dvěma stavy je lepší `switch`,
- **tabulku přechodů je třeba promyslet** dřív, než napíšete kód. To není cena, ale na začátku tak působí.

## Úskalí

1. **Čas patří periodě tasku, ne zpoždění.** Automat počítá běhy, takže limity (50 ms, 1 s) jsou počty tiků. Nikdy ve stavu nevolejte delay, zablokuje všechny ostatní automaty.
2. **Vzorkujte v tasku, ne v přerušení.** Přerušení od pinu by vidělo každé zakmitnutí. Task běžící každých 10 ms je dolní propust zdarma.
3. **Jediný slot pro událost události ztrácí,** pokud je aplikace čte pomaleji, než je automat vyrábí. U tlačítka to nevadí, u protokolu ano: použijte frontu.
4. **Neplatný stav je také stav.** Kontrola rozsahu v jádře pošle poškozenou proměnnou do bezpečného stavu místo čtení tabulky mimo její meze (platí zde pravidla MISRA o [nedefinovaném chování](/blog/misra-c-rules-in-practice)).
5. **Automat s 30 stavy je znamením chybějící hierarchie.** Rozdělte ho na několik automatů, kde jeden je *stavem* druhého, a každý udržte tak malý, aby se tabulka vešla na jednu obrazovku.

## Opravy v šabloně

Když jsem příklad porovnal se šablonou z prvního článku, našel jsem v šabloně dva přeřeky a opravil jsem je tam (pozdější revize šablony našla další, viz [seznam oprav](/blog/finite-state-machines#what-was-fixed)): počáteční hodnota stavových proměnných byla zbytkový název z jiného projektu (`APPCORE_HANDLER_STATE_1` místo `<MODULE>_STATE_1`) a poslední řádek tabulky používal `State_2_Leave` místo `State_3_Leave`. Druhá z nich je druh chyby, o které tento článek je: kód se přeloží a automat při opuštění třetího stavu zavolá špatnou rutinu. Tabulka s designated initializers to trochu ztěžuje a test, který projde všechny stavy, to znemožňuje.
