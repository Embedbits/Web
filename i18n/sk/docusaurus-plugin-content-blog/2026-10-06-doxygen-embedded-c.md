---
title: "Doxygen for embedded C: documentation that cannot be forgotten"
slug: doxygen-embedded-c
date: 2026-10-06T20:00:00
authors: [Mr.Nobody]
tags: [embedded, c, cmake]
---

Every project has documentation, and every project has documentation that lies. A Word file with the description of the interface was correct in the week when it was written. A comment above the function is more honest, because it is a few lines from the code that it describes, but it is also written by the same people who forget. The way out is not more discipline, it is a **tool that reads the comments, builds the documentation from them and fails the build when something is missing**. That tool is Doxygen.

This article shows what a documented module looks like in my projects, how it is generated, and how to make the documentation a part of the CI that cannot be skipped. The examples were built with Doxygen 1.9.8 and Graphviz, and the outputs are real.

<!-- truncate -->

## What to document, and what not

My [coding style](/docs/platform/embi-platform/coding-style) has one paragraph about it: Doxygen-style comments for all **public** functions, types and macros, in English, short and precise, *why* and not *what*. A few examples of the difference:

| A comment that costs nothing | A comment that helps |
|---|---|
| `/* initializes the module */` | `Clears the filter and marks the value as not valid. The module does not report a value until Temperature_Task() has run at least once.` |
| `/* returns the value */` | `Returns TEMPERATURE_REQUEST_OK if a valid value is available, TEMPERATURE_REQUEST_ERROR if the task has not run yet.` |
| `/* value */` (for a parameter) | `Filtered temperature in tenths of a degree Celsius. Must not be NULL. Written only if the function returns TEMPERATURE_REQUEST_OK.` |

The first column repeats the name of the function, which the reader can already see. The second column says what the reader **cannot** see: the unit, the valid range, who owns the memory, whether the output is written in the case of an error, from where the function can be called, what has to be done before it. For an embedded interface it is also the place for the information that is dangerous to guess: *is it safe to call it from an interrupt*, *how long can it block*, *is the pointer allowed to be NULL*.

## The module in the files of the platform

The templates of EmBi_Platform, from which every module starts, have the same documentation skeleton: the header of the file, with `\author`, `\file`, `\ingroup` and `\brief`, and above every function a block with a `\brief`, a description and a `\return`. The finite state machine template adds `\pre` for the preconditions and a block `\par Used global variables` with a list of the variables that the function reads (`in`), writes (`out`) or both (`in,out`), which is a surprisingly useful kind of documentation: the data flow of a function in three lines.

The whole module is one **group** in Doxygen. The `\ingroup Temperature` in each file says that the file belongs to the module, and the group itself is defined once, in the port file:

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

The types have a short description of the type and of every value (the `/**< ... */` comment behind a member documents the member on the same line):

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

## Generating it

Doxygen is configured by a file with a few hundred options. Writing it by hand is a mistake that is easy to avoid: the platform has the file as a template (`Doxyfile.in` in the Doxygen artifact) and fills it from CMake variables, and the projects only set the ones that differ from the defaults. The same is possible with the module of CMake itself, and this is the whole configuration of the example:

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

and the build is one target:

```bash
cmake -S . -B build -G Ninja
cmake --build build --target docs
```

The result is a folder with the HTML pages. The group of the module, with the files that belong to it and the description from the port file, looks like this:

![The page of the Temperature group in the generated HTML documentation](/img/blog/doxygen-module-group.png)

Doxygen also draws the **include graph** of every file and the **call graph** and **caller graph** of every documented function (`HAVE_DOT`, Graphviz: that is the reason why the platform has an artifact for it). The include graphs are worth a look from time to time: an arrow from an application file to an internal header of a module is the same problem that the [article about the file organization](/blog/file-organization-embedded-c) describes, only seen from above.

## The documentation as a test

This is the part that changes the discipline. Four options turn missing documentation from a "we should" into a "the build is red":

```cmake
set(DOXYGEN_WARN_IF_UNDOCUMENTED   YES)   # a public member without a description
set(DOXYGEN_WARN_IF_DOC_ERROR      YES)   # a wrong tag, a parameter that does not exist
set(DOXYGEN_WARN_NO_PARAMDOC       YES)   # a function whose parameters are not described
set(DOXYGEN_WARN_AS_ERROR          FAIL_ON_WARNINGS)
```

With `FAIL_ON_WARNINGS` Doxygen goes through everything, prints **all** the warnings and only then fails (the plain `YES` stops at the first one). I tried it: I deleted the description of `Temperature_Task()` and the `\param` of `Temperature_Get_Value()` from the port file, and the build said:

```text
Temperature/Temperature_Port.h:40: error: Member Temperature_Task(void) (function) of file Temperature_Port.h is not documented.
Temperature/Temperature_Port.h:45: error: parameters of member Temperature_Get_Value are not documented
ninja: build stopped: subcommand failed.
```

(The exit code of the command is 1, so the CI is red.) With the descriptions back, the same build finishes with no output at all and an exit code 0. A new function without a comment now cannot get to the main branch by mistake, and nobody has to be the one who remembers it in a review.

## What a good documentation of an interface contains

For each function of a public interface, check the list:

1. **What it does**, in one sentence, with the verb (`\brief`).
2. **The parameters**: the direction (`[in]`, `[out]`, `[in,out]`), the unit, the range, whether `NULL` is allowed.
3. **The return value**: every value that can be returned and what it means.
4. **The preconditions** (`\pre`): what has to be done before, for example the initialization.
5. **The context**: can it be called from an interrupt, does it block, how long does it take.
6. **The side effects**: what else it changes (a global state, a peripheral).

If a function does not have an answer to one of these questions, the answer is in the code and the reader has to read it. That is the sign that the interface is not finished, and the exercise of writing the comment is often the moment when you find it.

## Where it fits in the platform

Each module of the platform has in its `CMakeLists.txt` a call that registers its folder for the documentation (when the Doxygen artifact is available in the project), and the root build has an option `DOXYGEN_ENABLED`. So the documentation of the whole firmware is generated by the same build as the firmware: `-DDOXYGEN_ENABLED=ON`. The artifacts (the Doxygen and Graphviz) are fetched in the version that the project has pinned, so the pages of today and of the next year look the same.

## A checklist

1. Every public function, type and macro has a description. The internal ones only where it is not obvious.
2. The description says what the reader cannot see in the signature: units, ranges, the context, the errors.
3. One group per module (`\defgroup` in the port file, `\ingroup` in the others).
4. `WARN_IF_UNDOCUMENTED`, `WARN_NO_PARAMDOC` and `FAIL_ON_WARNINGS` in the CI.
5. The graphs are on, and somebody looks at the include graph of the application once in a while.
6. The documentation is generated from the same build as the firmware, with the pinned tools.
