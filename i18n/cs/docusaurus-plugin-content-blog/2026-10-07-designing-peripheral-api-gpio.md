---
title: "Návrh API periferie: osm rozhodnutí za modulem Gpio"
slug: designing-peripheral-api-gpio
date: 2026-10-07T10:00:00
authors: [Mr.Nobody]
tags: [embedded, c, architecture]
---

GPIO je nejjednodušší periferie mikrokontroléru: pin je high nebo low. Právě proto je dobrým tématem pro článek o **návrhu rozhraní**. Není tu žádná hardwarová složitost, za kterou by se dalo schovat, a každé rozhodnutí je volbou návrháře: jak se pin jmenuje, co funkce vrací, kde žije polarita LED. Modul `Gpio` z MCAL v Embedbits BSP je skutečný příklad se skutečnými odpověďmi a projdu je jednu po druhé, včetně alternativ a ceny.

Kód z modulu je citován z větve STM32H5 repozitáře [Bsp-Mcal-Gpio](https://github.com/Embedbits/Bsp-Mcal-Gpio). Příklady, které ho používají, byly přeloženy a spuštěny proti **skutečným** `Gpio_Port.h` a `Gpio_Types.h`, s malou náhradní implementací, aby bylo možné API vyzkoušet na PC.

<!-- truncate -->

## Celé rozhraní na jedné obrazovce

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

Každé rozhodnutí níže se dá vyčíst z tohoto seznamu.

## 1. Pin je dvojice identifikátorů, ne makro od výrobce

Ovladače výrobce adresují pin ukazatelem na blok registrů a bitovou maskou: `LL_GPIO_SetOutputPin(GPIOA, LL_GPIO_PIN_5)`. MCAL místo toho bere dva výčtové typy, `gpio_PortId_t` a `gpio_PinId_t`:

```c
Gpio_Set_PinLevel( GPIO_PORT_A, GPIO_PIN_ID_5, GPIO_PIN_LEVEL_HIGH );
```

**Proč:** kód nad MCAL nepotřebuje žádnou hlavičku výrobce, neví, co je `GPIOA` (adresa bloku registrů výrobce), a identifikátor lze kontrolovat na rozsah, což u libovolného ukazatele nejde. Každý výčet končí čítačem (`GPIO_PORT_CNT`, `GPIO_PIN_ID_CNT`), který je horní mezí pro kontrolu na začátku funkce.

**Cena:** tabulka, která překládá identifikátor na blok registrů (v `Gpio.c`, jeden řádek na port), a jedna nepřímost navíc. Tabulka také řeší vlastní problém: MCU jedné rodiny mají různý počet portů, takže jsou položky obaleny v `#if defined(GPIOK)` (viz článek o [rodinách](/blog/bsp-stm32-families-git-branches)).

## 2. Každá funkce, která může selhat, vrací stav, a výsledky vycházejí přes ukazatel

Všechny funkce kromě `Deinit`, `Task` a getteru verze vracejí `gpio_RequestState_t` a gettery předávají hodnotu přes parametr typu ukazatel:

```c
gpio_PinLevel_t level = GPIO_PIN_LEVEL_LOW;

if (GPIO_REQUEST_OK == Gpio_Get_PinLevel(GPIO_PORT_C, GPIO_PIN_ID_13, &level))
{
    /* level is valid here */
}
```

**Proč:** návratová hodnota getteru nemůže nést hodnotu *a zároveň* informaci, že hodnota není platná (`GPIO_PIN_LEVEL_LOW` je platná úroveň, takže vrácená `0` je nejednoznačná). Se stavem v návratové hodnotě a daty v parametru je neplatný port, neplatný pin nebo ukazatel `NULL` viditelnou chybou, a ne tiše špatnou úrovní. `* const` v signatuře říká, že funkce nemění ukazatel, jen data za ním.

**Cena:** dva řádky místo jednoho při každém použití. A stav má dvě hodnoty (`GPIO_REQUEST_OK`, `GPIO_REQUEST_ERROR`), takže volající ví, *že* to selhalo, ale ne *proč*. Pro GPIO to stačí, protože důvodů je jen několik (neplatný identifikátor, `NULL`) a všechny jsou programátorské chyby. U periferie se skutečným selháním (timeout I2C, chyba sběrnice) volající potřebuje víc a obvyklou odpovědí je bohatší výčet.

Pravidlo z článku o [MISRA](/blog/misra-c-rules-in-practice), které tu platí, je 17.7 (vrácená hodnota se používá): rozhraní zde usnadňuje jeho dodržení, protože každá funkce, která může selhat, to říká hodnotou, na kterou se musíte podívat.

## 3. Pin se konfiguruje daty, ne posloupností volání

Existuje konfigurační struktura se vším, co pin popisuje, a jedna funkce, která ji aplikuje:

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

**Proč:** znalost o desce pak žije v **tabulce** a kód, který ji aplikuje, je pro každou desku stejný. Podívejte se na příklad, který jsem přeložil a spustil: deska jsou dvě položky a inicializace je smyčka.

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

Protože je tabulka data, nová revize DPS změní řádek v tabulce a nic v kódu. V architektuře Embedbits je to úkol vrstvy HAL: drží tabulky a pomocí MCAL je aplikuje.

**Cena:** struktura má osm polí a každá položka musí vyplnit všechna (designated initializers to činí čitelným a vynechané pole je nula, což není vždy rozumná hodnota). Proto je užitečným společníkem funkce `Get_DefaultConfig`, kterou mají některé jiné moduly.

## 4. Polarita signálu je vlastnost pinu, ne kódu

Struktura má pole `PinActiveLevel` a existují funkce `Gpio_Set_PinStateActive()` a `Gpio_Set_PinStateInactive()`, které berou polaritu jako parametr. Důvodem je prostý fakt z elektroniky: LED může být připojena na zem (svítí s úrovní **high**) nebo na napájení (svítí s úrovní **low**) a signál chip-select bývá obvykle *active low*. Pokud kód říká `Gpio_Set_PinLevel(..., HIGH)` pro „LED zapnout“, je to správně pro jednu desku a špatně pro další.

S polaritou v tabulce aplikace řekne „zapnout“ a tabulka řekne, co to znamená. Ve výše uvedeném příkladu je LED připojena na napájení, takže `PinActiveLevel` je `GPIO_PIN_LEVEL_LOW` a test potvrzuje, co pin dělá:

```text
after Board_Init():      the pin is high (the LED is off)
after Board_Set_Led(1):  the pin is low  (the LED is on)
```

## 5. Výčty jsou konstanty výrobce

Typy nevymýšlejí vlastní čísla, jsou to čísla ovladače výrobce:

```c
typedef enum
{
    GPIO_PIN_MODE_INPUT     = LL_GPIO_MODE_INPUT,     /**< Select input mode              */
    GPIO_PIN_MODE_OUTPUT    = LL_GPIO_MODE_OUTPUT,    /**< Select output mode             */
    GPIO_PIN_MODE_ALTERNATE = LL_GPIO_MODE_ALTERNATE, /**< Select alternate function mode */
    GPIO_PIN_MODE_ANALOG    = LL_GPIO_MODE_ANALOG     /**< Select analog mode             */
}   gpio_PinMode_t;
```

**Proč:** převod z typu MCAL na hodnotu, kterou chce funkce LL, je **zdarma**: žádný `switch`, žádná tabulka a žádná možnost udělat v překladu překlep. Hodnoty konstant se mezi rodinami liší a to je skryto v jediném `#include` portu RAL (`Stm32_gpio.h` specifický pro rodinu).

**Cena:** `Gpio_Types.h`, veřejná hlavička, zahrnuje hlavičku RAL, takže konstanty výrobce prosakují do hlaviček, které uživatelé modulu vidí. Alternativou je typ s vlastními hodnotami a překladová tabulka v souboru `.c`, což stojí kód a místo pro chybu, ale udrží výrobce mimo veřejné hlavičky. Rozhodnutí je kompromis a je dobré vědět, že jím je.

## 6. Stejný životní cyklus jako každý jiný modul

`Gpio_Get_ModuleVersion()`, `Gpio_Init()`, `Gpio_Deinit()` a `Gpio_Task()` pocházejí ze šablony, kterou začíná každý modul (viz článek o [organizaci souborů](/blog/file-organization-embedded-c)). Rozdíl je na jednom místě, kde to dává smysl: `Gpio_Init()` není `void`, bere **konfiguraci pinu**. Modul GPIO nezná desku, takže „inicializovat modul“ nemá bez otázky „který pin?“ význam. Jednotný životní cyklus, který se ohne tam, kde to vyžaduje povaha modulu, je lepší než životní cyklus vnucený modulu, kam nepasuje.

## 7. Pořadí kroků je součástí rozhraní

Podívejte se na komentář k `Gpio_Init()`:

```c
/**
 * Activates the port clock and configures the pin. Output level (inactive state),
 * output type, speed, pull and alternate function are configured before the pin
 * mode, so an output pin starts directly with its inactive level (no glitch).
 * Configuration stops at the first failed step.
 */
```

Režim pinu, tedy krok, který skutečně **připojí výstupní budič k pádu**, je poslední. Kdyby byl režim první, pin by na okamžik budil úroveň, kterou měl výstupní registr po resetu (obvykle low), a pak by skočil na správnou: puls na lince, která může být chip-select, reset jiného čipu nebo gate tranzistoru. Takový glitch není v debuggeru vidět, ale na osciloskopu ano. Je to dobrý příklad pravidla pro návrh API: **když na pořadí kroků záleží hardwaru, má pořadí vlastnit funkce, která je provádí**, aby ho uživatel nemohl pokazit.

Druhá věta komentáře, „stops at the first failed step“, je také návrhové rozhodnutí: funkce se nepokouší pokračovat po chybě a vrací stav selhavšího kroku.

## 8. Špatný argument je chyba, kterou volající vidí, ne pád

Funkce kontrolují své argumenty a odpovědí je stav:

```c
assert(GPIO_REQUEST_ERROR == Gpio_Init(GPIO_NULL_PTR));
assert(GPIO_REQUEST_ERROR == Gpio_Get_PinLevel(GPIO_PORT_CNT, GPIO_PIN_ID_0, &level));
assert(GPIO_REQUEST_ERROR == Gpio_Set_PinLevel(GPIO_PORT_A, GPIO_PIN_ID_CNT, GPIO_PIN_LEVEL_HIGH));
```

(Je to test mé náhradní implementace, ale skutečný `Gpio_Init()` dělá totéž pro `NULL`: celé tělo je uvnitř `if( GPIO_NULL_PTR != gpioConfig )`.) Konstanty `_CNT` mají zde druhý úkol: `GPIO_PORT_CNT` je první hodnota, která **není** platným portem, takže kontrola je jediné porovnání. Ve firmware není komu ukázat zprávu a `assert`, který zastaví program, je pro produkční build obvykle špatná odpověď. Lepší je chyba, která jde nahoru k volajícímu, jenž ví, co dělat (a k modulu nad MCAL, který ví, co je kritické).

## Na co bych se podíval znovu

Poctivé review návrhu má vždy seznam a tento má dvě položky, které pocházejí z článku o MISRA:

- `Gpio_Init( gpio_Config_t *gpioConfig )` strukturu jen **čte**, takže parametr by mohl být `const gpio_Config_t *` (Rule 8.13). Signatura by říkala, že funkce konfiguraci nemění, a tabulka desky by mohla být `const` a žít ve flash místo v RAM.
- Dvouhodnotový `gpio_RequestState_t` je ve všech modulech stejný (generuje ho šablona). Je to jednoduché a jednotné rozhodnutí, které je pro GPIO správné, a moduly se skutečnými selháními budou dříve či později potřebovat víc.

## Principy ve zkratce

1. **Skrývejte hardware, ne záměr.** Uživatel říká *který pin* a *jaká polarita*, ne *který registr*.
2. **Dělejte neplatný stav viditelným.** Status pro všechno, co může selhat, a výstup jen při úspěchu.
3. **Dejte znalost do dat.** Deska je tabulka, kterou čte smyčka.
4. **Nechte funkci vlastnit pořadí,** když na něm hardwaru záleží.
5. **Udržujte rozhraní stejné a říkejte poctivě, kde je ohnuté** (`Init` s parametrem) **a kde abstrakce prosakuje** (konstanty výrobce v typech).

Rozhraní má dva čtenáře: uživatele dneška a správce příštího roku. Rozhodnutí výše jsou psána pro oba a komentáře v hlavičkách jsou důkazem, že někdo myslel na toho druhého.
