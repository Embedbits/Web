---
title: "CMake pro embedded firmware: build, který se dá číst"
slug: cmake-for-embedded-firmware
date: 2026-10-06T18:00:00
authors: [Mr.Nobody]
tags: [embedded, cmake, stm32]
---

Projekt v IDE je soubor, který nikdo nečte: několik tisíc řádků XML, které IDE zapíše a IDE přečte a které nelze zrevidovat v pull requestu. Build pak existuje jen na počítači, kde ho někdo naklikal. CMake to řeší jinou filozofií: **build je text, který čtete, revidujete, verzujete a spouštíte v CI** úplně stejně jako u svého stolu.

Build systém platformy Embedbits (EmBi_Platform) je postaven na CMake a tento článek vysvětluje části, které potřebuje každý embedded build v CMake, na malém projektu, který jsem sestavil a spustil: toolchain file, pojmenované flagy, typy buildu, moduly jako knihovny, linker script, soubory po linkování a test, který spouští firmware v simulátoru. Všechna čísla a výstupy jsou skutečné.

<!-- truncate -->

## Dvě vrstvy: projekt a platforma

Platforma dělí build na dvě části a tento nápad stojí za okopírování i pro malý projekt. Kořenový `CMakeLists.txt` produktu je minimální vstupní bod a vše složité žije v samostatném skriptu, který je **verzovaný a sdílený** (Git submodul) a který kořen vkládá:

```cmake
include(${CMAKE_CURRENT_LIST_DIR}/CMake/Build.cmake)
```

Skript platformy zná typy buildu (`Debug`, `Release`, `UnitTest`, `IntegrationTest`), kontroly parametrů, toolchain, include cesty a registraci modulů. Produkt doplní jen to, co je pro něj specifické. Oprava buildu je pak nová verze submodulu a ne úprava deseti produktů. Příklad níže má obě části v jednom projektu, aby byl krátký, ale zachovává stejné oddělení: `cmake/` je „platforma“ a `CMakeLists.txt` je „produkt“.

## Ukázkový projekt

```text
cmake/
  arm-none-eabi.cmake       toolchain file
  Flags.cmake               flags with names
Bsp/Startup/                startup code and the linker script (see the article about main())
Middlewares/Temperature/    a module as a library (see the article about file organization)
Application/                main.c
CMakeLists.txt
```

## Toolchain file: kompilátor není PC

CMake předpokládá, že sestavujete pro počítač, u kterého sedíte. Toolchain file říká něco jiného:

```cmake title="cmake/arm-none-eabi.cmake"
# Toolchain file: tells CMake that the target is a bare-metal ARM and not the PC.
set(CMAKE_SYSTEM_NAME      Generic)
set(CMAKE_SYSTEM_PROCESSOR arm)

set(CMAKE_C_COMPILER   arm-none-eabi-gcc)
set(CMAKE_ASM_COMPILER arm-none-eabi-gcc)
set(CMAKE_OBJCOPY      arm-none-eabi-objcopy)
set(CMAKE_SIZE         arm-none-eabi-size)

# The compiler cannot link a PC executable: the check of the compiler builds a static library only.
set(CMAKE_TRY_COMPILE_TARGET_TYPE STATIC_LIBRARY)

# Search for programs on the PC, for libraries and headers only in the toolchain.
set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)
set(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_INCLUDE ONLY)
```

Řádek, na který lidé zapomínají, je `CMAKE_TRY_COMPILE_TARGET_TYPE`. CMake na začátku sestaví testovací program, aby ověřil, že kompilátor funguje, a bare-metal kompilátor nedokáže slinkovat program pro PC (neexistuje operační systém ani `main`, který by někdo volal). Když je cílem kontroly statická knihovna, test projde. Toolchain se zadává na příkazové řádce, jednou, při vytvoření složky buildu:

```bash
cmake -S . -B build-debug -G Ninja \
      -DCMAKE_TOOLCHAIN_FILE=cmake/arm-none-eabi.cmake -DCMAKE_BUILD_TYPE=Debug
cmake --build build-debug
```

Stejná složka se zdrojáky s jiným `-B` je jiný build: vedle ní `build-release` nebo build pro unit testy na PC, bez toolchain file.

## Pojmenované flagy

Řádek jako `-mcpu=cortex-m4 -mthumb -mfloat-abi=soft -ffunction-sections ...` se špatně revidují, protože nikdo neví, která jeho část je důležitá. Platforma má soubor `Flags.cmake` s proměnnou pro každý flag a s komentářem (`THUMB_MODE`, `ENABLE_ALL_WARNINGS`, `REMOVE_UNUSED_FUNCTIONS`, `ENABLE_GC_SECTIONS`, `PRINT_MEMORY_USAGE` a tak dále, plus varianty CPU a FPU od Cortex-M0 po M85). Projekt se pak čte jako věta. Ten můj má jen to, co příklad potřebuje:

```cmake title="cmake/Flags.cmake"
# Flags with names, so the CMakeLists.txt reads like a sentence.
set(MCU_FLAGS             -mcpu=cortex-m4 -mthumb -mfloat-abi=soft)
set(WARNING_FLAGS         -Wall -Wextra -Wshadow -Wconversion)
set(SECTION_FLAGS         -ffunction-sections -fdata-sections)       # one section per function and variable...
set(GC_FLAGS              -Wl,--gc-sections)                          # ...so the linker can drop the unused ones
set(STARTUP_LINK_FLAGS    -nostartfiles)

set(DEBUG_OPTIONS         -Og -g3)
set(RELEASE_OPTIONS       -Os -g0)
```

## CMakeLists.txt

Celý kořenový soubor příkladu, 80 řádků:

```cmake title="CMakeLists.txt"
cmake_minimum_required(VERSION 3.19)

# The toolchain file has to be given before project(), see the command line.
project(CmakeDemo C)
enable_testing()

option(GC_SECTIONS "Let the linker remove the unused functions and data" ON)

include(cmake/Flags.cmake)

# CMake adds its own flags to every configuration (-O3 -DNDEBUG for Release, -g for Debug).
# The flags of the project are in Flags.cmake, so the defaults are cleared.
set(CMAKE_C_FLAGS_DEBUG   "")
set(CMAKE_C_FLAGS_RELEASE "")

# ---- build type: flags of the configuration ----
if(NOT CMAKE_BUILD_TYPE)
    set(CMAKE_BUILD_TYPE Debug)
endif()
if(CMAKE_BUILD_TYPE STREQUAL "Debug")
    set(BUILD_OPTIONS ${DEBUG_OPTIONS})
elseif(CMAKE_BUILD_TYPE STREQUAL "Release")
    set(BUILD_OPTIONS ${RELEASE_OPTIONS})
else()
    message(FATAL_ERROR "Unknown build type '${CMAKE_BUILD_TYPE}', use Debug or Release")
endif()

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# ---- flags for everything that is built here ----
add_compile_options(${MCU_FLAGS} ${WARNING_FLAGS} ${BUILD_OPTIONS})
if(GC_SECTIONS)
    add_compile_options(${SECTION_FLAGS})
endif()
add_link_options(${MCU_FLAGS})

# ---- modules ----
add_subdirectory(Middlewares/Temperature)

# The startup code is an OBJECT library: its objects always end up in the executable,
# without relying on the linker to pull them out of an archive.
add_library(Startup OBJECT Bsp/Startup/startup.c)
# GCC may turn the copy and zero loops of the startup code into calls of memcpy() and memset()
target_compile_options(Startup PRIVATE -fno-tree-loop-distribute-patterns)

# ---- the firmware ----
set(LINKER_SCRIPT ${CMAKE_SOURCE_DIR}/Bsp/Startup/link.ld)

add_executable(firmware.elf Application/main.c Application/Unused.c $<TARGET_OBJECTS:Startup>)
target_link_libraries(firmware.elf PRIVATE Temperature_Lib)
target_link_options(firmware.elf PRIVATE
    ${STARTUP_LINK_FLAGS}
    -T ${LINKER_SCRIPT}
    -Wl,-Map=firmware.map
    -Wl,--print-memory-usage
    -Wl,--no-warn-rwx-segments
)
if(GC_SECTIONS)
    target_link_options(firmware.elf PRIVATE ${GC_FLAGS})
endif()
set_target_properties(firmware.elf PROPERTIES LINK_DEPENDS ${LINKER_SCRIPT})

# ---- after the link: the files that you flash and a size report ----
add_custom_command(TARGET firmware.elf POST_BUILD
    COMMAND ${CMAKE_OBJCOPY} -O binary firmware.elf firmware.bin
    COMMAND ${CMAKE_OBJCOPY} -O ihex   firmware.elf firmware.hex
    COMMAND ${CMAKE_SIZE} firmware.elf
    COMMENT "Creating firmware.bin, firmware.hex and the size report"
)

# ---- run it in the simulator as a test ----
find_program(QEMU qemu-system-arm)
if(QEMU)
    add_test(NAME firmware_runs_in_qemu
        COMMAND ${QEMU} -M netduinoplus2 -nographic -semihosting-config enable=on,target=native -kernel firmware.elf)
    set_tests_properties(firmware_runs_in_qemu PROPERTIES
        PASS_REGULAR_EXPRESSION "temperature module works" TIMEOUT 10)
endif()
```

Vysvětlím několik řádků, které rozhodují o tom, zda bude firmware správný.

**Typy buildu s explicitními flagy.** Jsou jen dva, `Debug` (`-Og -g3`: dost rychlý a laditelný) a `Release` (`-Os -g0`: malý a bez ladicích informací) a cokoli jiného zastaví konfiguraci chybovou hláškou. Platforma má další dva, `UnitTest` a `IntegrationTest`: u prvního se `TARGET_MCU` ani nepotřebuje, protože se sestavuje pro PC.

**Výchozí flagy CMake.** To je past. CMake přidává ke každé konfiguraci vlastní flagy, `-O3 -DNDEBUG` pro `Release` a `-g` pro `Debug`, a to před vaše vlastní. V první verzi příkladu vypadal příkaz kompilace pro release takto:

```text
-O3 -DNDEBUG -std=gnu11 -mcpu=cortex-m4 ... -Os -g0 -ffunction-sections ...
```

Vyhrává poslední `-O`, takže to bylo `-Os`, ale `-DNDEBUG` (které vypíná `assert()`) tam bylo, i když jsem o ně nikdy nežádal. Pokud chcete vědět, co sestavujete, vymažte výchozí hodnoty (`set(CMAKE_C_FLAGS_RELEASE "")`) a vše napište do vlastního souboru. Jak zjistit, co se skutečně předává kompilátoru, ukazuje `compile_commands.json`, který vytvoří volba `CMAKE_EXPORT_COMPILE_COMMANDS`: je to také soubor, který čtou editory a `clang-tidy`.

**Startup kód je knihovna typu `OBJECT`.** Objekty takové knihovny se vkládají přímo do spustitelného souboru, bez spoléhání na to, že je linker vytáhne z archivu.

**Linker script je závislost** (`LINK_DEPENDS`): když se změní, firmware se slinkuje znovu.

## Moduly jsou knihovny

Každý modul je statická knihovna se seznamem **vlastních** zdrojových souborů a veřejných hlaviček ([článek o organizaci souborů](/blog/file-organization-embedded-c) vysvětluje proč). Aplikace knihovnu linkuje a získá s ní include cestu k veřejným hlavičkám a nic víc. V souboru CMake modulu není žádné `file(GLOB ...)`: zdrojové soubory jsou vyjmenovány jeden po druhém, takže nový soubor je viditelná změna v pull requestu a soubor, který ve složce omylem zůstal, se do firmwaru nedostane.

## `TARGET_MCU`: jedno jméno, několik definic

Buildy platformy se spouštějí s `-DTARGET_MCU=STM32G474xE`. Skript jméno rozebere regulárním výrazem a z jednoho parametru vytvoří definice pro kód (`STM32G474xx` a `STM32G4xx`), které hlavičky výrobce používají k výběru správného zařízení. Stejná logika, spuštěná na čtyřech jménech:

```text
STM32G474xE  ->  MCU_ID STM32G474xx, MCU_FAMILY_ID STM32G4xx
STM32U5A5xx  ->  MCU_ID STM32U5A5xx, MCU_FAMILY_ID STM32U5xx
STM32F407VG  ->  MCU_ID STM32F407xx, MCU_FAMILY_ID STM32F4xx
STM32H563ZI  ->  MCU_ID STM32H563xx, MCU_FAMILY_ID STM32H5xx
```

To je odkaz na článek o [rodinách STM32 a větvích](/blog/bsp-stm32-families-git-branches): rodina rozhoduje, která větev BSP je ve stromu, a jméno MCU rozhoduje o definicích a linker scriptu.

## Co vám řekne linker

`-Wl,--print-memory-usage` na konci každého linkování vypíše, kolik z každé paměti je využito, `-Wl,-Map=firmware.map` zapíše adresu všeho a post-build krok vypíše velikost:

```text
Memory region         Used Size  Region Size  %age Used
           FLASH:         276 B         1 MB      0.03%
             RAM:           8 B       128 KB      0.01%
   text	   data	    bss	    dec	    hex	filename
    276	      0	      8	    284	    11c	firmware.elf
```

Dva experimenty, které jsem s těmito čísly provedl, ukazují, proč jsou flagy v buildu a ne v něčí hlavě.

**Linker umí zahodit to, co nikdo nevolá.** S `-ffunction-sections -fdata-sections` je každá funkce ve vlastní sekci a `-Wl,--gc-sections` dovolí linkeru odstranit ty, na které nikdo neodkazuje. Příklad obsahuje funkci `Unused_Checksum()`, kterou nikdo nevolá:

| Build | Velikost kódu |
|---|---|
| Release, bez flagů sekcí a bez `--gc-sections` | 324 B |
| Release, s nimi (`-DGC_SECTIONS=ON`) | **276 B** |

Rozdíl 48 bajtů je přesně funkce checksum. V reálném projektu s knihovnou výrobce, která má stovky funkcí, z nichž voláte deset, jsou rozdíly v kilobajtech.

**Kompilátor umí přidat paměť za vašimi zády.** První release build příkladu měl **772 B**, téměř třikrát víc než debug build (288 B). Map soubor ukázal `memcpy` a `memset` ze standardní knihovny. Příčina: při zapnuté optimalizaci GCC rozpozná smyčky ve startup kódu (kopírování `.data` a nulování `.bss`) jako kopii a výplň a nahradí je voláním těchto dvou funkcí, které pak přinesou svůj kód z knihovny. Jeden flag na startup objektu to opraví a výsledek je **276 B**:

```cmake
target_compile_options(Startup PRIVATE -fno-tree-loop-distribute-patterns)
```

Kromě velikosti je tu druhý důvod, proč na tom záleží: startup kód běží *před* inicializací paměti a čím méně knihovního kódu používá, tím méně se může pokazit (viz článek o tom, [co se děje před `main()`](/blog/before-main-startup-linker)).

## Po linkování: co nahrajete a co otestujete

Příkaz `POST_BUILD` vytvoří z ELF souboru `firmware.bin` a `firmware.hex` (formáty, které čtou programátory) a vypíše velikost. Poslední částí příkladu je test: `add_test` spustí firmware v QEMU a `ctest` zkontroluje, že vypsal očekávaný text:

```bash
ctest --test-dir build-debug
```

```text
1/1 Test #1: firmware_runs_in_qemu ............   Passed    0.05 sec

100% tests passed, 0 tests failed out of 1
```

Je to *smoke test* (nastartuje firmware a dojde do svého `main()`?) a běží zlomek vteřiny při každém commitu. Nenahrazuje test na hardwaru, ale build, který nenastartuje, se najde v CI a ne u stolu. Testy modulů na PC jsou jiný build téhož projektu CMake (ukazuje ho [článek o Unity a CMock](/blog/unit-testing-unity-cmock)).

## Kontrolní seznam

1. Toolchain file a `CMAKE_TRY_COMPILE_TARGET_TYPE STATIC_LIBRARY`.
2. Flagy v jednom souboru s názvy, výchozí hodnoty CMake pro konfigurace vymazané.
3. Každý modul je knihovna s explicitním seznamem zdrojů a veřejných hlaviček.
4. `-ffunction-sections -fdata-sections` a `--gc-sections`, vždy.
5. `--print-memory-usage` a map soubor při každém linkování, `size` po něm.
6. `compile_commands.json` pro editor a statickou analýzu.
7. Linker script je závislost firmwaru.
8. Smoke test v simulátoru v CI.
9. Čas od času se podívejte na velikost *release* buildu. Pokud roste bez důvodu, map soubor ví proč.
