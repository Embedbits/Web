---
title: "Doxygen pre embedded C: dokumentácia, na ktorú sa nedá zabudnúť"
slug: doxygen-embedded-c
date: 2026-10-06T20:00:00
authors: [Mr.Nobody]
tags: [embedded, c, cmake]
---

Každý projekt má dokumentáciu a každý projekt má dokumentáciu, ktorá klame. Súbor Wordu s popisom rozhrania bol správny v týždni, keď vznikol. Komentár nad funkciou je čestnejší, pretože je len pár riadkov od kódu, ktorý opisuje, ale píšu ho tí istí ľudia, ktorí zabúdajú. Cesta von nie je viac disciplíny, ale **nástroj, ktorý číta komentáre, zostaví z nich dokumentáciu a pri chýbajúcom popise zlyhá build**. Tým nástrojom je Doxygen.

Tento článok ukazuje, ako vyzerá zdokumentovaný modul v mojich projektoch, ako sa generuje a ako z dokumentácie urobiť súčasť CI, ktorú nemožno preskočiť. Príklady boli zostavené s Doxygen 1.9.8 a Graphviz a výstupy sú skutočné.

<!-- truncate -->

## Čo dokumentovať a čo nie

Môj [coding style](/docs/platform/embi-platform/coding-style) má o tom jeden odsek: komentáre v štýle Doxygen pre všetky **verejné** funkcie, typy a makrá, v angličtine, krátke a presné, *prečo* a nie *čo*. Pár príkladov rozdielu:

| Komentár, ktorý nič nestojí | Komentár, ktorý pomáha |
|---|---|
| `/* initializes the module */` | `Clears the filter and marks the value as not valid. The module does not report a value until Temperature_Task() has run at least once.` |
| `/* returns the value */` | `Returns TEMPERATURE_REQUEST_OK if a valid value is available, TEMPERATURE_REQUEST_ERROR if the task has not run yet.` |
| `/* value */` (pre parameter) | `Filtered temperature in tenths of a degree Celsius. Must not be NULL. Written only if the function returns TEMPERATURE_REQUEST_OK.` |

Prvý stĺpec opakuje názov funkcie, ktorý čitateľ už vidí. Druhý stĺpec hovorí to, čo čitateľ **vidieť nemôže**: jednotku, platný rozsah, kto vlastní pamäť, či sa výstup zapíše v prípade chyby, odkiaľ sa funkcia môže volať, čo treba urobiť predtým. Pre embedded rozhranie je to aj miesto pre informácie, ktoré je nebezpečné hádať: *je bezpečné volať ju z prerušenia*, *ako dlho môže blokovať*, *smie byť ukazovateľ NULL*.

## Modul v súboroch platformy

Šablóny EmBi_Platform, z ktorých každý modul vychádza, majú rovnakú kostru dokumentácie: hlavičku súboru s `\author`, `\file`, `\ingroup` a `\brief` a nad každou funkciou blok s `\brief`, popisom a `\return`. Šablóna konečného automatu pridáva `\pre` pre predpoklady a blok `\par Used global variables` so zoznamom premenných, ktoré funkcia číta (`in`), zapisuje (`out`) alebo oboje (`in,out`), čo je prekvapivo užitočný druh dokumentácie: tok dát funkcie v troch riadkoch.

Celý modul je v Doxygene jedna **skupina**. `\ingroup Temperature` v každom súbore hovorí, že súbor patrí do modulu, a samotná skupina je definovaná raz, v súbore port:

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

Typy majú krátky popis typu a každej hodnoty (komentár `/**< ... */` za členom dokumentuje člen na tom istom riadku):

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

## Generovanie

Doxygen sa konfiguruje súborom s pár stovkami volieb. Písať ho ručne je chyba, ktorej sa dá ľahko vyhnúť: platforma má súbor ako šablónu (`Doxyfile.in` v artefakte Doxygen) a napĺňa ho z premenných CMake a projekty nastavujú len tie, ktoré sa líšia od predvolených. To isté umožňuje aj samotný modul CMake a toto je celá konfigurácia príkladu:

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

a build je jeden cieľ:

```bash
cmake -S . -B build -G Ninja
cmake --build build --target docs
```

Výsledkom je priečinok so stránkami HTML. Skupina modulu so súbormi, ktoré do nej patria, a s popisom zo súboru port vyzerá takto:

![Stránka skupiny Temperature vo vygenerovanej HTML dokumentácii](/img/blog/doxygen-module-group.png)

Doxygen tiež kreslí **include graf** každého súboru a **call graf** a **caller graf** každej zdokumentovanej funkcie (`HAVE_DOT`, Graphviz: preto má platforma na to artefakt). Include grafy stojí za to občas pozrieť: šípka z aplikačného súboru do internej hlavičky modulu je ten istý problém, ktorý opisuje [článok o organizácii súborov](/blog/file-organization-embedded-c), len videný zhora.

## Dokumentácia ako test

Toto je časť, ktorá mení disciplínu. Štyri voľby menia chýbajúcu dokumentáciu z „mali by sme“ na „build je červený“:

```cmake
set(DOXYGEN_WARN_IF_UNDOCUMENTED   YES)   # a public member without a description
set(DOXYGEN_WARN_IF_DOC_ERROR      YES)   # a wrong tag, a parameter that does not exist
set(DOXYGEN_WARN_NO_PARAMDOC       YES)   # a function whose parameters are not described
set(DOXYGEN_WARN_AS_ERROR          FAIL_ON_WARNINGS)
```

S `FAIL_ON_WARNINGS` Doxygen prejde všetko, vypíše **všetky** varovania a až potom zlyhá (obyčajné `YES` sa zastaví pri prvom). Vyskúšal som to: zo súboru port som zmazal popis `Temperature_Task()` a `\param` funkcie `Temperature_Get_Value()` a build vypísal:

```text
Temperature/Temperature_Port.h:40: error: Member Temperature_Task(void) (function) of file Temperature_Port.h is not documented.
Temperature/Temperature_Port.h:45: error: parameters of member Temperature_Get_Value are not documented
ninja: build stopped: subcommand failed.
```

(Návratový kód príkazu je 1, takže CI je červené.) Keď sa popisy vrátia, ten istý build skončí bez akéhokoľvek výstupu a s návratovým kódom 0. Nová funkcia bez komentára sa teraz nemôže omylom dostať do hlavnej vetvy a nikto nemusí byť ten, kto si to pri review pamätá.

## Čo obsahuje dobrá dokumentácia rozhrania

Pri každej funkcii verejného rozhrania skontrolujte zoznam:

1. **Čo robí**, v jednej vete, so slovesom (`\brief`).
2. **Parametre**: smer (`[in]`, `[out]`, `[in,out]`), jednotku, rozsah, či je `NULL` povolené.
3. **Návratová hodnota**: každá hodnota, ktorá sa môže vrátiť, a čo znamená.
4. **Predpoklady** (`\pre`): čo sa musí urobiť predtým, napríklad inicializácia.
5. **Kontext**: dá sa volať z prerušenia, blokuje, ako dlho trvá.
6. **Vedľajšie účinky**: čo ešte mení (globálny stav, periféria).

Ak funkcia nemá odpoveď na jednu z týchto otázok, odpoveď je v kóde a čitateľ si ju musí prečítať. To je znamenie, že rozhranie nie je dokončené, a písanie komentára je často moment, keď to zistíte.

## Kde to zapadá v platforme

Každý modul platformy má vo svojom `CMakeLists.txt` volanie, ktoré zaregistruje jeho priečinok pre dokumentáciu (keď je artefakt Doxygen v projekte dostupný), a koreňový build má voľbu `DOXYGEN_ENABLED`. Dokumentácia celého firmvéru sa teda generuje tým istým buildom ako firmvér: `-DDOXYGEN_ENABLED=ON`. Artefakty (Doxygen a Graphviz) sa sťahujú vo verzii, ktorú má projekt pripnutú, takže stránky dnes a o rok vyzerajú rovnako.

## Checklist

1. Každá verejná funkcia, typ a makro má popis. Interné len tam, kde to nie je zrejmé.
2. Popis hovorí to, čo čitateľ nevidí v signatúre: jednotky, rozsahy, kontext, chyby.
3. Jedna skupina na modul (`\defgroup` v súbore port, `\ingroup` v ostatných).
4. `WARN_IF_UNDOCUMENTED`, `WARN_NO_PARAMDOC` a `FAIL_ON_WARNINGS` v CI.
5. Grafy sú zapnuté a niekto sa občas pozrie na include graf aplikácie.
6. Dokumentácia sa generuje z toho istého buildu ako firmvér, s pripnutými nástrojmi.
