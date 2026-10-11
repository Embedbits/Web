---
title: "Doxygen для embedded C: документація, про яку неможливо забути"
slug: doxygen-embedded-c
date: 2026-10-06T20:00:00
authors: [Mr.Nobody]
tags: [embedded, c, cmake]
---

У кожного проєкту є документація, і в кожного проєкту є документація, яка бреше. Word-файл з описом інтерфейсу був правильним у тиждень, коли його писали. Коментар над функцією чесніший, бо він за кілька рядків від коду, який описує, але його пишуть ті самі люди, які забувають. Вихід не в більшій дисципліні, а в **інструменті, який читає коментарі, будує з них документацію й ламає збірку, коли чогось бракує**. Цей інструмент - Doxygen.

Ця стаття показує, як у моїх проєктах виглядає задокументований модуль, як його генерують і як зробити документацію частиною CI, яку не можна оминути. Приклади зібрано з Doxygen 1.9.8 та Graphviz, а виводи - справжні.

<!-- truncate -->

## Що документувати, а що ні

У моєму [стилі кодування](/docs/platform/embi-platform/coding-style) цьому присвячено один абзац: коментарі у стилі Doxygen для всіх **публічних** функцій, типів і макросів, англійською, короткі й точні, *чому*, а не *що*. Кілька прикладів різниці:

| Коментар, який нічого не коштує | Коментар, який допомагає |
|---|---|
| `/* initializes the module */` | `Clears the filter and marks the value as not valid. The module does not report a value until Temperature_Task() has run at least once.` |
| `/* returns the value */` | `Returns TEMPERATURE_REQUEST_OK if a valid value is available, TEMPERATURE_REQUEST_ERROR if the task has not run yet.` |
| `/* value */` (для параметра) | `Filtered temperature in tenths of a degree Celsius. Must not be NULL. Written only if the function returns TEMPERATURE_REQUEST_OK.` |

Перша колонка повторює назву функції, яку читач і так бачить. Друга каже те, чого читач **не бачить**: одиницю виміру, допустимий діапазон, хто володіє пам'яттю, чи записується вихідне значення у випадку помилки, звідки можна викликати функцію, що треба зробити перед цим. Для embedded-інтерфейсу це також місце для інформації, яку небезпечно вгадувати: *чи безпечно викликати з переривання*, *як довго функція може блокувати*, *чи може вказівник бути NULL*.

## Модуль у файлах платформи

Шаблони EmBi_Platform, з яких починається кожен модуль, мають однаковий скелет документації: заголовок файлу з `\author`, `\file`, `\ingroup` та `\brief`, а над кожною функцією блок з `\brief`, описом і `\return`. Шаблон скінченного автомата додає `\pre` для передумов і блок `\par Used global variables` зі списком змінних, які функція читає (`in`), записує (`out`) або й те, й інше (`in,out`). Це напрочуд корисний вид документації: потік даних функції в трьох рядках.

Увесь модуль - це одна **група** в Doxygen. `\ingroup Temperature` у кожному файлі каже, що файл належить модулю, а сама група визначається один раз, у port-файлі:

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

Типи мають короткий опис самого типу та кожного значення (коментар `/**< ... */` після члена документує цей член у тому самому рядку):

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

## Генерація

Doxygen налаштовується файлом з кількома сотнями опцій. Писати його вручну - помилка, якої легко уникнути: платформа має цей файл як шаблон (`Doxyfile.in` в артефакті Doxygen) і заповнює його зі змінних CMake, а проєкти задають лише ті, що відрізняються від типових. Те саме можливо й за допомогою власного модуля CMake, і ось уся конфігурація прикладу:

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

а збірка - це одна ціль:

```bash
cmake -S . -B build -G Ninja
cmake --build build --target docs
```

Результат - тека зі сторінками HTML. Група модуля з файлами, що до неї належать, та описом із port-файлу виглядає так:

![Сторінка групи Temperature у згенерованій HTML-документації](/img/blog/doxygen-module-group.png)

Doxygen також малює **граф включень** (include graph) кожного файлу, а також **граф викликів** (call graph) і **граф викликачів** (caller graph) кожної задокументованої функції (`HAVE_DOT`, Graphviz: ось чому платформа має для нього артефакт). На графи включень варто час від часу поглядати: стрілка від файлу застосунку до внутрішнього заголовка модуля - це та сама проблема, яку описує [стаття про організацію файлів](/blog/file-organization-embedded-c), лише побачена згори.

## Документація як тест

Саме ця частина змінює дисципліну. Чотири опції перетворюють відсутню документацію із «варто б» на «збірка червона»:

```cmake
set(DOXYGEN_WARN_IF_UNDOCUMENTED   YES)   # a public member without a description
set(DOXYGEN_WARN_IF_DOC_ERROR      YES)   # a wrong tag, a parameter that does not exist
set(DOXYGEN_WARN_NO_PARAMDOC       YES)   # a function whose parameters are not described
set(DOXYGEN_WARN_AS_ERROR          FAIL_ON_WARNINGS)
```

З `FAIL_ON_WARNINGS` Doxygen проходить усе, виводить **усі** попередження й лише потім завершується з помилкою (простий `YES` зупиняється на першому). Я спробував: видалив опис `Temperature_Task()` та `\param` у `Temperature_Get_Value()` з port-файлу, і збірка відповіла:

```text
Temperature/Temperature_Port.h:40: error: Member Temperature_Task(void) (function) of file Temperature_Port.h is not documented.
Temperature/Temperature_Port.h:45: error: parameters of member Temperature_Get_Value are not documented
ninja: build stopped: subcommand failed.
```

(Код завершення команди - 1, тож CI червоний.) Коли описи повернуто, та сама збірка завершується без жодного виводу й з кодом 0. Нова функція без коментаря тепер не може випадково потрапити в головну гілку, і нікому не треба бути тим, хто пам'ятає про це на рев'ю.

## Що містить добра документація інтерфейсу

Для кожної функції публічного інтерфейсу перевірте список:

1. **Що вона робить** - одним реченням, із дієсловом (`\brief`).
2. **Параметри**: напрямок (`[in]`, `[out]`, `[in,out]`), одиниця виміру, діапазон, чи дозволено `NULL`.
3. **Значення, що повертається**: кожне можливе значення та що воно означає.
4. **Передумови** (`\pre`): що треба зробити раніше, наприклад ініціалізацію.
5. **Контекст**: чи можна викликати з переривання, чи блокує, скільки часу виконується.
6. **Побічні ефекти**: що ще вона змінює (глобальний стан, периферію).

Якщо функція не має відповіді на одне з цих запитань, відповідь лежить у коді, і читач мусить його читати. Це ознака того, що інтерфейс не завершений, а вправа з написання коментаря часто й виявляється моментом, коли ви це помічаєте.

## Де це вписується в платформу

Кожен модуль платформи має в своєму `CMakeLists.txt` виклик, який реєструє його теку для документації (коли артефакт Doxygen доступний у проєкті), а кореневий білд має опцію `DOXYGEN_ENABLED`. Отже, документація всього firmware генерується тією самою збіркою, що й firmware: `-DDOXYGEN_ENABLED=ON`. Артефакти (Doxygen і Graphviz) завантажуються у версії, яку зафіксував проєкт, тому сторінки сьогодні й наступного року виглядають однаково.

## Чекліст

1. Кожна публічна функція, тип і макрос має опис. Внутрішні - лише там, де не очевидно.
2. Опис каже те, чого читач не бачить у сигнатурі: одиниці, діапазони, контекст, помилки.
3. Одна група на модуль (`\defgroup` у port-файлі, `\ingroup` в інших).
4. `WARN_IF_UNDOCUMENTED`, `WARN_NO_PARAMDOC` і `FAIL_ON_WARNINGS` у CI.
5. Графи ввімкнені, і хтось час від часу дивиться на граф включень застосунку.
6. Документація генерується тією самою збіркою, що й firmware, із зафіксованими інструментами.
