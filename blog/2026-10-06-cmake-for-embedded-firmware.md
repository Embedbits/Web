---
title: "CMake for embedded firmware: a build that you can read"
slug: cmake-for-embedded-firmware
date: 2026-10-06T18:00:00
authors: [Mr.Nobody]
tags: [embedded, cmake, stm32]
---

An IDE project is a file that nobody reads: a few thousand lines of XML that the IDE writes and the IDE reads, and that nobody can review in a pull request. The build then exists only on the computer where somebody clicked it together. CMake solves it with a different philosophy: **the build is a text that you read, review, version and run in the CI** exactly the same way as on your desk.

The build system of the Embedbits platform (EmBi_Platform) is made in CMake, and this article explains the pieces that every embedded CMake build needs, on a small project that I built and ran: a toolchain file, flags with names, build types, the modules as libraries, the linker script, the files after the link and a test that runs the firmware in a simulator. All numbers and outputs are real.

<!-- truncate -->

## Two layers: the project and the platform

The platform splits the build into two parts, and the idea is worth stealing even for a small project. The root `CMakeLists.txt` of the product is a minimal entry point, and everything complicated lives in a separate script that is **versioned and shared** (a Git submodule), which the root includes:

```cmake
include(${CMAKE_CURRENT_LIST_DIR}/CMake/Build.cmake)
```

The platform script knows the build types (`Debug`, `Release`, `UnitTest`, `IntegrationTest`), the checks of the parameters, the toolchain, the include paths and the registration of the modules. The product only fills in what is specific for it. A fix of the build is then a new version of the submodule and not an edit of ten products. The example below has both parts in one project to be short, but it keeps the same separation: `cmake/` is the "platform" and `CMakeLists.txt` is the "product".

## The example project

```text
cmake/
  arm-none-eabi.cmake       toolchain file
  Flags.cmake               flags with names
Bsp/Startup/                startup code and the linker script (see the article about main())
Middlewares/Temperature/    a module as a library (see the article about file organization)
Application/                main.c
CMakeLists.txt
```

## The toolchain file: the compiler is not the PC

CMake assumes that you build for the computer that you sit at. A toolchain file says otherwise:

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

The line that people forget is `CMAKE_TRY_COMPILE_TARGET_TYPE`. At the beginning CMake builds a test program to check that the compiler works, and a bare-metal compiler cannot link a program for a PC (there is no operating system, no `main` that is called by anybody). With a static library as the target of the check, the test passes. The toolchain is given on the command line, once, when the build folder is created:

```bash
cmake -S . -B build-debug -G Ninja \
      -DCMAKE_TOOLCHAIN_FILE=cmake/arm-none-eabi.cmake -DCMAKE_BUILD_TYPE=Debug
cmake --build build-debug
```

The same source folder with another `-B` is another build: a `build-release` next to it, or one for the unit tests on the PC, without the toolchain file.

## Flags with names

A line like `-mcpu=cortex-m4 -mthumb -mfloat-abi=soft -ffunction-sections ...` is hard to review, because nobody knows which part of it is important. The platform has a file `Flags.cmake` with a variable for every flag, with a comment (`THUMB_MODE`, `ENABLE_ALL_WARNINGS`, `REMOVE_UNUSED_FUNCTIONS`, `ENABLE_GC_SECTIONS`, `PRINT_MEMORY_USAGE` and so on, plus the CPU and FPU variants from the Cortex-M0 to the M85). The project then reads like a sentence. Mine has only what the example needs:

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

## The CMakeLists.txt

The whole root file of the example, 80 lines:

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

Let me explain a few lines that decide whether the firmware will be right.

**Build types with explicit flags.** There are only two, `Debug` (`-Og -g3`: fast enough and debuggable) and `Release` (`-Os -g0`: small and without the debug information), and anything else stops the configuration with an error message. The platform has two more, `UnitTest` and `IntegrationTest`: in the first one the `TARGET_MCU` is not even needed, because it builds for the PC.

**The default flags of CMake.** This is a trap. CMake adds its own flags to each configuration, `-O3 -DNDEBUG` for `Release` and `-g` for `Debug`, before your own. In the first version of the example the compile command of the release looked like this:

```text
-O3 -DNDEBUG -std=gnu11 -mcpu=cortex-m4 ... -Os -g0 -ffunction-sections ...
```

The last `-O` wins, so it was `-Os`, but the `-DNDEBUG` (which switches the `assert()` off) was there although I never asked for it. If you want to know what you build, clear the defaults (`set(CMAKE_C_FLAGS_RELEASE "")`) and write everything in your own file. The way to see what really goes to the compiler is `compile_commands.json`, which the `CMAKE_EXPORT_COMPILE_COMMANDS` option creates: it is also the file that the editors and `clang-tidy` read.

**The startup code is an `OBJECT` library.** The objects of such a library are put into the executable directly, without relying on the linker to pull them out of an archive.

**The linker script is a dependency** (`LINK_DEPENDS`): when it changes, the firmware is linked again.

## The modules are libraries

Each module is a static library with a list of its **own** sources and its public headers ([the article about the file organization](/blog/file-organization-embedded-c) explains why). The application links the library, and with it gets the include path of the public headers and nothing else. In the CMake file of the module there is no `file(GLOB ...)`: the sources are listed one by one, so a new file is a visible change in a pull request and a file that is left in the folder by accident does not end up in the firmware.

## `TARGET_MCU`: one name, several definitions

The platform builds are started with `-DTARGET_MCU=STM32G474xE`. The script takes the name apart with a regular expression, and from one parameter it makes the definitions for the code (`STM32G474xx` and `STM32G4xx`), which the vendor headers use to select the right device. The same logic, run on four names:

```text
STM32G474xE  ->  MCU_ID STM32G474xx, MCU_FAMILY_ID STM32G4xx
STM32U5A5xx  ->  MCU_ID STM32U5A5xx, MCU_FAMILY_ID STM32U5xx
STM32F407VG  ->  MCU_ID STM32F407xx, MCU_FAMILY_ID STM32F4xx
STM32H563ZI  ->  MCU_ID STM32H563xx, MCU_FAMILY_ID STM32H5xx
```

This is the link to the article about the [STM32 families and the branches](/blog/bsp-stm32-families-git-branches): the family decides which branch of the BSP is in the tree, and the MCU name decides the definitions and the linker script.

## What the linker tells you

`-Wl,--print-memory-usage` prints at the end of every link how much of each memory is used, `-Wl,-Map=firmware.map` writes the address of everything, and the post-build step prints the size:

```text
Memory region         Used Size  Region Size  %age Used
           FLASH:         276 B         1 MB      0.03%
             RAM:           8 B       128 KB      0.01%
   text	   data	    bss	    dec	    hex	filename
    276	      0	      8	    284	    11c	firmware.elf
```

Two experiments that I did with these numbers show why the flags are in the build and not in somebody's head.

**The linker can throw away what nobody calls.** With `-ffunction-sections -fdata-sections` every function is in its own section, and `-Wl,--gc-sections` lets the linker remove the unreferenced ones. The example has a function `Unused_Checksum()` that nobody calls:

| Build | Code size |
|---|---|
| Release, without the section flags and without `--gc-sections` | 324 B |
| Release, with them (`-DGC_SECTIONS=ON`) | **276 B** |

The 48 bytes difference is exactly the checksum function. In a real project with a vendor library, which has hundreds of functions of which you call ten, the difference is in kilobytes.

**The compiler can add memory behind your back.** The first release build of the example had **772 B**, almost three times more than the debug build (288 B). The map file showed `memcpy` and `memset` from the standard library. The cause: when the optimization is on, GCC recognizes the loops in the startup code (the copy of `.data` and the zeroing of `.bss`) as a copy and a fill, and replaces them with calls of these two functions, which then come with their code from the library. One flag on the startup object fixes it, and the result is **276 B**:

```cmake
target_compile_options(Startup PRIVATE -fno-tree-loop-distribute-patterns)
```

Apart from the size, there is a second reason to care: the startup code runs *before* the memory is initialized, and the less library code it uses, the less can go wrong (see the article about [what happens before `main()`](/blog/before-main-startup-linker)).

## After the link: what you flash, and what you test

The `POST_BUILD` command makes `firmware.bin` and `firmware.hex` (the formats that the programmers read) from the ELF file and prints the size. The last part of the example is a test: `add_test` runs the firmware in QEMU and `ctest` checks that it printed the expected text:

```bash
ctest --test-dir build-debug
```

```text
1/1 Test #1: firmware_runs_in_qemu ............   Passed    0.05 sec

100% tests passed, 0 tests failed out of 1
```

It is a *smoke test* (does the firmware start and reach its `main()`?), and it runs in a fraction of a second on every commit. It does not replace a test on the hardware, but a build that does not start is found in the CI and not at the desk. The tests of the modules on the PC are a different build of the same CMake project (the [article about Unity and CMock](/blog/unit-testing-unity-cmock) shows one).

## A checklist

1. A toolchain file, and `CMAKE_TRY_COMPILE_TARGET_TYPE STATIC_LIBRARY`.
2. The flags in one file with names, the CMake defaults of the configurations cleared.
3. Each module is a library with an explicit list of sources and public headers.
4. `-ffunction-sections -fdata-sections` and `--gc-sections`, always.
5. `--print-memory-usage` and the map file in every link, `size` after it.
6. `compile_commands.json` for the editor and the static analysis.
7. The linker script is a dependency of the firmware.
8. A smoke test in a simulator in the CI.
9. Look at the size of the *release* build from time to time. If it grows without a reason, the map file knows why.
