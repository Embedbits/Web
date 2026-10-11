---
title: "Organizácia súborov v embedded C: ako sa z priečinka stane modul"
slug: file-organization-embedded-c
date: 2026-10-04T14:00:00
authors: [Mr.Nobody]
tags: [embedded, architecture, c]
---

Môj [coding style](/docs/platform/embi-platform/coding-style) hovorí, že názvy súborov začínajú názvom modulu a že „kompletná organizácia súborov je popísaná inde". Toto je to „inde".

Jazyk C nemá `private`, menné priestory ani balíky. Keď sa kód rozdelí do súborov, súbory a build systém sú **jediné** nástroje, ktorými môžete povedať, čo patrí k sebe, čo je verejné a čo nikoho iného nezaujíma. Organizácia súborov preto nie je vec vkusu, ale súčasť návrhu. Tento článok popisuje, ako organizujem embedded projekt na troch úrovniach: projekt, modul a jednotlivý súbor.

<!-- truncate -->

## Úroveň 1: projekt

Projekt vytvorený pomocou EmBi_Platform má vždy rovnaké rozloženie:

```text
Project_root/
├── Application/          your application
│   ├── AppMain/            entry point
│   ├── AppCore/            top level logic
│   ├── AppFun/             functionalities (high level logic)
│   ├── AppComp/            components (low level logic)
│   └── AppCom/             communication modules
├── Middlewares/          reusable software without hardware dependency
│   ├── ThirdParty/         vendor sources, one Git submodule per component
│   ├── <Name>/             your glue code and configuration of that component
│   └── Middlewares.cmake
├── Bsp/                  Board Support Package
│   ├── Hal/  Mcal/  Ral/   the three abstraction layers
│   ├── Linker/  Startup/   linker script generator, startup code
│   └── Docs/
├── EmBi_Platform/        build tooling (Git submodule), not part of the firmware
├── STM32CubeIDE/         generated IDE project
├── ArtifactsConfig.txt   versions of the build tools
└── CMakeLists.txt        project root build file
```

Každý priečinok odpovedá na jednu otázku a odpoveď je dôvodom, prečo kód žije práve tam.

**Application** je to, čo odlišuje produkt od každého iného produktu na rovnakom MCU. Má vlastné vnútorné vrstvy a ich názvy sú úrovne „stromu" z [článku o architektúre](/blog/design-architecture): `AppMain` všetko spúšťa, `AppCore` je vrchol stromu s logikou celého zariadenia, `AppFun` obsahuje jednotlivé funkcionality, `AppComp` nízkoúrovňové komponenty, z ktorých sú postavené, a `AppCom` komunikáciu s vonkajším svetom. Volania idú zhora nadol, nikdy opačne.

**Middlewares** majú pre každý komponent dve miesta a je to zámer. `ThirdParty/FreeRTOS` je kód od výrobcu, stiahnutý ako Git submodul vo verzii, ktorú si vyberiete, a **nikdy ho neupravujete**. Všetko, čo je vaše (port layer, konfigurácia), žije vedľa neho v `Middlewares/FreeRTOS` a neprepíše sa, keď prepnete kód výrobcu na inú verziu. Keď výrobca vydá opravu, aktualizujete submodul, nie upravenú kópiu.

**Bsp** je popísaný v [dokumentácii BSP](/docs/bsp), stručne: `Ral` pozná registre, `Mcal` periférie a `Hal` dosku. Každá rodina STM32 má vlastnú vetvu BSP, takže priečinky vyzerajú pre každý MCU rovnako.

**EmBi_Platform** a **STM32CubeIDE** sú nástroje. Do binárneho súboru sa nedostanú a projekt IDE je generovaný, takže sa dá zahodiť a vytvoriť znova.

## Úroveň 2: modul

Modul je priečinok s pevnou sadou súborov. Nemusíte ich vytvárať ručne, platforma ich vygeneruje (pozrite koniec článku) a výsledok vyzerá takto:

```text
Temperature/
├── CMakeLists.txt
├── Temperature_Types.h
├── Temperature_Port.h
├── Temperature.h
├── Temperature.c
└── Temperature_Filter.c     (a component, see below)
```

| Súbor | Úloha | Kto ho smie includovať |
|---|---|---|
| `Temperature_Types.h` | Verejné typy, enumerácie a makrá | každý |
| `Temperature_Port.h` | Verejné funkcie: **jediný** vstupný bod modulu | každý |
| `Temperature.h` | Interné typy a funkcie zdieľané súbormi modulu | iba samotný modul |
| `Temperature.c` | Implementácia | (zdrojový súbor) |
| `CMakeLists.txt` | Vytvára statickú knižnicu `Temperature_Lib` | build |

Myšlienka je taká, že používateľ modulu číta **dva** súbory a nič iné. Prvým sú typy (vygenerovaný súbor obsahuje aj typ verzie a bežné enumerácie pre stavy požiadaviek a funkcií, tu som ho zredukoval na to, čo príklad potrebuje):

```c title="Temperature_Types.h"
/**
 * \file Temperature_Types.h
 * \ingroup Temperature
 * \brief Temperature module global types definition
 */

#ifndef TEMPERATURE_TEMPERATURE_TYPES_H
#define TEMPERATURE_TEMPERATURE_TYPES_H
/* ============================== INCLUDES ================================== */
#include <stdint.h>
/* ============================== TYPEDEFS ================================== */

/** Temperature in tenths of a degree Celsius, 253 = 25.3 degC */
typedef int16_t temperature_Value_t;

/** Enumeration used to signal request processing state */
typedef enum
{
    TEMPERATURE_REQUEST_ERROR = 0u, /**< Processing request failed  */
    TEMPERATURE_REQUEST_OK          /**< Processing request succeed */
}   temperature_RequestState_t;

#endif /* TEMPERATURE_TEMPERATURE_TYPES_H */
```

Druhým je port, čo je celé rozhranie modulu. Všetko, čo tu nie je, pre ostatných neexistuje:

```c title="Temperature_Port.h"
/**
 * \file Temperature_Port.h
 * \ingroup Temperature
 * \brief Temperature module public functionality
 *
 * The only header that other modules include.
 */

#ifndef TEMPERATURE_TEMPERATURE_PORT_H
#define TEMPERATURE_TEMPERATURE_PORT_H

#ifdef __cplusplus
extern "C" {
#endif

/* ============================== INCLUDES ================================== */
#include "Temperature_Types.h"
/* ========================= EXPORTED FUNCTIONS ============================= */

void                       Temperature_Init     ( void );
void                       Temperature_Task     ( void );
temperature_RequestState_t Temperature_Get_Value( temperature_Value_t * const value );

#ifdef __cplusplus
}
#endif

#endif /* TEMPERATURE_TEMPERATURE_PORT_H */
```

Interný header obsahuje dáta a funkcie, ktoré súbory modulu potrebujú zdieľať a ktoré by nikto zvonku nikdy nemal vidieť:

```c title="Temperature.h"
/**
 * \file Temperature.h
 * \ingroup Temperature
 * \brief Temperature module internal definitions, not visible outside of the module
 */

#ifndef TEMPERATURE_TEMPERATURE_H
#define TEMPERATURE_TEMPERATURE_H

/* ============================== INCLUDES ================================== */
#include <stdbool.h>
#include "Temperature_Types.h"
/* ============================== TYPEDEFS ================================== */

typedef struct
{
    temperature_Value_t filteredValue;
    bool                isValid;
}   temperature_State_t;

/* ========================= EXPORTED FUNCTIONS ============================= */

/* Shared by the files of this module only */
temperature_Value_t Temperature_Filter_Apply( temperature_Value_t rawValue );

#endif /* TEMPERATURE_TEMPERATURE_H */
```

A implementácia to všetko používa:

```c title="Temperature.c"
#include "Temperature.h"
#include "Temperature_Port.h"

static temperature_State_t state;

void Temperature_Init( void )
{
    state.filteredValue = 0;
    state.isValid       = false;
}

void Temperature_Task( void )
{
    const temperature_Value_t rawValue = 253;   /* a real module reads it from the ADC */

    state.filteredValue = Temperature_Filter_Apply(rawValue);
    state.isValid       = true;
}

temperature_RequestState_t Temperature_Get_Value( temperature_Value_t * const value )
{
    temperature_RequestState_t requestState = TEMPERATURE_REQUEST_ERROR;

    if (state.isValid)
    {
        *value = state.filteredValue;
        requestState = TEMPERATURE_REQUEST_OK;
    }
    return requestState;
}
```

Všimnite si, že stav je `static` v súbore `.c`. Neexistuje žiadna globálna premenná, takže nie je ani `extern` (ktorý môj coding style zakazuje). Jediná cesta k dátam je funkcia `Temperature_Get_Value()`, getter, ktorý volajúcemu zároveň povie, či je hodnota platná.

### Build systém robí zo súboru zapuzdrenie

„Includuj iba port" by bolo len prianie, keby to nič nevynucovalo. `CMakeLists.txt` každého modulu to vynucuje. Zostaví statickú knižnicu a **do samostatného priečinka v build adresári skopíruje iba verejné headery**. Tento priečinok je jediný, ktorý používatelia knižnice dostanú do svojej include cesty:

```cmake title="CMakeLists.txt"
# Source files list for current library generation
set( Temperature_SourceFiles
    Temperature.c
    Temperature_Filter.c
)

# List of public header files provided by the current library
set( Temperature_PublicHeaders
    Temperature_Types.h
    Temperature_Port.h
)

# Create library
add_library(Temperature_Lib STATIC ${Temperature_SourceFiles})

# Set public headers directory path in build folder
set(PUBLIC_HEADERS_DIR ${CMAKE_CURRENT_BINARY_DIR}/PublicHeaders)
file(MAKE_DIRECTORY ${PUBLIC_HEADERS_DIR})

# Copy only the public headers there
foreach(PublicHeader IN LISTS Temperature_PublicHeaders)
    configure_file(
        ${CMAKE_CURRENT_SOURCE_DIR}/${PublicHeader}
        ${PUBLIC_HEADERS_DIR}/${PublicHeader}
        COPYONLY
    )
endforeach()

# Set include directories for the created target
target_include_directories( Temperature_Lib
    PUBLIC
        $<BUILD_INTERFACE:${PUBLIC_HEADERS_DIR}>
    PRIVATE
        ${CMAKE_CURRENT_SOURCE_DIR}
)
```

(Toto je zjednodušená verzia šablóny, ktorú platforma generuje a ktorá rieši aj závislosti medzi knižnicami a cesty pre Doxygen.) Aplikácia teraz iba linkuje `Temperature_Lib`:

```c title="AppMain.c"
#include <stdio.h>
#include "Temperature_Port.h"

int main(void)
{
    temperature_Value_t value = 0;

    Temperature_Init();
    Temperature_Task();
    if (TEMPERATURE_REQUEST_OK == Temperature_Get_Value(&value))
    {
        printf("%d\n", value);
    }
    return 0;
}
```

Vyskúšal som, čo sa stane, ak aplikácia includuje interný header modulu, a kompilátor povie presne to, čo od neho chcete:

```text
AppMain_Cheat.c:1:10: fatal error: Temperature.h: No such file or directory
```

Priečinok s verejnými headermi v build adresári obsahuje presne dva súbory: `Temperature_Port.h` a `Temperature_Types.h`.

**Čestné upozornenie:** je to ochrana build systému, nie jazyka. Ak niekto napíše `#include "../../Middlewares/Temperature/Temperature.h"`, skompiluje sa to bez sťažností (aj to som vyskúšal). Liek je lacný: v CI odmietnite relatívne cesty s `..` v include.

```bash
grep -rEn '#include "[^"]*\.\./' Application Middlewares/*/ && exit 1
```

### Keď modul rastie: komponenty

Modul s tisíckou riadkov v jednom súbore je ďalší problém. Odpoveďou je **komponent**: ďalšia dvojica súborov `Module_Component.c/.h` v tom istom priečinku. V príklade vyššie je to filter:

```c title="Temperature_Filter.c"
#include "Temperature.h"

static temperature_Value_t lastValue;

temperature_Value_t Temperature_Filter_Apply( temperature_Value_t rawValue )
{
    lastValue = (temperature_Value_t)((lastValue + rawValue) / 2);
    return lastValue;
}
```

Header komponentu je tiež interný (nie je v zozname verejných headerov), takže komponent možno vymeniť alebo rozdeliť bez toho, aby si to niekto všimol. Používateľ modulu stále vidí tie isté dva súbory. Pravidlo, že názov súboru začína názvom modulu, robí komponent viditeľným v každom zozname súborov a názov funkcie `Temperature_Filter_Apply()` prezrádza, kde ju hľadať.

## Úroveň 3: vnútri súboru

Každý súbor `.c` a `.h` vygenerovaný platformou má rovnakú kostru s bannerom pre každú sekciu, v rovnakom poradí:

```c
/**
 * \author ...
 * \file Temperature.c
 * \ingroup Temperature
 * \brief ...
 */
/* ============================== INCLUDES ================================== */
/* ============================== TYPEDEFS ================================== */
/* ======================== FORWARD DECLARATIONS ============================ */
/* ========================== SYMBOLIC CONSTANTS ============================ */
/* =============================== MACROS =================================== */
/* ========================== EXPORTED VARIABLES ============================ */
/* =========================== LOCAL VARIABLES ============================== */
/* ========================= EXPORTED FUNCTIONS ============================= */
/* =========================== LOCAL FUNCTIONS ============================== */
/* =========================== INTERRUPT HANDLERS =========================== */
/* ================================ TASKS =================================== */
```

Vyzerá to ako dekorácia, ale je to mapa. Keď otvoríte súbor, ktorý ste nikdy nevideli, viete, že lokálne premenné sú v piatej sekcii a obsluhy prerušení v desiatej, a nemusíte súbor čítať, aby ste ich našli. Headery majú rovnakú myšlienku, zabalenú do include guardu a do `extern "C"` pre používateľov C++:

- guard má tvar `MODULE_FILE_H`, napríklad `TEMPERATURE_TEMPERATURE_PORT_H`,
- hlavička Doxygen (`\file`, `\ingroup`, `\brief`) je na začiatku každého súboru, takže dokumentácia modulu sa generuje z toho istého priečinka,
- includy sú zoradené `<systémové>`, potom projektové, potom modulové.

## Jeden názov na všetkých miestach

Sila tejto organizácie spočíva v tom, že názov modulu je všade rovnaký, takže názov možno uhádnuť bez toho, aby ste ho museli hľadať:

| Čo | Príklad |
|---|---|
| Priečinok | `Temperature/` |
| Knižnica v CMake | `Temperature_Lib` |
| Súbory | `Temperature.c`, `Temperature_Port.h`, `Temperature_Types.h` |
| Funkcie | `Temperature_Init()`, `Temperature_Get_Value()` |
| Typy | `temperature_Value_t`, `temperature_RequestState_t` |
| Makrá a enumerátory | `TEMPERATURE_REQUEST_OK` |
| Include guard | `TEMPERATURE_TEMPERATURE_PORT_H` |

Ak vo výpise zásobníka volaní uvidíte `Gpio_Set_PinLevel()`, viete, že je v priečinku `Gpio`, v knižnici `Gpio_Lib` a že jej typy začínajú `gpio_`.

### Rovnaký životný cyklus pre každý modul

Vygenerovaný modul prichádza so štyrmi funkciami, ktoré má každý modul: `Get_ModuleVersion()`, `Init()`, `Deinit()` a `Task()`. `Init` modul nastaví a vyrieši vlastné zlyhania, `Task` sa volá periodicky z hlavnej slučky alebo zo schedulera. Dôsledkom je, že kód na vrchole (`AppMain`) môže so všetkými modulmi zaobchádzať rovnako a nový modul nepotrebuje nový koncept.

## Vytvorenie modulu

Tieto súbory nevytvárate ručne. Projektové nástroje platformy (položka menu *Create module*, popísaná na stránke [Project tools](/docs/platform/embi-platform/cmake-helpertools)) sa spýtajú na názov a umiestnenie a vygenerujú priečinok so všetkými súbormi vyššie a `CMakeLists.txt`. Položka *Add component* pridá dvojicu `Module_Component.c/.h` do existujúceho modulu. Raz vygenerovaný modul sa nikdy neprepíše, takže nástroj možno bezpečne spustiť znova.

## Pravidlá v skratke

1. Jeden modul je jeden priečinok a má vlastnú knižnicu.
2. Ostatné moduly includujú **iba** `Module_Port.h` a `Module_Types.h`.
3. Interné headery nie sú v zozname verejných headerov.
4. Dáta sú `static` v súbore `.c`, prístup ide cez funkcie. Žiadne `extern` premenné.
5. Názov súboru začína názvom modulu, rovnako ako každá funkcia, typ a makro.
6. Kód výrobcu sa nikdy neupravuje. Vaše zmeny žijú v priečinku handlera vedľa neho.
7. Volania idú vo vrstvách nadol, nikdy nahor.
8. Všetko v súbore je vo svojej sekcii, v rovnakom poradí.

Žiadne z týchto pravidiel nie je vychytené. Ide o to, že všetky sú rovnaké vo všetkých moduloch, takže keď si prečítate jeden modul, viete, ako čítať všetky ostatné. To je aj dôvod, prečo platforma súbory generuje: konvencia, ktorej dodržiavanie si vyžaduje prácu, je konvencia, ktorá sa nedodržiava.

Rovnaké myšlienky, z iného pohľadu, nájdete v článkoch o [princípoch SOLID](/blog/solid-principles-c-cpp) (port header je rozhranie, na ktorom ostatné moduly závisia) a o [MISRA C](/blog/misra-c-rules-in-practice) (niekoľko pravidiel sa dodržiava oveľa ľahšie, keď je kód takto organizovaný).
