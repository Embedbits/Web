---
title: "Návrh API periférie: osem rozhodnutí za modulom Gpio"
slug: designing-peripheral-api-gpio
date: 2026-10-07T10:00:00
authors: [Mr.Nobody]
tags: [embedded, c, architecture]
---

GPIO je najjednoduchšia periféria mikrokontroléra: pin je high alebo low. Presne preto je dobrým námetom na článok o **návrhu rozhrania**. Nie je tu žiadna hardvérová zložitosť, za ktorou by sa dalo schovať, a každé rozhodnutie je voľbou návrhára: ako sa pomenuje pin, čo funkcia vracia, kde žije polarita LED. MCAL modul `Gpio` z Embedbits BSP je skutočný príklad so skutočnými odpoveďami a prejdem ich jednu po druhej, aj s alternatívami a cenou.

Kód z modulu je citovaný z vetvy STM32H5 repozitára [Bsp-Mcal-Gpio](https://github.com/Embedbits/Bsp-Mcal-Gpio). Príklady, ktoré ho používajú, som skompiloval a spustil proti **skutočným** `Gpio_Port.h` a `Gpio_Types.h`, s malým fake implementácie, aby sa API dalo vyskúšať na PC.

<!-- truncate -->

## Celé rozhranie na jednej obrazovke

```c
gpio_ModuleVersion_t Gpio_Get_ModuleVersion  ( void );

gpio_RequestState_t  Gpio_Init               ( gpio_Config_t *gpioConfig );
void                 Gpio_Deinit             ( void );
void                 Gpio_Task               ( void );

gpio_RequestState_t  Gpio_Set_PortActive     ( gpio_PortId_t portId );
gpio_RequestState_t  Gpio_Set_PinMode        ( gpio_PortId_t portId, gpio_PinId_t pinId, gpio_PinMode_t pinType );
gpio_RequestState_t  Gpio_Get_PinMode        ( gpio_PortId_t portId, gpio_PinId_t pinId, gpio_PinMode_t * const pinType );
/* ... speed, output type, alternate function and pull in the same pairs ... */

gpio_RequestState_t  Gpio_Toggle_PinLevel    ( gpio_PortId_t portId, gpio_PinId_t pinId );
gpio_RequestState_t  Gpio_Set_PinLevel       ( gpio_PortId_t portId, gpio_PinId_t pinId, gpio_PinLevel_t pinLevel );
gpio_RequestState_t  Gpio_Get_PinLevel       ( gpio_PortId_t portId, gpio_PinId_t pinId, gpio_PinLevel_t * const pinLevel );

gpio_RequestState_t  Gpio_Set_PinStateActive   ( gpio_PortId_t portId, gpio_PinId_t pinId, gpio_PinLevel_t pinActiveLevel );
gpio_RequestState_t  Gpio_Set_PinStateInactive ( gpio_PortId_t portId, gpio_PinId_t pinId, gpio_PinLevel_t pinActiveLevel );
```

Každé rozhodnutie nižšie sa dá vyčítať z tohto zoznamu.

## 1. Pin je dvojica identifikátorov, nie makro výrobcu

Ovládače výrobcu adresujú pin ukazovateľom na blok registrov a bitovou maskou: `LL_GPIO_SetOutputPin(GPIOA, LL_GPIO_PIN_5)`. MCAL namiesto toho berie dve enumerácie, `gpio_PortId_t` a `gpio_PinId_t`:

```c
Gpio_Set_PinLevel( GPIO_PORT_A, GPIO_PIN_ID_5, GPIO_PIN_LEVEL_HIGH );
```

**Prečo:** kód nad MCAL nepotrebuje žiadnu hlavičku výrobcu, nevie, čo je `GPIOA` (adresa bloku registrov výrobcu) a identifikátor sa dá kontrolovať na rozsah, čo pri ľubovoľnom ukazovateli nejde. Každá enumerácia končí počítadlom (`GPIO_PORT_CNT`, `GPIO_PIN_ID_CNT`), ktoré je hornou hranicou pre kontrolu na začiatku funkcie.

**Cena:** tabuľka, ktorá prekladá identifikátor na blok registrov (v `Gpio.c`, jeden riadok na port) a jedna nepriama úroveň navyše. Tabuľka zároveň rieši vlastný problém: MCU jednej rodiny majú rôzny počet portov, takže záznamy sú obalené v `#if defined(GPIOK)` (pozri článok o [rodinách](/blog/bsp-stm32-families-git-branches)).

## 2. Každá funkcia, ktorá môže zlyhať, vracia stav a výsledky idú von cez ukazovateľ

Všetky funkcie okrem `Deinit`, `Task` a getteru verzie vracajú `gpio_RequestState_t` a gettery odovzdávajú hodnotu cez parameter-ukazovateľ:

```c
gpio_PinLevel_t level = GPIO_PIN_LEVEL_LOW;

if (GPIO_REQUEST_OK == Gpio_Get_PinLevel(GPIO_PORT_C, GPIO_PIN_ID_13, &level))
{
    /* level is valid here */
}
```

**Prečo:** návratová hodnota getteru nemôže niesť hodnotu *aj* informáciu, že hodnota nie je platná (`GPIO_PIN_LEVEL_LOW` je platná úroveň, takže vrátená `0` je nejednoznačná). So stavom v návratovej hodnote a dátami v parametri je neplatný port, neplatný pin alebo `NULL` ukazovateľ viditeľná chyba a nie potichu zlá úroveň. `* const` v signatúre hovorí, že funkcia nemení ukazovateľ, iba dáta za ním.

**Cena:** dva riadky namiesto jedného pri každom použití. A stav má dve hodnoty (`GPIO_REQUEST_OK`, `GPIO_REQUEST_ERROR`), takže volajúci vie, *že* zlyhalo, a nie *prečo*. Pre GPIO to stačí, lebo dôvodov je len niekoľko (neplatný identifikátor, `NULL`) a všetky sú programátorské chyby. Pri periférii so skutočným zlyhaním (timeout I2C, chyba zbernice) volajúci potrebuje viac a obvyklou odpoveďou je bohatšia enumerácia.

Pravidlo z článku o [MISRA](/blog/misra-c-rules-in-practice), ktoré sa tu uplatňuje, je 17.7 (vrátená hodnota sa používa): rozhranie tu uľahčuje jeho dodržanie, pretože každá funkcia, ktorá môže zlyhať, to oznamuje hodnotou, na ktorú sa musíte pozrieť.

## 3. Pin sa konfiguruje dátami, nie sledom volaní

Existuje konfiguračná štruktúra so všetkým, čo pin popisuje, a jedna funkcia, ktorá ju aplikuje:

```c
typedef struct
{
    gpio_PortId_t        PortId;         /**< GPIO port identification       */
    gpio_PinId_t         PinId;          /**< GPIO pin identification        */
    gpio_PinMode_t       PinMode;        /**< GPIO pin type                  */
    gpio_PinPullCfg_t    PinPull;        /**< GPIO pin pull configuration    */
    gpio_PinSpeed_t      PinSpeed;       /**< GPIO output speed              */
    gpio_PinOutputType_t PinOutType;     /**< GPIO output style              */
    gpio_AltFunction_t   PinAltFunction; /**< Alternate function used by pin */
    gpio_PinLevel_t      PinActiveLevel; /**< Pin level in active state      */
}   gpio_Config_t;
```

**Prečo:** znalosť o doske potom žije v **tabuľke** a kód, ktorý ju aplikuje, je pre každú dosku rovnaký. Pozrite sa na príklad, ktorý som skompiloval a spustil: doska sú dva záznamy a inicializácia je slučka.

```c title="board.c"
#include <stdbool.h>
#include "Gpio_Port.h"

/* The board is data: which pin is what, and what "active" means for it. */
typedef enum { BOARD_IO_LED, BOARD_IO_BUTTON, BOARD_IO_CNT } boardIo_t;

static gpio_Config_t boardPins[BOARD_IO_CNT] =
{
    [BOARD_IO_LED] =
    {
        .PortId = GPIO_PORT_A, .PinId = GPIO_PIN_ID_5, .PinMode = GPIO_PIN_MODE_OUTPUT,
        .PinPull = GPIO_PIN_PULL_NONE, .PinSpeed = GPIO_PIN_SPEED_LOW,
        .PinOutType = GPIO_PIN_OUTPUT_PUSHPULL, .PinAltFunction = GPIO_ALT_FUNC_CNT,
        .PinActiveLevel = GPIO_PIN_LEVEL_LOW        /* this LED is connected to the supply: low = on */
    },
    [BOARD_IO_BUTTON] =
    {
        .PortId = GPIO_PORT_C, .PinId = GPIO_PIN_ID_13, .PinMode = GPIO_PIN_MODE_INPUT,
        .PinPull = GPIO_PIN_PULL_NONE, .PinSpeed = GPIO_PIN_SPEED_LOW,
        .PinOutType = GPIO_PIN_OUTPUT_PUSHPULL, .PinAltFunction = GPIO_ALT_FUNC_CNT,
        .PinActiveLevel = GPIO_PIN_LEVEL_HIGH
    },
};

bool Board_Init(void)
{
    bool isOk = true;

    for (uint32_t index = 0u; index < (uint32_t)BOARD_IO_CNT; index++)
    {
        if (GPIO_REQUEST_OK != Gpio_Init(&boardPins[index]))
        {
            isOk = false;
        }
    }
    return isOk;
}

bool Board_Set_Led(bool isOn)
{
    const gpio_Config_t *led = &boardPins[BOARD_IO_LED];

    return (GPIO_REQUEST_OK == (isOn
        ? Gpio_Set_PinStateActive  (led->PortId, led->PinId, led->PinActiveLevel)
        : Gpio_Set_PinStateInactive(led->PortId, led->PinId, led->PinActiveLevel)));
}
```

Keďže tabuľka sú dáta, nová revízia DPS zmení riadok v tabuľke a nič v kóde. V architektúre Embedbits je to úloha vrstvy HAL: drží tabuľky a pomocou MCAL ich aplikuje.

**Cena:** štruktúra má osem polí a každý záznam musí vyplniť všetky (designated initializers to robia čitateľným a vynechané pole je nula, čo nie je vždy rozumná hodnota). Preto je užitočným spoločníkom funkcia `Get_DefaultConfig`, ktorú majú niektoré iné moduly.

## 4. Polarita signálu je vlastnosťou pinu, nie kódu

Štruktúra má pole `PinActiveLevel` a existujú funkcie `Gpio_Set_PinStateActive()` a `Gpio_Set_PinStateInactive()`, ktoré berú polaritu ako parameter. Dôvodom je obyčajný fakt z elektroniky: LED môže byť pripojená k zemi (svieti s úrovňou **high**) alebo k napájaniu (svieti s úrovňou **low**) a signál chip-select je zvyčajne *active low*. Ak kód hovorí `Gpio_Set_PinLevel(..., HIGH)` pre „LED zapnutá“, je to správne pre jednu dosku a zlé pre ďalšiu.

S polaritou v tabuľke aplikácia povie „zapni“ a tabuľka povie, čo to znamená. V príklade vyššie je LED pripojená k napájaniu, takže `PinActiveLevel` je `GPIO_PIN_LEVEL_LOW` a test potvrdzuje, čo pin robí:

```text
after Board_Init():      the pin is high (the LED is off)
after Board_Set_Led(1):  the pin is low  (the LED is on)
```

## 5. Enumerácie sú konštanty výrobcu

Typy si nevymýšľajú vlastné čísla, sú to čísla ovládača výrobcu:

```c
typedef enum
{
    GPIO_PIN_MODE_INPUT     = LL_GPIO_MODE_INPUT,     /**< Select input mode              */
    GPIO_PIN_MODE_OUTPUT    = LL_GPIO_MODE_OUTPUT,    /**< Select output mode             */
    GPIO_PIN_MODE_ALTERNATE = LL_GPIO_MODE_ALTERNATE, /**< Select alternate function mode */
    GPIO_PIN_MODE_ANALOG    = LL_GPIO_MODE_ANALOG     /**< Select analog mode             */
}   gpio_PinMode_t;
```

**Prečo:** konverzia z typu MCAL na hodnotu, ktorú chce funkcia LL, je **zadarmo**: žiadny `switch`, žiadna tabuľka a žiadna možnosť urobiť v preklade preklep. Hodnoty konštánt sa líšia rodinu od rodiny a to je skryté v jedinom `#include` portu RAL (`Stm32_gpio.h` špecifický pre rodinu).

**Cena:** `Gpio_Types.h`, verejná hlavička, includuje hlavičku RAL, takže konštanty výrobcu presakujú do hlavičiek, ktoré vidia používatelia modulu. Alternatívou je typ s vlastnými hodnotami a prekladová tabuľka v súbore `.c`, čo stojí kód a miesto pre chybu, ale drží výrobcu mimo verejných hlavičiek. Rozhodnutie je kompromis a je dobré vedieť, že ním je.

## 6. Rovnaký životný cyklus ako v každom inom module

`Gpio_Get_ModuleVersion()`, `Gpio_Init()`, `Gpio_Deinit()` a `Gpio_Task()` pochádzajú zo šablóny, s ktorou začína každý modul (pozri článok o [organizácii súborov](/blog/file-organization-embedded-c)). Rozdiel je na jedinom mieste, kde to dáva zmysel: `Gpio_Init()` nie je `void`, berie **konfiguráciu pinu**. Modul GPIO nepozná dosku, takže „inicializuj modul“ nemá zmysel bez otázky „ktorý pin?“. Jednotný životný cyklus, ktorý sa ohne tam, kde to povaha modulu vyžaduje, je lepší než životný cyklus vnútený modulu, kam nepasuje.

## 7. Poradie krokov je súčasťou rozhrania

Pozrite sa na komentár k `Gpio_Init()`:

```c
/**
 * Activates the port clock and configures the pin. Output level (inactive state),
 * output type, speed, pull and alternate function are configured before the pin
 * mode, so an output pin starts directly with its inactive level (no glitch).
 * Configuration stops at the first failed step.
 */
```

Režim pinu, čo je krok, ktorý skutočne **pripája výstupný budič na pad**, je posledný. Keby bol režim prvý, pin by na okamih budil úroveň, akú mal výstupný register po resete (zvyčajne low), a potom by preskočil na správnu: impulz na vedení, ktoré môže byť chip-select, reset iného čipu alebo gate tranzistora. Takýto glitch je v debuggeri neviditeľný a na osciloskope viditeľný. Je to dobrý príklad pravidla pre návrh API: **keď na poradí krokov záleží hardvéru, funkcia, ktorá ich vykonáva, by mala poradie vlastniť**, aby ho používateľ nemohol pokaziť.

Druhá veta komentára, „stops at the first failed step“, je tiež dizajnové rozhodnutie: funkcia sa nepokúša pokračovať po chybe a vráti stav zlyhaného kroku.

## 8. Zlý argument je chyba, ktorú volajúci vidí, nie pád

Funkcie kontrolujú svoje argumenty a odpoveďou je stav:

```c
assert(GPIO_REQUEST_ERROR == Gpio_Init(GPIO_NULL_PTR));
assert(GPIO_REQUEST_ERROR == Gpio_Get_PinLevel(GPIO_PORT_CNT, GPIO_PIN_ID_0, &level));
assert(GPIO_REQUEST_ERROR == Gpio_Set_PinLevel(GPIO_PORT_A, GPIO_PIN_ID_CNT, GPIO_PIN_LEVEL_HIGH));
```

(Toto je test môjho fake, ale skutočný `Gpio_Init()` robí to isté pre `NULL`: celé telo je vo vnútri `if( GPIO_NULL_PTR != gpioConfig )`.) Konštanty `_CNT` tu majú druhú úlohu: `GPIO_PORT_CNT` je prvá hodnota, ktorá **nie je** platným portom, takže kontrola je jediné porovnanie. Vo firmvéri nie je komu ukázať správu a `assert`, ktorý zastaví program, je pre produkčný build zvyčajne zlá odpoveď. Lepšia je chyba, ktorá ide hore k volajúcemu, ktorý vie, čo robiť (a k modulu nad MCAL, ktorý vie, čo je kritické).

## Na čo by som sa pozrel znova

Úprimná revízia návrhu má vždy zoznam a tento má dve položky, ktoré pochádzajú z článku o MISRA:

- `Gpio_Init( gpio_Config_t *gpioConfig )` štruktúru iba **číta**, takže parameter by mohol byť `const gpio_Config_t *` (Rule 8.13). Signatúra by hovorila, že funkcia konfiguráciu nemení, a tabuľka dosky by mohla byť `const` a žiť vo flash namiesto v RAM.
- Dvojhodnotový `gpio_RequestState_t` je v každom module rovnaký (generuje ho šablóna). Je to jednoduché a jednotné rozhodnutie, ktoré je pre GPIO správne, a moduly so skutočnými zlyhaniami budú skôr či neskôr potrebovať viac.

## Princípy stručne

1. **Skrývajte hardvér, nie zámer.** Používateľ povie *ktorý pin* a *akú polaritu*, nie *ktorý register*.
2. **Urobte neplatný stav viditeľným.** Stav pre všetko, čo môže zlyhať, a výstup len pri úspechu.
3. **Dajte znalosť do dát.** Doska je tabuľka, ktorú číta slučka.
4. **Nechajte funkciu vlastniť poradie,** keď na ňom hardvéru záleží.
5. **Držte rozhranie rovnaké a povedzte úprimne, kde je ohnuté** (`Init` s parametrom) a kde abstrakcia presakuje (konštanty výrobcu v typoch).

Rozhranie má dvoch čitateľov: používateľa dneška a správcu budúceho roka. Rozhodnutia vyššie sú napísané pre oboch a komentáre v hlavičkách sú dôkazom, že niekto myslel na toho druhého.
