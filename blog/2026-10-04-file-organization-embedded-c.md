---
title: "File organization in embedded C: how a folder becomes a module"
slug: file-organization-embedded-c
date: 2026-10-04T14:00:00
authors: [Mr.Nobody]
tags: [embedded, architecture, c]
---

My [coding style](/docs/platform/embi-platform/coding-style) says that file names start with the module name and that "the complete file organization is described elsewhere". This is the elsewhere.

C has no `private`, no namespaces and no packages. Once the code is split into files, the files and the build system are the **only** tools you have to say what belongs together, what is public and what is nobody else's business. So the file organization is not a matter of taste, it is a part of the design. This article describes how I organize an embedded project on three levels: the project, the module and the single file.

<!-- truncate -->

## Level 1: the project

A project created with EmBi_Platform has the same layout every time:

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

Every folder answers one question, and the answer is the reason why the code lives there.

**Application** is what makes the product different from every other product on the same MCU. It has its own inner layers, and their names are the levels of the "tree" from the [article about architecture](/blog/design-architecture): `AppMain` starts everything, `AppCore` is the top of the tree with the logic of the whole device, `AppFun` contains the individual functionalities, `AppComp` the low level components they are built from and `AppCom` the communication with the outside world. The calls go from the top to the bottom, never the other way.

**Middlewares** have two places for every component, and this is on purpose. `ThirdParty/FreeRTOS` is the vendor code, checked out as a Git submodule in a version that you choose, and you **never edit it**. Everything that is yours (the port layer, the configuration) lives next to it in `Middlewares/FreeRTOS`, and it is not overwritten when you switch the vendor code to another version. When the vendor releases a fix, you update a submodule and not a patched copy.

**Bsp** is described in the [BSP documentation](/docs/bsp), the short version is: `Ral` knows the registers, `Mcal` the peripherals and `Hal` the board. Each STM32 family has its own branch of the BSP, so the folders look the same for every MCU.

**EmBi_Platform** and **STM32CubeIDE** are tools. They do not end up in the binary, and the IDE project is generated, so it can be thrown away and created again.

## Level 2: the module

A module is a folder with a fixed set of files. You do not have to create them by hand, the platform generates them (see the end of the article), and the result looks like this:

```text
Temperature/
├── CMakeLists.txt
├── Temperature_Types.h
├── Temperature_Port.h
├── Temperature.h
├── Temperature.c
└── Temperature_Filter.c     (a component, see below)
```

| File | Role | Who may include it |
|---|---|---|
| `Temperature_Types.h` | Public types, enumerations and macros | everybody |
| `Temperature_Port.h` | Public functions: the **only** entry point of the module | everybody |
| `Temperature.h` | Internal types and functions shared by the files of the module | only the module itself |
| `Temperature.c` | Implementation | (a source file) |
| `CMakeLists.txt` | Creates the static library `Temperature_Lib` | the build |

The idea is that a user of the module reads **two** files and nothing else. The first one are the types (the generated file also contains the version type and the usual enumerations for the request and function states, I trimmed it here to what the example needs):

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

The second one is the port, which is the whole interface of the module. Everything that is not here does not exist for the others:

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

The internal header has the data and the functions that the files of the module need to share, and that nobody outside should ever see:

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

And the implementation uses all of it:

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

Notice that the state is `static` in the `.c` file. There is no global variable, so there is no `extern` (which my coding style prohibits). The only way to the data is the function `Temperature_Get_Value()`, a getter that also tells the caller whether the value is valid.

### The build system makes the file the encapsulation

"Include only the port" would be just a wish if nothing enforced it. The `CMakeLists.txt` of every module does. It builds a static library and **copies only the public headers** to a separate folder in the build directory. That folder is the only one that the users of the library get on their include path:

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

(This is a simplified version of the template that the platform generates, which also handles the dependencies between the libraries and the Doxygen paths.) Now the application only links `Temperature_Lib`:

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

I tried what happens if the application includes the internal header of the module, and the compiler says what you want it to say:

```text
AppMain_Cheat.c:1:10: fatal error: Temperature.h: No such file or directory
```

The folder with the public headers in the build directory contains exactly two files: `Temperature_Port.h` and `Temperature_Types.h`.

**An honest warning:** it is the protection of the build system, not of the language. If somebody writes `#include "../../Middlewares/Temperature/Temperature.h"`, it compiles without a complaint (I tried that too). The cure is cheap: reject relative paths with `..` in the includes in the CI.

```bash
grep -rEn '#include "[^"]*\.\./' Application Middlewares/*/ && exit 1
```

### When the module grows: components

A module with a thousand lines in one file is the next problem. The answer is a **component**: another pair of files `Module_Component.c/.h` in the same folder. In the example above it is the filter:

```c title="Temperature_Filter.c"
#include "Temperature.h"

static temperature_Value_t lastValue;

temperature_Value_t Temperature_Filter_Apply( temperature_Value_t rawValue )
{
    lastValue = (temperature_Value_t)((lastValue + rawValue) / 2);
    return lastValue;
}
```

The component header is internal as well (it is not in the list of the public headers), so the component can be exchanged or split without anyone noticing. The user of the module still sees the same two files. The rule that the file name starts with the module name makes the component visible in every file list, and the function name `Temperature_Filter_Apply()` tells where to find it.

## Level 3: inside a file

Every `.c` and `.h` file generated by the platform has the same skeleton with a banner for each section, in the same order:

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

It looks like a decoration, and it is a map. When you open a file that you have never seen, you know that the local variables are in the fifth section and the interrupt handlers in the tenth, and you do not have to read the file to find them. The headers have the same idea, wrapped in an include guard and in `extern "C"` for the C++ users:

- the guard has the form `MODULE_FILE_H`, for example `TEMPERATURE_TEMPERATURE_PORT_H`,
- the Doxygen header (`\file`, `\ingroup`, `\brief`) is on the top of every file, so the documentation of the module is generated from the same folder,
- the includes are ordered `<system>`, then the project, then the module.

## One name in all places

The strength of this organization is that the name of the module is the same everywhere, so you can guess a name without looking it up:

| What | Example |
|---|---|
| Folder | `Temperature/` |
| Library in CMake | `Temperature_Lib` |
| Files | `Temperature.c`, `Temperature_Port.h`, `Temperature_Types.h` |
| Functions | `Temperature_Init()`, `Temperature_Get_Value()` |
| Types | `temperature_Value_t`, `temperature_RequestState_t` |
| Macros and enumerators | `TEMPERATURE_REQUEST_OK` |
| Include guard | `TEMPERATURE_TEMPERATURE_PORT_H` |

If you see `Gpio_Set_PinLevel()` in a stack trace, you know that it is in the folder `Gpio`, in the library `Gpio_Lib` and that its types start with `gpio_`.

### The same lifecycle for every module

The generated module comes with the four functions that every module has: `Get_ModuleVersion()`, `Init()`, `Deinit()` and `Task()`. `Init` sets up the module and handles its own failures, `Task` is called periodically from the main loop or from a scheduler. The consequence is that the code on top (`AppMain`) can treat all modules in the same way, and a new module does not need a new concept.

## Creating a module

You do not create these files by hand. The project tools of the platform (the *Create module* entry of the menu, described on the page [Project tools](/docs/platform/embi-platform/cmake-helpertools)) ask for the name and the location, and generate the folder with all the files above and the `CMakeLists.txt`. The *Add component* entry adds a `Module_Component.c/.h` pair to an existing module. A module that was generated once is never overwritten, so it is safe to run the tool again.

## The rules in a short form

1. One module is one folder, and it has its own library.
2. Other modules include **only** `Module_Port.h` and `Module_Types.h`.
3. Internal headers are not in the list of public headers.
4. The data is `static` in the `.c` file, access goes through functions. No `extern` variables.
5. The file name begins with the module name, and so does every function, type and macro.
6. Vendor code is never edited. Your changes live in the handler folder next to it.
7. The calls go down in the layers, never up.
8. Everything in a file is in its section, in the same order.

None of these rules is clever. The point is that all of them are the same in all modules, so after you have read one module, you know how to read all the others. That is also the reason why the platform generates the files: a convention that takes work to follow is a convention that is not followed.

The same ideas, from a different point of view, are in the articles about [SOLID principles](/blog/solid-principles-c-cpp) (the port header is the interface that other modules depend on) and about [MISRA C](/blog/misra-c-rules-in-practice) (several of the rules are much easier to follow when the code is organized like this).
