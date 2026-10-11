---
title: "Unit testovanie embedded C na vašom PC s Unity a CMock"
slug: unit-testing-unity-cmock
date: 2026-10-05T10:00:00
authors: [Mr.Nobody]
tags: [embedded, c, testing]
---

„Embedded softvér sa nedá unit testovať, potrebujete hardvér." Počúvam to často a platí to presne pre jeden druh kódu: pre kód, ktorý sa dotýka registrov. Všetko ostatné, stavové automaty, parsery protokolov, riadiaca logika, prevod hodnôt, je obyčajné C, ktoré sa skompiluje na vašom PC. A na vašom PC beží v milisekundách, bez debuggera, bez kábla a bez flashovania.

Tento článok ukazuje, ako otestovať modul pomocou [Unity](https://github.com/ThrowTheSwitch/Unity) (testovací framework) a [CMock](https://github.com/ThrowTheSwitch/CMock) (generátor mockov), od návrhu, ktorý to umožňuje, až po súbor CMake, ktorý to zostaví. Všetko bolo zostavené a spustené a výstup nižšie je skutočný.

<!-- truncate -->

## Čo potrebujete testovať a čo musíte odstrániť

Unit test spúšťa jeden modul izolovane. Testovaný modul volá nižšiu vrstvu (BSP, ovládač, iný modul) a **to** je problém: nižšia vrstva potrebuje hardvér. Riešením nie je dať modulu simulovaný hardvér, ale nahradiť celú nižšiu vrstvu niečím, čo test ovláda. Tým niečím je **mock**: funkcia s rovnakou signatúrou ako skutočná, ktorá nerobí nič skutočné. Len si pamätá, ako bola zavolaná, a vracia to, čo jej test povedal vrátiť.

Funguje to iba vtedy, ak má modul miesto, kde sa dá nižšia vrstva nahradiť. V článku o [princípoch SOLID](/blog/solid-principles-c-cpp) bola *link-time injection*: modul volá funkciu deklarovanú v headeri (`Bsp_Thermostat.h`) a build systém rozhoduje, ktorý zdrojový súbor ju implementuje. Na cieľovom zariadení je to skutočné BSP, v unit teste je to mock. Je to rovnaký princíp ako architektúra z článku o [návrhu a architektúre](/blog/design-architecture): keď majú vrstvy čisté rozhrania, každú vrstvu možno testovať bez vrstiev pod ňou.

## Nástroje

- **Unity** je framework s asercami (`TEST_ASSERT_TRUE`, `TEST_ASSERT_EQUAL_UINT8`, `TEST_ASSERT_EQUAL_FLOAT`, `TEST_ASSERT_EQUAL_MEMORY` a mnohé ďalšie) a malým skriptom, ktorý z vášho testovacieho súboru vygeneruje `main()` so zoznamom testov, takže nikdy nemusíte registrovať test ručne. Je to niekoľko súborov v C, ktoré sa kompilujú spolu s testom.
- **CMock** prečíta header a vygeneruje mock každej funkcie v ňom: `MockBsp_Thermostat.c/.h`. Je napísaný v Ruby, ale iba *generátor*, vygenerovaný mock je obyčajné C.
- **Ruby** je potrebné pre oba generátory, ktoré bežia pri builde. Do testovaného kódu sa nedostane.

V platforme Embedbits sú tieto tri artefakty (`unity`, `cmock` a `ruby`), takže projekt nezávisí od toho, čo je nainštalované na PC vývojára. Verzie sú v `ArtifactsConfig.txt` (syntax je `<artifact_name>;<binary_version>;<handler_version>`). V tomto článku som použil Unity 2.6.1 a CMock 2.6.0 s obyčajným CMake, aby príklad fungoval všade.

## Testovaný modul

Termostat s hysterézou. Číta teplotu z BSP, pod 20 °C zapne ohrievač a nad 22 °C ho vypne. Ak senzor neodpovedá, ohrievač vypne, pretože ohrievač bez merania je požiar. Rozhranie k hardvéru je header s dvoma funkciami:

```c title="Bsp_Thermostat.h"
#ifndef BSP_THERMOSTAT_H
#define BSP_THERMOSTAT_H

#include <stdbool.h>

/* Implemented by the BSP of the board - or mocked in the unit test. */

/* Returns false if the sensor does not answer, the value is then not valid. */
bool Bsp_Get_Celsius(float *celsius);

void Bsp_Set_Heater(bool on);

#endif
```

Verejný port modulu a jeho implementácia:

```c title="Thermostat_Port.h"
#ifndef THERMOSTAT_THERMOSTAT_PORT_H
#define THERMOSTAT_THERMOSTAT_PORT_H

#include <stdbool.h>

void Thermostat_Init(void);
void Thermostat_Task(void);
bool Thermostat_Is_HeaterOn(void);

#endif
```
```c title="Thermostat.c"
#include "Thermostat_Port.h"
#include "Bsp_Thermostat.h"

#define THERMOSTAT_SWITCH_ON_CELSIUS   ( 20.0f )
#define THERMOSTAT_SWITCH_OFF_CELSIUS  ( 22.0f )

static bool isHeaterOn;

static void Thermostat_Set_Heater(bool on)
{
    isHeaterOn = on;
    Bsp_Set_Heater(on);
}

void Thermostat_Init(void)
{
    Thermostat_Set_Heater(false);
}

void Thermostat_Task(void)
{
    float celsius = 0.0f;

    if (!Bsp_Get_Celsius(&celsius))
    {
        Thermostat_Set_Heater(false);          /* fail safe: no value, no heating */
    }
    else if (celsius < THERMOSTAT_SWITCH_ON_CELSIUS)
    {
        Thermostat_Set_Heater(true);
    }
    else if (celsius > THERMOSTAT_SWITCH_OFF_CELSIUS)
    {
        Thermostat_Set_Heater(false);
    }
    else
    {
        /* inside the hysteresis band: keep the current state */
    }
}

bool Thermostat_Is_HeaterOn(void)
{
    return isHeaterOn;
}
```

Modul neincluduje žiadny hardvérový header, nepozná STM32 a dá sa skompilovať kompilátorom vášho PC. Toto je prvý test návrhu: ak sa nekompiluje, nie je dostatočne oddelený.

## Test

Testovací súbor includuje header testovaného modulu a header **mocku**, ktorý zatiaľ neexistuje. Generuje sa z `Bsp_Thermostat.h` počas buildu.

```c title="test_Thermostat.c"
#include "unity.h"
#include "Thermostat_Port.h"
#include "MockBsp_Thermostat.h"

void setUp(void)
{
    Bsp_Set_Heater_Expect(false);
    Thermostat_Init();
}

void tearDown(void)
{
}

/* The mock reads this variable when Thermostat_Task() calls it, so it has to outlive the helper. */
static float sensorCelsius;

/* Helper: the sensor answers with the given temperature. */
static void Sensor_Returns(float celsius)
{
    sensorCelsius = celsius;
    Bsp_Get_Celsius_ExpectAnyArgsAndReturn(true);
    Bsp_Get_Celsius_ReturnThruPtr_celsius(&sensorCelsius);
}

void test_HeaterSwitchesOnBelowLowerLimit(void)
{
    Sensor_Returns(18.0f);
    Bsp_Set_Heater_Expect(true);

    Thermostat_Task();

    TEST_ASSERT_TRUE(Thermostat_Is_HeaterOn());
}

void test_HeaterSwitchesOffAboveUpperLimit(void)
{
    Sensor_Returns(18.0f);
    Bsp_Set_Heater_Expect(true);
    Thermostat_Task();

    Sensor_Returns(23.0f);
    Bsp_Set_Heater_Expect(false);
    Thermostat_Task();

    TEST_ASSERT_FALSE(Thermostat_Is_HeaterOn());
}

void test_HeaterKeepsStateInsideHysteresis(void)
{
    Sensor_Returns(18.0f);
    Bsp_Set_Heater_Expect(true);
    Thermostat_Task();

    Sensor_Returns(21.0f);          /* no Bsp_Set_Heater expected: the mock fails the test if it is called */
    Thermostat_Task();

    TEST_ASSERT_TRUE(Thermostat_Is_HeaterOn());
}

void test_HeaterSwitchesOffWhenSensorFails(void)
{
    Sensor_Returns(18.0f);
    Bsp_Set_Heater_Expect(true);
    Thermostat_Task();

    Bsp_Get_Celsius_ExpectAnyArgsAndReturn(false);
    Bsp_Set_Heater_Expect(false);
    Thermostat_Task();

    TEST_ASSERT_FALSE(Thermostat_Is_HeaterOn());
}
```

Prečítajme si to zhora.

- `setUp()` volá Unity pred každým testom. Modul drží svoj stav v `static` premennej, takže každý test začína s `Thermostat_Init()` a `Bsp_Set_Heater_Expect(false)` hovorí mocku, že inicializácia vypne ohrievač. Bez tohto resetu by testy závisli jeden od druhého a od svojho poradia.
- `Sensor_Returns()` je pomocná funkcia, ktorá hovorí „ďalšie volanie `Bsp_Get_Celsius()` vráti `true` a nastaví hodnotu na túto teplotu". `_ExpectAnyArgsAndReturn` znamená „na ukazovateli mi nezáleží" a `_ReturnThruPtr_celsius` vyplní výstupný parameter.
- Každý test je krátky príbeh o troch častiach: senzor niečo povie, modul sa spustí (`Thermostat_Task()`), výsledok sa skontroluje. Očakávanie `Bsp_Set_Heater_Expect(true)` je zároveň aserciou: ak modul zavolá funkciu s inou hodnotou alebo ju nezavolá, test zlyhá.
- Tretí test ukazuje silu mockov. V pásme hysterézy sa neočakáva nič a to je aserica: mock zlyhá test hneď, ako modul zavolá `Bsp_Set_Heater()`.

Úskalie, ktoré stojí za to poznať: `_ReturnThruPtr_celsius(&value)` nekopíruje hodnotu v okamihu volania, zapamätá si **ukazovateľ** a hodnotu prečíta, keď modul zavolá mock. Ak je `value` lokálna premenná pomocnej funkcie, v tom čase už neexistuje. Prvá verzia príkladu pre tento článok mala pomocnú funkciu napísanú takto a výsledkom boli štyri zlyhané testy so správou, ktorá vyzerá ako chyba v module:

```text
test_HeaterSwitchesOnBelowLowerLimit:FAIL: Expected 1 Was 0. Function Bsp_Set_Heater
Argument on. Function called with unexpected argument value.
```

Modul bol správny, premenná bola nezmysel. Preto má príklad `static float sensorCelsius` s komentárom.

## Build

Dva generátory a jeden spustiteľný súbor. CMake spúšťa generátory pred kompiláciou a zmena headera mock vygeneruje znova:

```yaml title="cmock.yml"
:cmock:
  :mock_path: mocks
  :plugins:
    - :ignore
    - :expect_any_args
    - :return_thru_ptr
```
```cmake title="CMakeLists.txt"
cmake_minimum_required(VERSION 3.19)
project(ThermostatTests C)
enable_testing()

find_program(RUBY ruby REQUIRED)
set(UNITY_DIR  ${CMAKE_SOURCE_DIR}/../unity)
set(CMOCK_DIR  ${CMAKE_SOURCE_DIR}/../cmock)
set(MOCK_DIR   ${CMAKE_BINARY_DIR}/mocks)
set(TEST_NAME  test_Thermostat)

# 1. mock of the BSP interface, generated from its header
add_custom_command(
    OUTPUT  ${MOCK_DIR}/MockBsp_Thermostat.c ${MOCK_DIR}/MockBsp_Thermostat.h
    COMMAND ${RUBY} ${CMOCK_DIR}/lib/cmock.rb -o${CMAKE_SOURCE_DIR}/cmock.yml
            ${CMAKE_SOURCE_DIR}/src/Bsp_Thermostat.h
    WORKING_DIRECTORY ${CMAKE_BINARY_DIR}
    DEPENDS ${CMAKE_SOURCE_DIR}/src/Bsp_Thermostat.h ${CMAKE_SOURCE_DIR}/cmock.yml
)

# 2. the test runner (main + list of the tests), generated from the test file
add_custom_command(
    OUTPUT  ${CMAKE_BINARY_DIR}/${TEST_NAME}_Runner.c
    COMMAND ${RUBY} ${UNITY_DIR}/auto/generate_test_runner.rb
            ${CMAKE_SOURCE_DIR}/test/${TEST_NAME}.c ${CMAKE_BINARY_DIR}/${TEST_NAME}_Runner.c
    DEPENDS ${CMAKE_SOURCE_DIR}/test/${TEST_NAME}.c
)

# 3. one test executable: the module under test + the mock + the test + the framework
add_executable(${TEST_NAME}
    src/Thermostat.c
    test/${TEST_NAME}.c
    ${CMAKE_BINARY_DIR}/${TEST_NAME}_Runner.c
    ${MOCK_DIR}/MockBsp_Thermostat.c
    ${UNITY_DIR}/src/unity.c
    ${CMOCK_DIR}/src/cmock.c
)
target_include_directories(${TEST_NAME} PRIVATE src ${MOCK_DIR} ${UNITY_DIR}/src ${CMOCK_DIR}/src)
target_compile_options(${TEST_NAME} PRIVATE -Wall -Wextra)

add_test(NAME ${TEST_NAME} COMMAND ${TEST_NAME})
```

Konfigurácia CMock (`cmock.yml`) obsahuje iba zoznam pluginov: `ignore`, `expect_any_args` a `return_thru_ptr`, ktoré dávajú funkcie `_Ignore`, `_ExpectAnyArgs` a `_ReturnThruPtr_`, ktoré používa test vyššie. `mock_path` je relatívna k priečinku, v ktorom generátor beží, čo je build adresár.

```bash
cmake -S . -B build
cmake --build build
./build/test_Thermostat        # or: ctest --test-dir build
```

```text
test_Thermostat.c:26:test_HeaterSwitchesOnBelowLowerLimit:PASS
test_Thermostat.c:36:test_HeaterSwitchesOffAboveUpperLimit:PASS
test_Thermostat.c:49:test_HeaterKeepsStateInsideHysteresis:PASS
test_Thermostat.c:61:test_HeaterSwitchesOffWhenSensorFails:PASS

-----------------------
4 Tests 0 Failures 0 Ignored
OK
```

Všimnite si, čo v spustiteľnom súbore *nie je*: žiadny startup kód, žiadny linker script, žiadne HAL, žiadny header od ST. Iba modul, mock, test a framework. Zostaví sa za pár sekúnd a beží v milisekundách, takže môže bežať pri každom uložení a pri každom commite.

## Testuje test naozaj niečo?

Test, ktorý nemôže zlyhať, nemá žiadnu hodnotu. Najlacnejšia kontrola je **mutácia**: zámerne pokaziť kód a pozrieť sa, či si to niektorý test všimne. Zmenil som horný limit z 22 °C na 20 °C, čím sa odstráni hysteréza:

```text
test_HeaterSwitchesOnBelowLowerLimit:PASS
test_HeaterSwitchesOffAboveUpperLimit:PASS
test_HeaterKeepsStateInsideHysteresis:FAIL:Function Bsp_Set_Heater.  Called more times than expected.
test_HeaterSwitchesOffWhenSensorFails:PASS

4 Tests 1 Failures 0 Ignored
```

Test hysterézy chybu zachytil a správa hovorí, čo sa stalo: modul zavolal `Bsp_Set_Heater()`, keď nemal. Je dobrým zvykom urobiť to raz pre každý nový test.

## Čo mockovať a čo nie

- **Mockujte hranicu modulu, nie jeho vnútro.** Mock nahrádza rozhranie nižšej vrstvy (tu `Bsp_Thermostat.h`). Nemockujte vlastné pomocné funkcie v tom istom module: test potom popisuje, ako je kód napísaný, a rozbije sa pri každom refaktoringu, aj keď je správanie rovnaké.
- **Testujte cez verejný port.** Test includuje `Thermostat_Port.h` a nič iné z modulu. Ak potrebujete interný header na otestovanie niečoho, je to znamenie, že modul má dve zodpovednosti. Ako sa oddeľujú verejné a interné súbory, si prečítajte v článku o [organizácii súborov](/blog/file-organization-embedded-c).
- **Jedno správanie, jeden test.** Názov hovorí, čo sa očakáva (`HeaterSwitchesOffWhenSensorFails`), takže červený test vám povie, čo je pokazené, skôr než ho otvoríte.
- **Rovnaký vzor funguje v každej vrstve.** Modul aplikácie sa testuje s mockom rozhrania BSP, modul MCAL s mockom portu RAL. V každom prípade sa vrstva pod ním nahradí a testovaná vrstva je skutočná.
- **Poradie volaní.** CMock vie skontrolovať, že volania rôznych mockov prebehnú v danom poradí (voľba `:enforce_strict_ordering`). Je užitočné pri inicializačných sekvenciách, ale použite ho len tam, kde je poradie požiadavkou a nie náhodou implementácie.

## Čo vám host test nepovie

Nechcem predávať host testy ako všetko. Nenájdu:

- **časovanie**, prerušenia a race condition medzi nimi,
- **registre**: že pin naozaj prejde do vysokej úrovne, že hodiny periférie boli zapnuté. To je úloha kódu v RAL a MCAL a vyžaduje si to simulátor alebo skutočný hardvér,
- **rozdiely medzi PC a MCU**: šírku `int`, zarovnanie, optimalizátor cieľového kompilátora. Testy na PC ukazujú, že logika je správna, nie že je správny firmvér.

Preto sú host testy základňou pyramídy: veľa, rýchle a bežia pri každom commite. Nad nimi sú simulátor (napríklad Renode) a hardvérové testy, ktorých je menej, sú pomalšie a pokrývajú to, čo PC nevie.

## Zhrnutie

1. Navrhnite modul tak, aby všetko pod ním bolo za headerom (*seam*).
2. Nechajte CMock vygenerovať mock z toho headera a Unity runner z testovacieho súboru.
3. Zostavte jeden malý spustiteľný súbor pre PC: modul, mock, test, framework.
4. Píšte testy ako príbehy: mock hovorí, ako vyzerá svet, modul koná, aserica kontroluje výsledok.
5. Raz zámerne pokazte kód, aby ste videli, že test zlyhá.

Celý príklad má asi 150 riadkov kódu a keď sa vás nabudúce niekto opýta, či termostat naozaj vypne ohrievač, keď senzor zlyhá, nepotrebujete ohrievač. Spustíte `ctest`.
