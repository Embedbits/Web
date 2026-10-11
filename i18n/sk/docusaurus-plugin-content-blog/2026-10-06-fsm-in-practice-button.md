---
title: "Konečné automaty v praxi: tlačidlo s debounce a dlhým stlačením"
slug: fsm-in-practice-button
date: 2026-10-06T10:00:00
authors: [Mr.Nobody]
tags: [embedded, c, architecture]
---

V [prvom článku o konečných automatoch](/blog/finite-state-machines) som vám dal šablónu a skončil som slovami „pokračovanie nabudúce“. Toto je to pokračovanie a najlepší spôsob, ako pokračovať v teórii, je problém. Vybral som taký, ktorý má každý embedded projekt a ktorý nikto nespraví správne na prvý pokus: **tlačidlo**.

Tlačidlo vyzerá triviálne: pin, high alebo low. Lenže mechanický kontakt *poskakuje*, takže pin robí 1 0 1 1 0 1, kým sa ustáli, a produkt od jedného tlačidla zvyčajne chce dve rôzne veci: krátke a dlhé stlačenie. Napísané s príznakmi a počítadlami v hlavnej slučke to skončí ako zopár `if`ov, ktoré od seba závisia spôsobom, ktorý po mesiaci nikto nevie vysvetliť. Konečný automat to rieši spôsobom, ktorý viete vysvetliť tabuľkou.

<!-- truncate -->

## Šablóna v jednom odseku

Každý stav má štyri rutiny a každá z nich má presne jednu úlohu:

| Rutina | Volá sa | Úloha |
|---|---|---|
| `Entry` | raz, pri vstupe do stavu | pripraviť stav (vynulovať počítadlo, vytvoriť udalosť) |
| `Execute` | pri každom behu automatu, kým je v stave | vykonať prácu stavu (počítať, vzorkovať) |
| `CheckLeave` | pri každom behu, po `Execute` | rozhodnúť, či stav opustiť a kam: **jediné miesto, kde sa žiada prechod** |
| `Leave` | raz, pri opustení stavu | upratať |

Jadro automatu spúšťa `Execute` a `CheckLeave` aktuálneho stavu a keď sa stav zmenil, spustí `Leave` starého a `Entry` nového. Rutiny sa navzájom nikdy nevolajú a kód automatu neobsahuje nič iné než automat. Ak chcete vedieť, prečo je zariadenie v nejakom stave, prečítate `CheckLeave` predchádzajúceho.

## Najprv návrh: stavy a prechody

Úloha beží každých 10 ms a číta surový kontakt. Čas debounce je 50 ms a hranica dlhého stlačenia je 1 sekunda. Stačí päť stavov:

| Stav | Execute | Opúšťa sa, keď | Kam |
|---|---|---|---|
| `RELEASED` | nič | kontakt je zatvorený | `DEBOUNCE_PRESS` |
| `DEBOUNCE_PRESS` | počíta tiky | kontakt sa znova otvorí (bol to glitch) | `RELEASED` |
| | | kontakt bol zatvorený 50 ms | `PRESSED` |
| `PRESSED` | počíta tiky | kontakt sa otvorí: udalosť **krátke stlačenie** | `DEBOUNCE_RELEASE` |
| | | kontakt je zatvorený 1 s | `LONG_PRESS` |
| `LONG_PRESS` | nič, udalosť **dlhé stlačenie** sa vytvorila pri vstupe | kontakt sa otvorí | `DEBOUNCE_RELEASE` |
| `DEBOUNCE_RELEASE` | počíta tiky otvoreného kontaktu, poskočenie vynuluje počítadlo | kontakt bol otvorený 50 ms | `RELEASED` |

Písanie tabuľky je skutočná práca. Keď je kompletná, kód je len písanie na stroji. Keď nie je (čo sa stane v `LONG_PRESS`, keď kontakt poskakuje pri uvoľnení?), tabuľka ukáže dieru ešte predtým, než napíšete riadok v C.

## Kód

Vstup prichádza z BSP, takže modul nemá závislosť na hardvéri a dá sa testovať na PC (rovnaký *seam* ako v článku o [unit testovaní](/blog/unit-testing-unity-cmock)). Port modulu tvorí `Init`, `Task` a funkcia, ktorá vráti udalosť jednorazovo:

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

Typy sledujú šablónu. Je tu jedna zmena, ktorú som urobil zámerne: tabuľka rutín je **indexovaná stavom** a nehľadá sa v nej a enumerácia končí `BUTTON_STATE_COUNT`, ktorá má dve použitia.

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

Prvým použitím je samotná tabuľka. S designated initializers nezáleží na polohe riadku, takže stav sa nedá prepojiť so zlými rutinami, keď niekto pridá riadok do stredu (šablóna potrebuje komentár „toto pole musí mať rovnaké poradie ako enum stavov“):

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

Druhým použitím je jadro automatu, v ktorom tá istá konštanta nahrádza natvrdo zapísaný „posledný stav“ pri kontrole rozsahu:

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

Všimnite si, čo jadro *nevie*: tlačidlá, čas, udalosti. Teraz stavy. Väčšina rutín sú jednoriadkovky:

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

Niekoľko detailov, ktoré stoja za pozornosť:

- `Button_Task()` číta vstup **raz** za beh a drží ho v `isContactClosed`. Všetky rutiny jedného behu vidia tú istú hodnotu, aj keď sa pin zmení uprostred behu.
- Udalosť krátkeho stlačenia sa vytvára v `Button_Pressed_CheckLeave()`, na tom istom mieste, kde sa robí rozhodnutie. Udalosť dlhého stlačenia sa vytvára v `Button_LongPress_Entry()`: entry sa volá presne raz za prechod, takže udalosť sa nedá vytvoriť dvakrát, nech kontakt robí počas držania tlačidla čokoľvek.
- Debounce uvoľnenia (`DEBOUNCE_RELEASE`) vynuluje svoje počítadlo vždy, keď sa kontakt opäť zatvorí. To je odpoveď na poskakovanie pri uvoľnení: automat čaká, kým je kontakt 50 ms pokojný.

## Test

Test nahradí `Bsp_Get_ButtonRaw()` funkciou, ktorá číta reťazec: jeden znak na 10 ms tik, `1` je zatvorený kontakt. Vzory sú príbehom tlačidla a výsledkom je reťazec udalostí, `S` pre krátke stlačenie a `L` pre dlhé:

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

Výstup behu je skutočný:

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

Posledné dva riadky sú prípad, ktorý príznaky vždy pokazia. Podržanie na 1,5 sekundy vyprodukuje **jedno** dlhé stlačenie a žiadne krátke stlačenie po uvoľnení a podržanie tesne pod hranicou je krátke stlačenie. Oboje je dôsledkom tabuľky a nie opatrného programovania.

## Čo získate a čo to stojí

**Získate:**

- **čitateľnú špecifikáciu**: tabuľka vyššie a kód sú tá istá vec,
- **záruku jedného razu**: `Entry` a `Leave` bežia raz za prechod, udalosti sa neduplikujú,
- **miesto pre všetko**: nová požiadavka (dvojklik) je nový stav alebo nový riadok v tabuľke, a nie úprava troch vnorených podmienok,
- **automat, ktorý sa dá testovať na PC** s reťazcom ako vstupom, ako ste práve videli.

**Stojí to:**

- **boilerplate**: štyri funkcie na stav, väčšina z nich prázdna. Je to cena za jednotnosť a vyplatí sa od 5. stavu. Pre automat s dvoma stavmi je lepší `switch`,
- **tabuľku prechodov treba premyslieť** skôr, než napíšete kód. To nie je náklad, ale na začiatku sa tak cíti.

## Úskalia

1. **Čas patrí perióde úlohy, nie delayu.** Automat počíta behy, takže limity (50 ms, 1 s) sú počty tikov. Nikdy nevolajte delay v stave, blokuje všetky ostatné automaty.
2. **Vzorkujte v úlohe, nie v prerušení.** Prerušenie od pinu by videlo každé poskočenie. Úloha, ktorá beží každých 10 ms, je dolnopriepustný filter zadarmo.
3. **Jediný slot pre udalosť stráca udalosti**, ak ho aplikácia číta pomalšie, než ich automat produkuje. Pri tlačidle to nevadí, pri protokole áno: použite frontu.
4. **Neplatný stav je stav.** Kontrola rozsahu v jadre pošle poškodenú premennú do bezpečného stavu namiesto čítania tabuľky mimo jej hraníc (platia tu pravidlá MISRA o [nedefinovanom správaní](/blog/misra-c-rules-in-practice)).
5. **Automat s 30 stavmi je znakom chýbajúcej hierarchie.** Rozdeľte ho na niekoľko automatov, kde jeden je *stavom* druhého, a každý nechajte dosť malý, aby sa zmestil do tabuľky na jednej obrazovke.

## Opravy v šablóne

Keď som porovnal príklad so šablónou z prvého článku, našiel som v šablóne dve chyby a opravil som ich tam (neskoršia revízia šablóny našla ďalšie, pozri [zoznam opráv](/blog/finite-state-machines#what-was-fixed)): počiatočná hodnota stavových premenných bola pozostatkom názvu z iného projektu (`APPCORE_HANDLER_STATE_1` namiesto `<MODULE>_STATE_1`) a posledný riadok tabuľky používal `State_2_Leave` namiesto `State_3_Leave`. Tá druhá je typ chyby, o ktorej tento článok je: kód sa skompiluje a automat pri opustení tretieho stavu zavolá zlú rutinu. Tabuľka s designated initializers to trochu sťažuje a test, ktorý prejde všetky stavy, to znemožňuje.
