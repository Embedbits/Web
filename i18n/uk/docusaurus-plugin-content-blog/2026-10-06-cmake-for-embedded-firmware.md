---
title: "CMake для embedded firmware: збірка, яку можна прочитати"
slug: cmake-for-embedded-firmware
date: 2026-10-06T18:00:00
authors: [Mr.Nobody]
tags: [embedded, cmake, stm32]
---

Проєкт в IDE - це файл, який ніхто не читає: кілька тисяч рядків XML, які IDE пише і IDE читає, і які неможливо переглянути в pull request. Збірка тоді існує лише на комп'ютері, де хтось її склікав. CMake розв'язує це іншою філософією: **збірка - це текст, який ви читаєте, рев'юїте, версіонуєте й запускаєте в CI** точнісінько так само, як і на своєму столі.

Система збірки платформи Embedbits (EmBi_Platform) зроблена на CMake, і ця стаття пояснює елементи, потрібні кожній embedded-збірці на CMake, на невеликому проєкті, який я зібрав і запустив: toolchain-файл, прапорці з іменами, типи збірки, модулі як бібліотеки, linker script, файли після лінкування та тест, що запускає firmware в симуляторі. Усі числа й виводи - справжні.

<!-- truncate -->

## Два шари: проєкт і платформа

Платформа ділить збірку на дві частини, і цю ідею варто запозичити навіть для невеликого проєкту. Кореневий `CMakeLists.txt` продукту - це мінімальна точка входу, а все складне живе в окремому скрипті, який **версіонується і є спільним** (підмодуль Git) і який корінь підключає:

```cmake
include(${CMAKE_CURRENT_LIST_DIR}/CMake/Build.cmake)
```

Скрипт платформи знає типи збірки (`Debug`, `Release`, `UnitTest`, `IntegrationTest`), перевірки параметрів, toolchain, шляхи включення та реєстрацію модулів. Продукт заповнює лише те, що специфічне для нього. Виправлення збірки - це тоді нова версія підмодуля, а не правка десяти продуктів. Приклад нижче містить обидві частини в одному проєкті для стислості, але зберігає той самий поділ: `cmake/` - це «платформа», а `CMakeLists.txt` - «продукт».

## Приклад проєкту

```text
cmake/
  arm-none-eabi.cmake       toolchain file
  Flags.cmake               flags with names
Bsp/Startup/                startup code and the linker script (see the article about main())
Middlewares/Temperature/    a module as a library (see the article about file organization)
Application/                main.c
CMakeLists.txt
```

## Toolchain-файл: компілятор - це не PC

CMake припускає, що ви збираєте для комп'ютера, за яким сидите. Toolchain-файл каже інакше:

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

Рядок, про який забувають, - `CMAKE_TRY_COMPILE_TARGET_TYPE`. На початку CMake збирає тестову програму, щоб перевірити, що компілятор працює, а bare-metal компілятор не може злінкувати програму для PC (немає операційної системи, немає `main`, який хтось викликає). Якщо ціллю перевірки є статична бібліотека, тест проходить. Toolchain задається в командному рядку один раз, коли створюється тека збірки:

```bash
cmake -S . -B build-debug -G Ninja \
      -DCMAKE_TOOLCHAIN_FILE=cmake/arm-none-eabi.cmake -DCMAKE_BUILD_TYPE=Debug
cmake --build build-debug
```

Та сама тека з вихідними кодами з іншим `-B` - це інша збірка: `build-release` поруч або збірка для модульних тестів на PC, без toolchain-файлу.

## Прапорці з іменами

Рядок на кшталт `-mcpu=cortex-m4 -mthumb -mfloat-abi=soft -ffunction-sections ...` важко рев'юїти, бо ніхто не знає, яка його частина важлива. Платформа має файл `Flags.cmake` зі змінною для кожного прапорця та коментарем (`THUMB_MODE`, `ENABLE_ALL_WARNINGS`, `REMOVE_UNUSED_FUNCTIONS`, `ENABLE_GC_SECTIONS`, `PRINT_MEMORY_USAGE` і так далі, плюс варіанти CPU та FPU від Cortex-M0 до M85). Тоді проєкт читається як речення. У моєму лише те, що потрібно для прикладу:

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

Увесь кореневий файл прикладу, 80 рядків:

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

Поясню кілька рядків, від яких залежить, чи буде firmware правильним.

**Типи збірки з явними прапорцями.** Їх лише два: `Debug` (`-Og -g3`: достатньо швидко і можна налагоджувати) та `Release` (`-Os -g0`: малий розмір і без налагоджувальної інформації), а будь-що інше зупиняє конфігурацію з повідомленням про помилку. Платформа має ще два, `UnitTest` та `IntegrationTest`: у першому `TARGET_MCU` навіть не потрібен, бо збірка йде для PC.

**Типові прапорці CMake.** Це пастка. CMake додає власні прапорці до кожної конфігурації, `-O3 -DNDEBUG` для `Release` і `-g` для `Debug`, перед вашими. У першій версії прикладу команда компіляції release виглядала так:

```text
-O3 -DNDEBUG -std=gnu11 -mcpu=cortex-m4 ... -Os -g0 -ffunction-sections ...
```

Перемагає останній `-O`, тож це був `-Os`, але `-DNDEBUG` (який вимикає `assert()`) там був, хоча я його не просив. Якщо ви хочете знати, що збираєте, очистіть типові значення (`set(CMAKE_C_FLAGS_RELEASE "")`) і напишіть усе у власному файлі. Спосіб побачити, що справді йде до компілятора, - `compile_commands.json`, який створює опція `CMAKE_EXPORT_COMPILE_COMMANDS`: це також файл, який читають редактори та `clang-tidy`.

**Startup-код - це бібліотека `OBJECT`.** Об'єкти такої бібліотеки потрапляють у виконуваний файл напряму, без покладання на те, що linker витягне їх з архіву.

**Linker script - це залежність** (`LINK_DEPENDS`): коли він змінюється, firmware лінкується знову.

## Модулі - це бібліотеки

Кожен модуль - статична бібліотека зі списком **власних** вихідних файлів і публічних заголовків ([стаття про організацію файлів](/blog/file-organization-embedded-c) пояснює чому). Застосунок лінкує бібліотеку і разом з нею отримує шлях включення публічних заголовків і більше нічого. У файлі CMake модуля немає `file(GLOB ...)`: вихідні файли перелічено по одному, тож новий файл - це видима зміна в pull request, а файл, випадково залишений у теці, не потрапить у firmware.

## `TARGET_MCU`: одне ім'я, кілька визначень

Збірки платформи запускаються з `-DTARGET_MCU=STM32G474xE`. Скрипт розбирає ім'я регулярним виразом і з одного параметра робить визначення для коду (`STM32G474xx` та `STM32G4xx`), які заголовки виробника використовують для вибору потрібного пристрою. Та сама логіка, запущена на чотирьох іменах:

```text
STM32G474xE  ->  MCU_ID STM32G474xx, MCU_FAMILY_ID STM32G4xx
STM32U5A5xx  ->  MCU_ID STM32U5A5xx, MCU_FAMILY_ID STM32U5xx
STM32F407VG  ->  MCU_ID STM32F407xx, MCU_FAMILY_ID STM32F4xx
STM32H563ZI  ->  MCU_ID STM32H563xx, MCU_FAMILY_ID STM32H5xx
```

Це зв'язок зі статтею про [родини STM32 і гілки](/blog/bsp-stm32-families-git-branches): родина вирішує, яка гілка BSP лежить у дереві, а ім'я MCU вирішує визначення та linker script.

## Що вам каже linker

`-Wl,--print-memory-usage` наприкінці кожного лінкування виводить, скільки кожної пам'яті використано, `-Wl,-Map=firmware.map` записує адресу всього, а крок post-build виводить розмір:

```text
Memory region         Used Size  Region Size  %age Used
           FLASH:         276 B         1 MB      0.03%
             RAM:           8 B       128 KB      0.01%
   text	   data	    bss	    dec	    hex	filename
    276	      0	      8	    284	    11c	firmware.elf
```

Два експерименти, які я провів із цими числами, показують, чому прапорці мають бути у збірці, а не в чиїйсь голові.

**Linker може викинути те, що ніхто не викликає.** З `-ffunction-sections -fdata-sections` кожна функція лежить у власній секції, а `-Wl,--gc-sections` дозволяє linker видалити ті, на які немає посилань. У прикладі є функція `Unused_Checksum()`, яку ніхто не викликає:

| Збірка | Розмір коду |
|---|---|
| Release, без прапорців секцій і без `--gc-sections` | 324 B |
| Release, з ними (`-DGC_SECTIONS=ON`) | **276 B** |

Різниця у 48 байтів - це саме функція контрольної суми. У справжньому проєкті з бібліотекою виробника, яка має сотні функцій, з яких ви викликаєте десять, різниця вимірюється в кілобайтах.

**Компілятор може додати пам'ять за вашою спиною.** Перша release-збірка прикладу мала **772 B**, майже втричі більше за debug-збірку (288 B). Map-файл показав `memcpy` і `memset` зі стандартної бібліотеки. Причина: коли оптимізація ввімкнена, GCC розпізнає цикли в startup-коді (копіювання `.data` і обнулення `.bss`) як копіювання й заповнення та замінює їх викликами цих двох функцій, які потім приходять зі своїм кодом з бібліотеки. Один прапорець на startup-об'єкті це виправляє, і результат - **276 B**:

```cmake
target_compile_options(Startup PRIVATE -fno-tree-loop-distribute-patterns)
```

Крім розміру, є друга причина про це дбати: startup-код виконується *до* ініціалізації пам'яті, і чим менше бібліотечного коду він використовує, тим менше може піти не так (див. статтю про [те, що відбувається перед `main()`](/blog/before-main-startup-linker)).

## Після лінкування: що ви прошиваєте і що тестуєте

Команда `POST_BUILD` створює `firmware.bin` і `firmware.hex` (формати, які читають програматори) з файлу ELF і виводить розмір. Остання частина прикладу - тест: `add_test` запускає firmware в QEMU, а `ctest` перевіряє, що воно вивело очікуваний текст:

```bash
ctest --test-dir build-debug
```

```text
1/1 Test #1: firmware_runs_in_qemu ............   Passed    0.05 sec

100% tests passed, 0 tests failed out of 1
```

Це *smoke test* (чи стартує firmware і чи доходить до свого `main()`?), і він виконується за долю секунди на кожному коміті. Він не замінює тест на hardware, але збірку, що не стартує, знаходять у CI, а не за столом. Тести модулів на PC - це інша збірка того самого проєкту CMake (одну показує [стаття про Unity і CMock](/blog/unit-testing-unity-cmock)).

## Чекліст

1. Toolchain-файл і `CMAKE_TRY_COMPILE_TARGET_TYPE STATIC_LIBRARY`.
2. Прапорці в одному файлі з іменами, типові значення конфігурацій CMake очищені.
3. Кожен модуль - бібліотека з явним списком вихідних файлів і публічних заголовків.
4. `-ffunction-sections -fdata-sections` і `--gc-sections`, завжди.
5. `--print-memory-usage` і map-файл у кожному лінкуванні, після нього `size`.
6. `compile_commands.json` для редактора та статичного аналізу.
7. Linker script - залежність firmware.
8. Smoke test у симуляторі в CI.
9. Час від часу дивіться на розмір *release*-збірки. Якщо він зростає без причини, map-файл знає чому.
