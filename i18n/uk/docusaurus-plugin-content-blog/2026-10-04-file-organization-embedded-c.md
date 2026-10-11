---
title: "Організація файлів у вбудованому C: як тека стає модулем"
slug: file-organization-embedded-c
date: 2026-10-04T14:00:00
authors: [Mr.Nobody]
tags: [embedded, architecture, c]
---

Мій [стиль кодування](/docs/platform/embi-platform/coding-style) каже, що імена файлів починаються з імені модуля і що «повна організація файлів описана в іншому місці». Ось це інше місце.

У C немає `private`, просторів імен і пакетів. Щойно код розділено на файли, файли та система збірки — **єдині** інструменти, які в нас є, щоб сказати, що належить разом, що є публічним, а що нікого більше не стосується. Тож організація файлів — це не питання смаку, а частина дизайну. Ця стаття описує, як я організовую вбудований проєкт на трьох рівнях: проєкт, модуль і окремий файл.

<!-- truncate -->

## Рівень 1: проєкт

Проєкт, створений за допомогою EmBi_Platform, щоразу має однакову структуру:

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

Кожна тека відповідає на одне питання, і ця відповідь — причина, чому код живе саме там.

**Application** — це те, що відрізняє продукт від усіх інших продуктів на тому самому MCU. Він має власні внутрішні шари, і їхні назви — це рівні «дерева» зі [статті про архітектуру](/blog/design-architecture): `AppMain` усе запускає, `AppCore` — верхівка дерева з логікою всього пристрою, `AppFun` містить окремі функціональності, `AppComp` — низькорівневі компоненти, з яких вони складені, а `AppCom` — комунікацію із зовнішнім світом. Виклики йдуть згори вниз, ніколи навпаки.

**Middlewares** мають два місця для кожного компонента, і це зроблено навмисно. `ThirdParty/FreeRTOS` — це код вендора, підключений як Git submodule у вибраній вами версії, і його **ніколи не редагують**. Усе, що є вашим (port-шар, конфігурація), живе поруч у `Middlewares/FreeRTOS` і не перезаписується, коли ви переходите на іншу версію коду вендора. Коли вендор випускає виправлення, ви оновлюєте submodule, а не пропатчену копію.

**Bsp** описано в [документації BSP](/docs/bsp), а коротка версія така: `Ral` знає регістри, `Mcal` — периферію, а `Hal` — плату. Кожне сімейство STM32 має власну гілку BSP, тому теки виглядають однаково для кожного MCU.

**EmBi_Platform** і **STM32CubeIDE** — це інструменти. Вони не потрапляють у бінарний файл, а проєкт IDE генерується, тож його можна викинути й створити заново.

## Рівень 2: модуль

Модуль — це тека з фіксованим набором файлів. Створювати їх вручну не потрібно, платформа генерує їх сама (див. кінець статті), і результат виглядає так:

```text
Temperature/
├── CMakeLists.txt
├── Temperature_Types.h
├── Temperature_Port.h
├── Temperature.h
├── Temperature.c
└── Temperature_Filter.c     (a component, see below)
```

| Файл | Роль | Хто може його підключати |
|---|---|---|
| `Temperature_Types.h` | Публічні типи, перелічення та макроси | усі |
| `Temperature_Port.h` | Публічні функції: **єдина** точка входу в модуль | усі |
| `Temperature.h` | Внутрішні типи та функції, спільні для файлів модуля | лише сам модуль |
| `Temperature.c` | Реалізація | (вихідний файл) |
| `CMakeLists.txt` | Створює статичну бібліотеку `Temperature_Lib` | збірка |

Ідея в тому, що користувач модуля читає **два** файли і більше нічого. Перший — це типи (згенерований файл також містить тип версії та звичайні перелічення для станів запиту й функції, тут я скоротив його до того, що потрібно для прикладу):

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

Другий — це порт, який є всім інтерфейсом модуля. Усього, чого тут немає, для інших не існує:

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

Внутрішній заголовок містить дані та функції, які потрібні файлам модуля спільно і яких ніхто ззовні ніколи не повинен бачити:

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

А реалізація використовує все це:

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

Зверніть увагу, що стан є `static` у `.c`-файлі. Глобальної змінної немає, отже, немає й `extern` (який мій стиль кодування забороняє). Єдиний шлях до даних — функція `Temperature_Get_Value()`, геттер, який також повідомляє викликачу, чи дійсне значення.

### Система збірки робить файл інкапсуляцією

«Підключайте лише порт» було б просто побажанням, якби цього ніщо не забезпечувало. Забезпечує `CMakeLists.txt` кожного модуля. Він збирає статичну бібліотеку і **копіює лише публічні заголовки** в окрему теку в каталозі збірки. Лише ця тека потрапляє в include path користувачів бібліотеки:

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

(Це спрощена версія шаблону, який генерує платформа, що також опрацьовує залежності між бібліотеками та шляхи Doxygen.) Тепер застосунок лише лінкує `Temperature_Lib`:

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

Я спробував, що буде, якщо застосунок підключить внутрішній заголовок модуля, і компілятор каже те, що ви від нього хочете почути:

```text
AppMain_Cheat.c:1:10: fatal error: Temperature.h: No such file or directory
```

Тека з публічними заголовками в каталозі збірки містить рівно два файли: `Temperature_Port.h` і `Temperature_Types.h`.

**Чесне застереження:** це захист системи збірки, а не мови. Якщо хтось напише `#include "../../Middlewares/Temperature/Temperature.h"`, воно скомпілюється без жодних скарг (це я теж пробував). Лік дешевий: відхиляйте в CI відносні шляхи з `..` в include.

```bash
grep -rEn '#include "[^"]*\.\./' Application Middlewares/*/ && exit 1
```

### Коли модуль росте: компоненти

Модуль з тисячею рядків в одному файлі — наступна проблема. Відповідь — **компонент**: ще одна пара файлів `Module_Component.c/.h` у тій самій теці. У прикладі вище це фільтр:

```c title="Temperature_Filter.c"
#include "Temperature.h"

static temperature_Value_t lastValue;

temperature_Value_t Temperature_Filter_Apply( temperature_Value_t rawValue )
{
    lastValue = (temperature_Value_t)((lastValue + rawValue) / 2);
    return lastValue;
}
```

Заголовок компонента також внутрішній (його немає у списку публічних заголовків), тож компонент можна замінити або розділити так, що ніхто цього не помітить. Користувач модуля й надалі бачить ті самі два файли. Правило, що ім'я файлу починається з імені модуля, робить компонент помітним у будь-якому списку файлів, а ім'я функції `Temperature_Filter_Apply()` підказує, де її шукати.

## Рівень 3: усередині файлу

Кожен `.c`- і `.h`-файл, згенерований платформою, має однаковий каркас із банером для кожної секції в однаковому порядку:

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

Це схоже на прикрасу, а насправді — карта. Коли ви відкриваєте файл, якого ніколи не бачили, ви знаєте, що локальні змінні в п'ятій секції, а обробники переривань — у десятій, і вам не потрібно читати файл, щоб їх знайти. Заголовки мають ту саму ідею, загорнуту в include guard і в `extern "C"` для користувачів C++:

- guard має вигляд `MODULE_FILE_H`, наприклад `TEMPERATURE_TEMPERATURE_PORT_H`,
- заголовок Doxygen (`\file`, `\ingroup`, `\brief`) є на початку кожного файлу, тож документація модуля генерується з тієї самої теки,
- підключення впорядковані так: `<system>`, потім проєкт, потім модуль.

## Одне ім'я скрізь

Сила цієї організації в тому, що ім'я модуля скрізь однакове, тож ім'я можна вгадати, не шукаючи його:

| Що | Приклад |
|---|---|
| Тека | `Temperature/` |
| Бібліотека в CMake | `Temperature_Lib` |
| Файли | `Temperature.c`, `Temperature_Port.h`, `Temperature_Types.h` |
| Функції | `Temperature_Init()`, `Temperature_Get_Value()` |
| Типи | `temperature_Value_t`, `temperature_RequestState_t` |
| Макроси та перелічувані значення | `TEMPERATURE_REQUEST_OK` |
| Include guard | `TEMPERATURE_TEMPERATURE_PORT_H` |

Якщо ви бачите `Gpio_Set_PinLevel()` у стеку викликів, ви знаєте, що вона в теці `Gpio`, у бібліотеці `Gpio_Lib`, а її типи починаються з `gpio_`.

### Один життєвий цикл для кожного модуля

Згенерований модуль постачається з чотирма функціями, які має кожен модуль: `Get_ModuleVersion()`, `Init()`, `Deinit()` і `Task()`. `Init` налаштовує модуль і обробляє власні збої, `Task` викликається періодично з основного циклу або з планувальника. Наслідок у тому, що код нагорі (`AppMain`) може поводитися з усіма модулями однаково, а новому модулю не потрібна нова концепція.

## Створення модуля

Ці файли не створюють вручну. Інструменти проєкту платформи (пункт меню *Create module*, описаний на сторінці [Project tools](/docs/platform/embi-platform/cmake-helpertools)) запитують назву та розташування й генерують теку з усіма файлами вище та `CMakeLists.txt`. Пункт *Add component* додає пару `Module_Component.c/.h` до наявного модуля. Модуль, що був згенерований раз, ніколи не перезаписується, тож інструмент можна безпечно запускати знову.

## Правила коротко

1. Один модуль — одна тека, і в нього є власна бібліотека.
2. Інші модулі підключають **лише** `Module_Port.h` і `Module_Types.h`.
3. Внутрішніх заголовків немає у списку публічних заголовків.
4. Дані — `static` у `.c`-файлі, доступ — через функції. Ніяких `extern`-змінних.
5. Ім'я файлу починається з імені модуля, так само як і кожна функція, тип і макрос.
6. Код вендора ніколи не редагується. Ваші зміни живуть у теці обробника поруч із ним.
7. Виклики в шарах ідуть вниз, ніколи вгору.
8. Усе у файлі розташоване у своїй секції, в однаковому порядку.

Жодне з цих правил не хитре. Суть у тому, що всі вони однакові в усіх модулях, тож прочитавши один модуль, ви знаєте, як читати всі інші. Це також причина, чому платформа генерує файли: конвенція, дотримання якої потребує зусиль, — це конвенція, яку не дотримуються.

Ті самі ідеї з іншої точки зору є у статтях про [принципи SOLID](/blog/solid-principles-c-cpp) (заголовок порту — це інтерфейс, від якого залежать інші модулі) і про [MISRA C](/blog/misra-c-rules-in-practice) (кілька правил значно легше дотримуватися, коли код організований так).
