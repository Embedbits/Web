---
title: "Doxygen pro embedded C: dokumentace, na kterou nelze zapomenout"
slug: doxygen-embedded-c
date: 2026-10-06T20:00:00
authors: [Mr.Nobody]
tags: [embedded, c, cmake]
---

Každý projekt má dokumentaci a každý projekt má dokumentaci, která lže. Word soubor s popisem rozhraní byl správný v týdnu, kdy vznikl. Komentář nad funkcí je poctivější, protože je pár řádků od kódu, který popisuje, ale píší ho tytéž lidé, kteří zapomínají. Cesta ven nevede přes větší disciplínu, ale přes **nástroj, který komentáře přečte, sestaví z nich dokumentaci a shodí build, když něco chybí**. Tím nástrojem je Doxygen.

Tento článek ukazuje, jak vypadá zdokumentovaný modul v mých projektech, jak se generuje a jak z dokumentace udělat součást CI, kterou nelze přeskočit. Příklady vznikly s Doxygen 1.9.8 a Graphviz a výstupy jsou skutečné.

<!-- truncate -->

## Co dokumentovat a co ne

Můj [coding style](/docs/platform/embi-platform/coding-style) o tom má jeden odstavec: komentáře ve stylu Doxygen pro všechny **veřejné** funkce, typy a makra, v angličtině, krátké a přesné, *proč* a ne *co*. Pár příkladů rozdílu:

| Komentář, který nic nestojí | Komentář, který pomáhá |
|---|---|
| `/* initializes the module */` | `Clears the filter and marks the value as not valid. The module does not report a value until Temperature_Task() has run at least once.` |
| `/* returns the value */` | `Returns TEMPERATURE_REQUEST_OK if a valid value is available, TEMPERATURE_REQUEST_ERROR if the task has not run yet.` |
| `/* value */` (for a parameter) | `Filtered temperature in tenths of a degree Celsius. Must not be NULL. Written only if the function returns TEMPERATURE_REQUEST_OK.` |

První sloupec opakuje název funkce, který čtenář už vidí. Druhý sloupec říká to, co čtenář **vidět nemůže**: jednotku, platný rozsah, kdo vlastní paměť, zda se výstup zapisuje v případě chyby, odkud lze funkci volat, co je třeba udělat předtím. Pro embedded rozhraní je to také místo pro informace, které je nebezpečné hádat: *je bezpečné volat to z přerušení*, *jak dlouho může blokovat*, *smí být ukazatel NULL*.

## Modul v souborech platformy

Šablony EmBi_Platform, z nichž každý modul začíná, mají stejnou dokumentační kostru: hlavičku souboru s `\author`, `\file`, `\ingroup` a `\brief` a nad každou funkcí blok s `\brief`, popisem a `\return`. Šablona konečného automatu přidává `\pre` pro předpoklady a blok `\par Used global variables` se seznamem proměnných, které funkce čte (`in`), zapisuje (`out`) nebo obojí (`in,out`), což je překvapivě užitečný druh dokumentace: tok dat funkce na třech řádcích.

Celý modul je v Doxygenu jedna **skupina**. `\ingroup Temperature` v každém souboru říká, že soubor patří k modulu, a samotná skupina se definuje jednou, v port souboru:

```c title="Temperature_Port.h"
/**
 * \author Mr.Nobody
 * \file Temperature_Port.h
 * \ingroup Temperature
 * \brief Temperature module public functionality
 *
 * The only header that other modules include.
 */

/**
 * \defgroup Temperature Temperature module
 * \brief Measures the temperature and provides a filtered value.
 *
 * The module has to be initialized by Temperature_Init() and its
 * Temperature_Task() has to be called periodically. The latest filtered value
 * is read by Temperature_Get_Value().
 */

#ifndef TEMPERATURE_TEMPERATURE_PORT_H
#define TEMPERATURE_TEMPERATURE_PORT_H

#ifdef __cplusplus
extern "C" {
#endif

/* ============================== INCLUDES ================================== */
#include "Temperature_Types.h"
/* ========================= EXPORTED FUNCTIONS ============================= */

/**
 * \brief Initializes the module.
 *
 * Clears the filter and marks the value as not valid. The module does not
 * report a value until Temperature_Task() has run at least once.
 *
 * \pre Called once, before the first Temperature_Task().
 */
void Temperature_Init( void );

/**
 * \brief Reads the sensor and updates the filtered value.
 *
 * Shall be called periodically from the main loop or from a scheduler, it
 * takes about the same time on every call.
 *
 * \note Not safe to be called from an interrupt: the function is not reentrant.
 */
void Temperature_Task( void );

/**
 * \brief Provides the latest filtered temperature.
 *
 * \param[out] value Filtered temperature in tenths of a degree Celsius. Must
 *                   not be NULL. It is written only if the function returns
 *                   \ref TEMPERATURE_REQUEST_OK.
 *
 * \return \ref TEMPERATURE_REQUEST_OK if a valid value is available,
 *         \ref TEMPERATURE_REQUEST_ERROR if the task has not run yet.
 */
temperature_RequestState_t Temperature_Get_Value( temperature_Value_t * const value );

#ifdef __cplusplus
}
#endif

#endif /* TEMPERATURE_TEMPERATURE_PORT_H */
```

Typy mají krátký popis typu a každé hodnoty (komentář `/**< ... */` za členem dokumentuje člen na stejném řádku):

```c title="Temperature_Types.h"
/**
 * \author Mr.Nobody
 * \file Temperature_Types.h
 * \ingroup Temperature
 * \brief Temperature module global types definition
 *
 * This file contains the types that are used across the module and are
 * available for other modules through the port file.
 */

#ifndef TEMPERATURE_TEMPERATURE_TYPES_H
#define TEMPERATURE_TEMPERATURE_TYPES_H
/* ============================== INCLUDES ================================== */
#include <stdint.h>
/* ============================== TYPEDEFS ================================== */

/** Temperature in tenths of a degree Celsius, e.g. 253 means 25.3 degC. */
typedef int16_t temperature_Value_t;

/** Enumeration used to signal the result of a request. */
typedef enum
{
    TEMPERATURE_REQUEST_ERROR = 0u, /**< The request failed, the output is not valid */
    TEMPERATURE_REQUEST_OK          /**< The request succeeded                       */
}   temperature_RequestState_t;

#endif /* TEMPERATURE_TEMPERATURE_TYPES_H */
```

## Generování

Doxygen se konfiguruje souborem s několika sty voleb. Psát ho ručně je chyba, které se snadno vyhnete: platforma má soubor jako šablonu (`Doxyfile.in` v artefaktu Doxygen) a plní ho z proměnných CMake a projekty nastavují jen ty, které se liší od výchozích. Totéž umožňuje modul samotného CMake a toto je celá konfigurace příkladu:

```cmake title="CMakeLists.txt"
cmake_minimum_required(VERSION 3.19)
project(DoxDemo C)

find_package(Doxygen REQUIRED dot)

set(DOXYGEN_PROJECT_NAME        "Temperature module")
set(DOXYGEN_OUTPUT_DIRECTORY    ${CMAKE_BINARY_DIR}/docs)
set(DOXYGEN_OPTIMIZE_OUTPUT_FOR_C YES)
set(DOXYGEN_FULL_PATH_NAMES     NO)
set(DOXYGEN_GENERATE_LATEX      NO)
set(DOXYGEN_QUIET               YES)

# The documentation is a contract: a missing description is an error.
set(DOXYGEN_WARN_IF_UNDOCUMENTED     YES)
set(DOXYGEN_WARN_IF_DOC_ERROR        YES)
set(DOXYGEN_WARN_NO_PARAMDOC         YES)
set(DOXYGEN_WARN_AS_ERROR            FAIL_ON_WARNINGS)

# Graphs (the Graphviz artifact in the platform)
set(DOXYGEN_HAVE_DOT                 YES)
set(DOXYGEN_CALL_GRAPH               YES)
set(DOXYGEN_CALLER_GRAPH             YES)
set(DOXYGEN_DOT_IMAGE_FORMAT         svg)

doxygen_add_docs(docs Temperature COMMENT "Generating the documentation")
```

a build je jeden target:

```bash
cmake -S . -B build -G Ninja
cmake --build build --target docs
```

Výsledkem je složka s HTML stránkami. Skupina modulu se soubory, které k ní patří, a popisem z port souboru vypadá takto:

![Stránka skupiny Temperature ve vygenerované HTML dokumentaci](/img/blog/doxygen-module-group.png)

Doxygen také kreslí **include graph** každého souboru a **call graph** a **caller graph** každé zdokumentované funkce (`HAVE_DOT`, Graphviz: proto má platforma pro něj artefakt). Include grafy stojí za občasný pohled: šipka z aplikačního souboru do interní hlavičky modulu je tentýž problém, který popisuje [článek o organizaci souborů](/blog/file-organization-embedded-c), jen viděný shora.

## Dokumentace jako test

Tohle je část, která mění disciplínu. Čtyři volby změní chybějící dokumentaci z „měli bychom“ na „build je červený“:

```cmake
set(DOXYGEN_WARN_IF_UNDOCUMENTED   YES)   # a public member without a description
set(DOXYGEN_WARN_IF_DOC_ERROR      YES)   # a wrong tag, a parameter that does not exist
set(DOXYGEN_WARN_NO_PARAMDOC       YES)   # a function whose parameters are not described
set(DOXYGEN_WARN_AS_ERROR          FAIL_ON_WARNINGS)
```

S `FAIL_ON_WARNINGS` Doxygen projde vše, vypíše **všechna** varování a teprve potom skončí chybou (prosté `YES` se zastaví u prvního). Vyzkoušel jsem to: z port souboru jsem smazal popis `Temperature_Task()` a `\param` u `Temperature_Get_Value()` a build ohlásil:

```text
Temperature/Temperature_Port.h:40: error: Member Temperature_Task(void) (function) of file Temperature_Port.h is not documented.
Temperature/Temperature_Port.h:45: error: parameters of member Temperature_Get_Value are not documented
ninja: build stopped: subcommand failed.
```

(Návratový kód příkazu je 1, takže CI je červené.) Po vrácení popisů stejný build skončí bez jakéhokoli výstupu a s návratovým kódem 0. Nová funkce bez komentáře se tak už nemůže omylem dostat do hlavní větve a nikdo nemusí být tím, kdo si to při review pohlídá.

## Co obsahuje dobrá dokumentace rozhraní

U každé funkce veřejného rozhraní projděte seznam:

1. **Co dělá**, jednou větou, se slovesem (`\brief`).
2. **Parametry**: směr (`[in]`, `[out]`, `[in,out]`), jednotka, rozsah, zda je povoleno `NULL`.
3. **Návratová hodnota**: každá hodnota, která může být vrácena, a co znamená.
4. **Předpoklady** (`\pre`): co je třeba udělat předtím, například inicializaci.
5. **Kontext**: lze funkci volat z přerušení, blokuje, jak dlouho trvá.
6. **Vedlejší efekty**: co dalšího mění (globální stav, periferii).

Pokud funkce nemá odpověď na jednu z těchto otázek, odpověď je v kódu a čtenář si ji musí přečíst. To je znamení, že rozhraní není dokončené, a psaní komentáře je často okamžik, kdy to zjistíte.

## Kam to v platformě zapadá

Každý modul platformy má ve svém `CMakeLists.txt` volání, které registruje jeho složku pro dokumentaci (když je v projektu dostupný artefakt Doxygen), a kořenový build má volbu `DOXYGEN_ENABLED`. Dokumentace celého firmwaru se tedy generuje stejným buildem jako firmware: `-DDOXYGEN_ENABLED=ON`. Artefakty (Doxygen a Graphviz) se stahují ve verzi, kterou má projekt připnutou, takže stránky z dneška a z příštího roku vypadají stejně.

## Kontrolní seznam

1. Každá veřejná funkce, typ a makro má popis. Interní jen tam, kde to není zřejmé.
2. Popis říká to, co čtenář nevidí v signatuře: jednotky, rozsahy, kontext, chyby.
3. Jedna skupina na modul (`\defgroup` v port souboru, `\ingroup` v ostatních).
4. `WARN_IF_UNDOCUMENTED`, `WARN_NO_PARAMDOC` a `FAIL_ON_WARNINGS` v CI.
5. Grafy jsou zapnuté a někdo se čas od času podívá na include graph aplikace.
6. Dokumentace se generuje ze stejného buildu jako firmware, s připnutými nástroji.
