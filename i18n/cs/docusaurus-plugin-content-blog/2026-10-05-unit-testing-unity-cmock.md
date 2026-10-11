---
title: "Unit testování embedded C na PC pomocí Unity a CMock"
slug: unit-testing-unity-cmock
date: 2026-10-05T10:00:00
authors: [Mr.Nobody]
tags: [embedded, c, testing]
---

„Embedded software se nedá unit testovat, potřebujete hardware." Slýchám to často a platí to přesně pro jeden druh kódu: kód, který sahá na registry. Všechno ostatní, stavové automaty, parsery protokolů, řídicí logika, převody hodnot, je obyčejné C, které se přeloží na vašem PC. A na PC běží v milisekundách, bez debuggeru, bez kabelu a bez flashování.

Tento článek ukazuje, jak otestovat modul pomocí [Unity](https://github.com/ThrowTheSwitch/Unity) (testovací framework) a [CMock](https://github.com/ThrowTheSwitch/CMock) (generátor mocků), od návrhu, který to umožňuje, až po soubor CMake, který to sestaví. Všechno bylo sestaveno a spuštěno a výstupy níže jsou skutečné.

<!-- truncate -->

## Co potřebujete otestovat a co musíte odstranit

Unit test spouští jeden modul izolovaně. Testovaný modul volá nižší vrstvu (BSP, ovladač, jiný modul) a **to** je problém: nižší vrstva potřebuje hardware. Řešením není dát modulu simulovaný hardware, ale nahradit celou nižší vrstvu něčím, co test ovládá. Tím něčím je **mock**: funkce se stejnou signaturou jako ta skutečná, která nedělá nic skutečného. Jen si pamatuje, jak byla zavolána, a vrací to, co jí test řekl, aby vrátila.

Funguje to jen tehdy, když má modul místo, kde lze nižší vrstvu nahradit. V článku o [principech SOLID](/blog/solid-principles-c-cpp) to bylo *link-time injection*: modul volá funkci deklarovanou v hlavičkovém souboru (`Bsp_Thermostat.h`) a build systém rozhoduje, který zdrojový soubor ji implementuje. Na cílovém zařízení je to skutečné BSP, v unit testu je to mock. Je to stejný princip jako u architektury z článku o [návrhu a architektuře](/blog/design-architecture): když mají vrstvy čistá rozhraní, lze každou vrstvu testovat bez vrstev pod ní.

## Nástroje

- **Unity** je framework s asercemi (`TEST_ASSERT_TRUE`, `TEST_ASSERT_EQUAL_UINT8`, `TEST_ASSERT_EQUAL_FLOAT`, `TEST_ASSERT_EQUAL_MEMORY` a mnoho dalších) a malý skript, který z vašeho testovacího souboru vygeneruje `main()` se seznamem testů, takže nikdy nemusíte test registrovat ručně. Je to pár souborů C, které se překládají spolu s testem.
- **CMock** přečte hlavičkový soubor a vygeneruje mock každé funkce v něm: `MockBsp_Thermostat.c/.h`. Je napsán v Ruby, ale jen *generátor*, vygenerovaný mock je obyčejné C.
- **Ruby** je potřeba pro oba generátory, které běží při buildu. V testovaném kódu se neobjeví.

V platformě Embedbits jsou tyto tři věci artefakty (`unity`, `cmock` a `ruby`), takže projekt nezávisí na tom, co má vývojář nainstalováno na PC. Verze jsou v `ArtifactsConfig.txt` (syntaxe je `<artifact_name>;<binary_version>;<handler_version>`). V tomto článku jsem použil Unity 2.6.1 a CMock 2.6.0 s čistým CMake, aby příklad fungoval všude.

## Testovaný modul

Termostat s hysterezí. Čte teplotu z BSP, pod 20 °C zapne topení a nad 22 °C ho vypne. Pokud senzor neodpovídá, topení vypne, protože topení bez měření je požár. Rozhraní k hardwaru je hlavičkový soubor se dvěma funkcemi:

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

Veřejný port modulu a jeho implementace:

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

Modul neincluduje žádnou hardwarovou hlavičku, nezná STM32 a lze ho přeložit překladačem na vašem PC. To je první zkouška návrhu: když se nepřeloží, není dostatečně oddělený.

## Test

Testovací soubor includuje hlavičku testovaného modulu a hlavičku **mocku**, který zatím neexistuje. Vygeneruje se z `Bsp_Thermostat.h` během buildu.

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

Přečtěme si to odshora.

- `setUp()` volá Unity před každým testem. Modul drží svůj stav ve `static` proměnné, takže každý test začíná `Thermostat_Init()` a `Bsp_Set_Heater_Expect(false)` říká mocku, že inicializace topení vypíná. Bez tohoto resetu by testy závisely jeden na druhém a na svém pořadí.
- `Sensor_Returns()` je pomocná funkce, která říká „příští volání `Bsp_Get_Celsius()` vrátí `true` a nastaví hodnotu na tuto teplotu". `_ExpectAnyArgsAndReturn` znamená „ukazatel mě nezajímá" a `_ReturnThruPtr_celsius` naplní výstupní parametr.
- Každý test je krátký příběh o třech částech: senzor něco řekne, modul se spustí (`Thermostat_Task()`), výsledek se zkontroluje. Očekávání `Bsp_Set_Heater_Expect(true)` je také aserce: pokud modul zavolá funkci s jinou hodnotou, nebo ji nezavolá, test selže.
- Třetí test ukazuje sílu mocků. Uvnitř pásma hystereze se nečeká nic, a to je ta aserce: mock test shodí, jakmile modul zavolá `Bsp_Set_Heater()`.

Past, kterou stojí za to znát: `_ReturnThruPtr_celsius(&value)` nekopíruje hodnotu v okamžiku volání, zapamatuje si **ukazatel** a hodnotu přečte, až modul mock zavolá. Pokud je `value` lokální proměnná pomocné funkce, už v té chvíli neexistuje. První verze příkladu pro tento článek měla pomocnou funkci napsanou právě takto a výsledkem byly čtyři neúspěšné testy se zprávou, která vypadá jako chyba v modulu:

```text
test_HeaterSwitchesOnBelowLowerLimit:FAIL: Expected 1 Was 0. Function Bsp_Set_Heater
Argument on. Function called with unexpected argument value.
```

Modul byl v pořádku, proměnná byla smetí. Proto má příklad `static float sensorCelsius` s komentářem.

## Build

Dva generátory a jeden spustitelný soubor. CMake spouští generátory před překladem a změna hlavičky mock znovu vygeneruje:

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

Konfigurace CMocku (`cmock.yml`) obsahuje jen seznam pluginů: `ignore`, `expect_any_args` a `return_thru_ptr`, které dávají funkce `_Ignore`, `_ExpectAnyArgs` a `_ReturnThruPtr_`, jež test výše používá. Cesta `mock_path` je relativní ke složce, ve které generátor běží, tedy k build adresáři.

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

Všimněte si, co ve spustitelném souboru *není*: žádný startup kód, žádný linker script, žádné HAL, žádná hlavička od ST. Jen modul, mock, test a framework. Sestaví se za pár sekund a běží v milisekundách, takže se může spouštět při každém uložení a při každém commitu.

## Testuje test opravdu něco?

Test, který nemůže selhat, nemá žádnou cenu. Nejlevnější kontrolou je **mutace**: kód záměrně rozbijte a podívejte se, jestli si toho některý test všimne. Změnil jsem horní mez z 22 °C na 20 °C, čímž hystereze zmizí:

```text
test_HeaterSwitchesOnBelowLowerLimit:PASS
test_HeaterSwitchesOffAboveUpperLimit:PASS
test_HeaterKeepsStateInsideHysteresis:FAIL:Function Bsp_Set_Heater.  Called more times than expected.
test_HeaterSwitchesOffWhenSensorFails:PASS

4 Tests 1 Failures 0 Ignored
```

Test hystereze chybu zachytil a zpráva říká, co se stalo: modul zavolal `Bsp_Set_Heater()`, když neměl. Je dobrým zvykem udělat to jednou pro každý nový test.

## Co mockovat a co ne

- **Mockujte hranici modulu, ne jeho vnitřek.** Mock nahrazuje rozhraní nižší vrstvy (zde `Bsp_Thermostat.h`). Nemockujte vlastní pomocné funkce ve stejném modulu: test pak popisuje, jak je kód napsán, a rozbije se při každém refaktoringu, i když je chování stejné.
- **Testujte přes veřejný port.** Test includuje `Thermostat_Port.h` a nic dalšího z modulu. Pokud potřebujete interní hlavičku, abyste něco otestovali, je to znamení, že modul má dvě odpovědnosti. Jak se oddělují veřejné a interní soubory, si přečtěte v článku o [organizaci souborů](/blog/file-organization-embedded-c).
- **Jedno chování, jeden test.** Název říká, co se očekává (`HeaterSwitchesOffWhenSensorFails`), takže červený test vám řekne, co je rozbité, dřív než ho otevřete.
- **Stejný vzor funguje v každé vrstvě.** Modul aplikace se testuje s mockem rozhraní BSP, modul MCAL s mockem portu RAL. V každém případě je vrstva pod ním nahrazena a testovaná vrstva je skutečná.
- **Pořadí volání.** CMock umí zkontrolovat, že volání různých mocků proběhnou v daném pořadí (volba `:enforce_strict_ordering`). Hodí se to pro inicializační sekvence, ale používejte to jen tam, kde je pořadí požadavkem, a ne náhodou implementace.

## Co vám host test neřekne

Nechci prodávat host testy jako všelék. Nenajdou:

- **časování**, přerušení a race conditions mezi nimi,
- **registry**: že pin opravdu přejde do high, že byly zapnuty hodiny periferie. To je práce kódu v RAL a MCAL a vyžaduje to simulátor nebo skutečný hardware,
- **rozdíly mezi PC a MCU**: šířku `int`, zarovnání, optimalizátor cílového překladače. Testy na PC ukazují, že logika je správně, ne že je správně firmware.

Proto jsou host testy základnou pyramidy: je jich mnoho, jsou rychlé a běží při každém commitu. Nad nimi je simulátor (například Renode) a hardwarové testy, kterých je méně, jsou pomalejší a pokrývají to, co PC nedokáže.

## Shrnutí

1. Navrhněte modul tak, aby vše pod ním bylo za hlavičkovým souborem (tzv. *seam*).
2. Nechte CMock vygenerovat mock z této hlavičky a Unity runner z testovacího souboru.
3. Sestavte jeden malý spustitelný soubor pro PC: modul, mock, test, framework.
4. Pište testy jako příběhy: mock říká, jak svět vypadá, modul jedná, aserce zkontroluje výsledek.
5. Jednou kód záměrně rozbijte, abyste viděli, že test selže.

Celý příklad má asi 150 řádků kódu a až se vás příště někdo zeptá, jestli termostat opravdu vypne topení, když selže senzor, nepotřebujete topení. Spustíte `ctest`.
