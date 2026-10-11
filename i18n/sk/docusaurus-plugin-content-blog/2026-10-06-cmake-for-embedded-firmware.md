---
title: "CMake pre embedded firmware: build, ktorý si môžete prečítať"
slug: cmake-for-embedded-firmware
date: 2026-10-06T18:00:00
authors: [Mr.Nobody]
tags: [embedded, cmake, stm32]
---

Projekt z IDE je súbor, ktorý nikto nečíta: niekoľko tisíc riadkov XML, ktoré IDE zapisuje a IDE číta a ktoré sa nedajú skontrolovať v pull requeste. Build potom existuje len na počítači, kde ho niekto naklikal. CMake to rieši inou filozofiou: **build je text, ktorý čítate, kontrolujete, verzujete a spúšťate v CI** presne tak isto ako na svojom stole.

Build systém platformy Embedbits (EmBi_Platform) je postavený na CMake a tento článok vysvetľuje súčasti, ktoré potrebuje každý embedded build v CMake, na malom projekte, ktorý som zostavil a spustil: toolchain file, flagy s menami, typy buildu, moduly ako knižnice, linker script, súbory po linkovaní a test, ktorý spustí firmware v simulátore. Všetky čísla a výstupy sú skutočné.

<!-- truncate -->

## Dve vrstvy: projekt a platforma

Platforma delí build na dve časti a túto myšlienku stojí za to ukradnúť aj pre malý projekt. Koreňový `CMakeLists.txt` produktu je minimálny vstupný bod a všetko komplikované žije v samostatnom skripte, ktorý je **verzovaný a zdieľaný** (submodul Gitu) a ktorý koreň includuje:

```cmake
include(${CMAKE_CURRENT_LIST_DIR}/CMake/Build.cmake)
```

Skript platformy pozná typy buildu (`Debug`, `Release`, `UnitTest`, `IntegrationTest`), kontroly parametrov, toolchain, include cesty a registráciu modulov. Produkt dopĺňa iba to, čo je preň špecifické. Oprava buildu je potom nová verzia submodulu, nie úprava desiatich produktov. Príklad nižšie má obe časti v jednom projekte, aby bol krátky, ale zachováva rovnaké oddelenie: `cmake/` je „platforma“ a `CMakeLists.txt` je „produkt“.

## Ukážkový projekt

```text
cmake/
  arm-none-eabi.cmake       toolchain file
  Flags.cmake               flags with names
Bsp/Startup/                startup code and the linker script (see the article about main())
Middlewares/Temperature/    a module as a library (see the article about file organization)
Application/                main.c
CMakeLists.txt
```

## Toolchain file: kompilátor nie je PC

CMake predpokladá, že zostavujete pre počítač, pri ktorom sedíte. Toolchain file hovorí niečo iné:

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

Riadok, na ktorý ľudia zabúdajú, je `CMAKE_TRY_COMPILE_TARGET_TYPE`. Na začiatku CMake zostaví testovací program, aby overil, že kompilátor funguje, a bare-metal kompilátor nevie zlinkovať program pre PC (nie je operačný systém, nie je `main`, ktorý by niekto volal). Ak je cieľom kontroly statická knižnica, test prejde. Toolchain sa zadáva na príkazovom riadku, raz, pri vytvorení build priečinka:

```bash
cmake -S . -B build-debug -G Ninja \
      -DCMAKE_TOOLCHAIN_FILE=cmake/arm-none-eabi.cmake -DCMAKE_BUILD_TYPE=Debug
cmake --build build-debug
```

Rovnaký zdrojový priečinok s iným `-B` je iný build: `build-release` vedľa neho alebo build pre unit testy na PC, bez toolchain file.

## Flagy s menami

Riadok ako `-mcpu=cortex-m4 -mthumb -mfloat-abi=soft -ffunction-sections ...` sa ťažko kontroluje, pretože nikto nevie, ktorá jeho časť je dôležitá. Platforma má súbor `Flags.cmake` s premennou pre každý flag a s komentárom (`THUMB_MODE`, `ENABLE_ALL_WARNINGS`, `REMOVE_UNUSED_FUNCTIONS`, `ENABLE_GC_SECTIONS`, `PRINT_MEMORY_USAGE` a tak ďalej, plus varianty CPU a FPU od Cortex-M0 po M85). Projekt sa potom číta ako veta. Môj obsahuje len to, čo príklad potrebuje:

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

Celý koreňový súbor príkladu, 80 riadkov:

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

Vysvetlím niekoľko riadkov, od ktorých závisí, či bude firmware správny.

**Typy buildu s explicitnými flagmi.** Sú len dva, `Debug` (`-Og -g3`: dosť rýchly a laditeľný) a `Release` (`-Os -g0`: malý a bez ladiacich informácií) a čokoľvek iné zastaví konfiguráciu s chybovou hláškou. Platforma má ďalšie dva, `UnitTest` a `IntegrationTest`: v prvom z nich sa `TARGET_MCU` ani nevyžaduje, pretože sa zostavuje pre PC.

**Predvolené flagy CMake.** Toto je pasca. CMake pridáva do každej konfigurácie vlastné flagy, `-O3 -DNDEBUG` pre `Release` a `-g` pre `Debug`, pred vaše vlastné. V prvej verzii príkladu vyzeral kompilačný príkaz release takto:

```text
-O3 -DNDEBUG -std=gnu11 -mcpu=cortex-m4 ... -Os -g0 -ffunction-sections ...
```

Posledné `-O` vyhráva, takže to bolo `-Os`, ale `-DNDEBUG` (ktoré vypína `assert()`) tam bolo, hoci som oň nikdy nepožiadal. Ak chcete vedieť, čo zostavujete, vymažte predvolené hodnoty (`set(CMAKE_C_FLAGS_RELEASE "")`) a všetko napíšte do vlastného súboru. Spôsob, ako vidieť, čo skutočne ide do kompilátora, je `compile_commands.json`, ktorý vytvorí voľba `CMAKE_EXPORT_COMPILE_COMMANDS`: je to aj súbor, ktorý čítajú editory a `clang-tidy`.

**Startup kód je knižnica `OBJECT`.** Objekty takej knižnice sa dostanú do spustiteľného súboru priamo, bez spoliehania sa na to, že ich linker vytiahne z archívu.

**Linker script je závislosť** (`LINK_DEPENDS`): keď sa zmení, firmware sa zlinkuje znova.

## Moduly sú knižnice

Každý modul je statická knižnica so zoznamom svojich **vlastných** zdrojákov a verejných hlavičiek ([článok o organizácii súborov](/blog/file-organization-embedded-c) vysvetľuje prečo). Aplikácia knižnicu zlinkuje a dostane s ňou include cestu k verejným hlavičkám a nič iné. V súbore CMake modulu nie je `file(GLOB ...)`: zdrojáky sú vymenované jeden po druhom, takže nový súbor je viditeľná zmena v pull requeste a súbor, ktorý v priečinku zostal omylom, sa do firmvéru nedostane.

## `TARGET_MCU`: jeden názov, viac definícií

Buildy platformy sa spúšťajú s `-DTARGET_MCU=STM32G474xE`. Skript rozloží názov regulárnym výrazom a z jedného parametra vytvorí definície pre kód (`STM32G474xx` a `STM32G4xx`), ktoré hlavičky výrobcu používajú na výber správneho zariadenia. Rovnaká logika spustená na štyroch názvoch:

```text
STM32G474xE  ->  MCU_ID STM32G474xx, MCU_FAMILY_ID STM32G4xx
STM32U5A5xx  ->  MCU_ID STM32U5A5xx, MCU_FAMILY_ID STM32U5xx
STM32F407VG  ->  MCU_ID STM32F407xx, MCU_FAMILY_ID STM32F4xx
STM32H563ZI  ->  MCU_ID STM32H563xx, MCU_FAMILY_ID STM32H5xx
```

To je spojenie s článkom o [rodinách STM32 a vetvách](/blog/bsp-stm32-families-git-branches): rodina rozhoduje, ktorá vetva BSP je v strome, a názov MCU rozhoduje o definíciách a linker scripte.

## Čo vám povie linker

`-Wl,--print-memory-usage` na konci každého linkovania vypíše, koľko z ktorej pamäte je využité, `-Wl,-Map=firmware.map` zapíše adresu všetkého a krok po builde vypíše veľkosť:

```text
Memory region         Used Size  Region Size  %age Used
           FLASH:         276 B         1 MB      0.03%
             RAM:           8 B       128 KB      0.01%
   text	   data	    bss	    dec	    hex	filename
    276	      0	      8	    284	    11c	firmware.elf
```

Dva experimenty, ktoré som s týmito číslami urobil, ukazujú, prečo sú flagy v builde a nie v niekoho hlave.

**Linker vie zahodiť to, čo nikto nevolá.** S `-ffunction-sections -fdata-sections` je každá funkcia vo vlastnej sekcii a `-Wl,--gc-sections` dovolí linkeru odstrániť nereferencované. Príklad má funkciu `Unused_Checksum()`, ktorú nikto nevolá:

| Build | Veľkosť kódu |
|---|---|
| Release, bez flagov sekcií a bez `--gc-sections` | 324 B |
| Release, s nimi (`-DGC_SECTIONS=ON`) | **276 B** |

Rozdiel 48 bajtov je presne funkcia kontrolného súčtu. V reálnom projekte s knižnicou od výrobcu, ktorá má stovky funkcií a vy volíte desať, je rozdiel v kilobajtoch.

**Kompilátor vie pridať pamäť za vaším chrbtom.** Prvý release build príkladu mal **772 B**, takmer trikrát viac než debug build (288 B). Map súbor ukázal `memcpy` a `memset` zo štandardnej knižnice. Príčina: keď je optimalizácia zapnutá, GCC rozpozná cykly v startup kóde (kopírovanie `.data` a nulovanie `.bss`) ako kopírovanie a vyplnenie a nahradí ich volaniami týchto dvoch funkcií, ktoré potom prinesú svoj kód z knižnice. Opraví to jeden flag na startup objekte a výsledok je **276 B**:

```cmake
target_compile_options(Startup PRIVATE -fno-tree-loop-distribute-patterns)
```

Okrem veľkosti je tu druhý dôvod, prečo sa o to starať: startup kód beží *skôr*, než je pamäť inicializovaná, a čím menej knižničného kódu používa, tým menej sa môže pokaziť (pozrite si článok o tom, [čo sa deje pred `main()`](/blog/before-main-startup-linker)).

## Po linkovaní: čo flashujete a čo testujete

Príkaz `POST_BUILD` vytvorí z ELF súboru `firmware.bin` a `firmware.hex` (formáty, ktoré čítajú programátory) a vypíše veľkosť. Posledná časť príkladu je test: `add_test` spustí firmware v QEMU a `ctest` skontroluje, že vypísal očakávaný text:

```bash
ctest --test-dir build-debug
```

```text
1/1 Test #1: firmware_runs_in_qemu ............   Passed    0.05 sec

100% tests passed, 0 tests failed out of 1
```

Je to *smoke test* (naštartuje firmware a dostane sa do svojho `main()`?) a beží zlomok sekundy pri každom commite. Nenahrádza test na hardvéri, ale build, ktorý nenaštartuje, sa nájde v CI a nie pri stole. Testy modulov na PC sú iný build toho istého projektu CMake (ukazuje ho [článok o Unity a CMock](/blog/unit-testing-unity-cmock)).

## Checklist

1. Toolchain file a `CMAKE_TRY_COMPILE_TARGET_TYPE STATIC_LIBRARY`.
2. Flagy v jednom súbore s menami, predvolené hodnoty konfigurácií CMake vymazané.
3. Každý modul je knižnica s explicitným zoznamom zdrojákov a verejných hlavičiek.
4. `-ffunction-sections -fdata-sections` a `--gc-sections`, vždy.
5. `--print-memory-usage` a map súbor pri každom linkovaní, po ňom `size`.
6. `compile_commands.json` pre editor a statickú analýzu.
7. Linker script je závislosť firmvéru.
8. Smoke test v simulátore v CI.
9. Občas sa pozrite na veľkosť *release* buildu. Ak rastie bez dôvodu, map súbor vie prečo.
