---
title: "Organizace souborů v embedded C: jak se ze složky stane modul"
slug: file-organization-embedded-c
date: 2026-10-04T14:00:00
authors: [Mr.Nobody]
tags: [embedded, architecture, c]
---

Můj [coding style](/docs/platform/embi-platform/coding-style) říká, že názvy souborů začínají názvem modulu a že „kompletní organizace souborů je popsána jinde". Tohle je to „jinde".

C nemá `private`, jmenné prostory ani balíčky. Jakmile je kód rozdělen do souborů, jsou soubory a build systém **jedinými** nástroji, kterými můžete říct, co k sobě patří, co je veřejné a co se nikoho jiného netýká. Organizace souborů tedy není věcí vkusu, je součástí návrhu. Tento článek popisuje, jak organizuji embedded projekt na třech úrovních: projekt, modul a jednotlivý soubor.

<!-- truncate -->

## Úroveň 1: projekt

Projekt vytvořený pomocí EmBi_Platform má pokaždé stejné uspořádání:

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

Každá složka odpovídá na jednu otázku a odpověď je důvodem, proč tam kód leží.

**Application** je to, čím se produkt liší od každého jiného produktu na stejném MCU. Má vlastní vnitřní vrstvy a jejich názvy jsou úrovně „stromu" z [článku o architektuře](/blog/design-architecture): `AppMain` vše spouští, `AppCore` je vrchol stromu s logikou celého zařízení, `AppFun` obsahuje jednotlivé funkcionality, `AppComp` nízkoúrovňové komponenty, ze kterých jsou postaveny, a `AppCom` komunikaci s vnějším světem. Volání jdou shora dolů, nikdy opačně.

**Middlewares** mají pro každou komponentu dvě místa, a to záměrně. `ThirdParty/FreeRTOS` je kód od výrobce, stažený jako Git submodul ve verzi, kterou si zvolíte, a **nikdy ho neupravujete**. Vše, co je vaše (port layer, konfigurace), leží vedle něj v `Middlewares/FreeRTOS` a nepřepíše se, když kód výrobce přepnete na jinou verzi. Když výrobce vydá opravu, aktualizujete submodul, a ne záplatovanou kopii.

**Bsp** je popsán v [dokumentaci BSP](/docs/bsp), stručná verze zní: `Ral` zná registry, `Mcal` periferie a `Hal` desku. Každá rodina STM32 má vlastní větev BSP, takže složky vypadají pro každé MCU stejně.

**EmBi_Platform** a **STM32CubeIDE** jsou nástroje. Do binárního souboru se nedostanou a projekt IDE je generovaný, takže ho lze zahodit a vytvořit znovu.

## Úroveň 2: modul

Modul je složka s pevnou sadou souborů. Nemusíte je vytvářet ručně, generuje je platforma (viz konec článku) a výsledek vypadá takto:

```text
Temperature/
├── CMakeLists.txt
├── Temperature_Types.h
├── Temperature_Port.h
├── Temperature.h
├── Temperature.c
└── Temperature_Filter.c     (a component, see below)
```

| Soubor | Role | Kdo ho smí includovat |
|---|---|---|
| `Temperature_Types.h` | Veřejné typy, výčty a makra | kdokoli |
| `Temperature_Port.h` | Veřejné funkce: **jediný** vstupní bod modulu | kdokoli |
| `Temperature.h` | Interní typy a funkce sdílené soubory modulu | pouze modul sám |
| `Temperature.c` | Implementace | (zdrojový soubor) |
| `CMakeLists.txt` | Vytváří statickou knihovnu `Temperature_Lib` | build |

Myšlenka je, že uživatel modulu čte **dva** soubory a nic jiného. První jsou typy (generovaný soubor obsahuje také typ verze a obvyklé výčty pro stavy požadavku a funkce, zde jsem ho zkrátil na to, co příklad potřebuje):

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

Druhý je port, tedy celé rozhraní modulu. Co tu není, pro ostatní neexistuje:

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

Interní hlavičkový soubor obsahuje data a funkce, které soubory modulu potřebují sdílet a které by nikdo zvenčí neměl nikdy vidět:

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

A implementace to všechno využívá:

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

Všimněte si, že stav je `static` v souboru `.c`. Neexistuje žádná globální proměnná, takže není žádné `extern` (které můj coding style zakazuje). Jedinou cestou k datům je funkce `Temperature_Get_Value()`, getter, který volajícímu také sdělí, zda je hodnota platná.

### Build systém dělá ze souboru enkapsulaci

„Includujte jen port" by bylo jen přání, kdyby to nic nevynucovalo. `CMakeLists.txt` každého modulu to vynucuje. Sestaví statickou knihovnu a **zkopíruje jen veřejné hlavičky** do samostatné složky v build adresáři. Tato složka je jediná, kterou uživatelé knihovny dostanou v include cestě:

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

(Toto je zjednodušená verze šablony, kterou platforma generuje; ta navíc řeší závislosti mezi knihovnami a cesty pro Doxygen.) Aplikace teď jen linkuje `Temperature_Lib`:

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

Vyzkoušel jsem, co se stane, když aplikace includuje interní hlavičku modulu, a překladač řekne to, co chcete, aby řekl:

```text
AppMain_Cheat.c:1:10: fatal error: Temperature.h: No such file or directory
```

Složka s veřejnými hlavičkami v build adresáři obsahuje přesně dva soubory: `Temperature_Port.h` a `Temperature_Types.h`.

**Upřímné varování:** je to ochrana build systému, ne jazyka. Pokud někdo napíše `#include "../../Middlewares/Temperature/Temperature.h"`, přeloží se to bez stížností (to jsem také vyzkoušel). Lék je levný: v CI zamítněte relativní cesty s `..` v includech.

```bash
grep -rEn '#include "[^"]*\.\./' Application Middlewares/*/ && exit 1
```

### Když modul roste: komponenty

Modul s tisícem řádků v jednom souboru je další problém. Odpovědí je **komponenta**: další dvojice souborů `Module_Component.c/.h` ve stejné složce. Ve výše uvedeném příkladu je to filtr:

```c title="Temperature_Filter.c"
#include "Temperature.h"

static temperature_Value_t lastValue;

temperature_Value_t Temperature_Filter_Apply( temperature_Value_t rawValue )
{
    lastValue = (temperature_Value_t)((lastValue + rawValue) / 2);
    return lastValue;
}
```

Hlavička komponenty je také interní (není v seznamu veřejných hlaviček), takže komponentu lze vyměnit nebo rozdělit, aniž by si toho někdo všiml. Uživatel modulu stále vidí stejné dva soubory. Pravidlo, že název souboru začíná názvem modulu, dělá komponentu viditelnou v každém seznamu souborů a název funkce `Temperature_Filter_Apply()` říká, kde ji hledat.

## Úroveň 3: uvnitř souboru

Každý soubor `.c` a `.h` generovaný platformou má stejnou kostru s bannerem pro každou sekci, ve stejném pořadí:

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

Vypadá to jako dekorace, ale je to mapa. Když otevřete soubor, který jste nikdy neviděli, víte, že lokální proměnné jsou v páté sekci a obsluhy přerušení v desáté, a nemusíte soubor číst, abyste je našli. Hlavičky mají stejnou myšlenku, obalenou include guardem a `extern "C"` pro uživatele C++:

- guard má tvar `MODULE_FILE_H`, například `TEMPERATURE_TEMPERATURE_PORT_H`,
- hlavička Doxygen (`\file`, `\ingroup`, `\brief`) je na začátku každého souboru, takže dokumentace modulu se generuje ze stejné složky,
- includy jsou seřazeny `<systémové>`, potom projektové, potom modulové.

## Jeden název na všech místech

Síla této organizace je v tom, že název modulu je všude stejný, takže název můžete uhodnout, aniž byste ho museli hledat:

| Co | Příklad |
|---|---|
| Složka | `Temperature/` |
| Knihovna v CMake | `Temperature_Lib` |
| Soubory | `Temperature.c`, `Temperature_Port.h`, `Temperature_Types.h` |
| Funkce | `Temperature_Init()`, `Temperature_Get_Value()` |
| Typy | `temperature_Value_t`, `temperature_RequestState_t` |
| Makra a enumerátory | `TEMPERATURE_REQUEST_OK` |
| Include guard | `TEMPERATURE_TEMPERATURE_PORT_H` |

Pokud ve stack trace uvidíte `Gpio_Set_PinLevel()`, víte, že je ve složce `Gpio`, v knihovně `Gpio_Lib` a že jeho typy začínají `gpio_`.

### Stejný životní cyklus pro každý modul

Generovaný modul přichází se čtyřmi funkcemi, které má každý modul: `Get_ModuleVersion()`, `Init()`, `Deinit()` a `Task()`. `Init` modul nastaví a ošetří jeho vlastní selhání, `Task` se volá periodicky z hlavní smyčky nebo ze scheduleru. Důsledkem je, že kód nahoře (`AppMain`) může se všemi moduly zacházet stejně a nový modul nepotřebuje nový koncept.

## Vytvoření modulu

Tyto soubory nevytváříte ručně. Projektové nástroje platformy (položka menu *Create module*, popsaná na stránce [Project tools](/docs/platform/embi-platform/cmake-helpertools)) se zeptají na název a umístění a vygenerují složku se všemi výše uvedenými soubory a `CMakeLists.txt`. Položka *Add component* přidá dvojici `Module_Component.c/.h` do existujícího modulu. Jednou vygenerovaný modul se nikdy nepřepisuje, takže je bezpečné nástroj spustit znovu.

## Pravidla ve stručné podobě

1. Jeden modul je jedna složka a má vlastní knihovnu.
2. Ostatní moduly includují **pouze** `Module_Port.h` a `Module_Types.h`.
3. Interní hlavičky nejsou v seznamu veřejných hlaviček.
4. Data jsou `static` v souboru `.c`, přístup vede přes funkce. Žádné proměnné `extern`.
5. Název souboru začíná názvem modulu, stejně tak každá funkce, typ a makro.
6. Kód výrobce se nikdy neupravuje. Vaše změny žijí ve složce handleru vedle něj.
7. Volání jdou ve vrstvách dolů, nikdy nahoru.
8. Vše v souboru je ve své sekci, ve stejném pořadí.

Žádné z těchto pravidel není vychytralé. Podstatné je, že všechna jsou ve všech modulech stejná, takže poté, co přečtete jeden modul, víte, jak číst všechny ostatní. To je také důvod, proč platforma soubory generuje: konvence, jejíž dodržování dá práci, je konvence, která se nedodržuje.

Stejné myšlenky z jiného úhlu pohledu jsou v článcích o [principech SOLID](/blog/solid-principles-c-cpp) (port header je rozhraní, na kterém ostatní moduly závisejí) a o [MISRA C](/blog/misra-c-rules-in-practice) (několik pravidel je mnohem snazší dodržet, když je kód takto organizován).
