---
title: "Designing a peripheral API: eight decisions behind the Gpio module"
slug: designing-peripheral-api-gpio
date: 2026-10-07T10:00:00
authors: [Mr.Nobody]
tags: [embedded, c, architecture]
---

The GPIO is the simplest peripheral of a microcontroller: a pin is high or low. That is exactly why it is a good subject for an article about the **design of an interface**. There is no hardware complexity to hide behind, and every decision is a choice of the designer: how a pin is named, what a function returns, where the polarity of an LED lives. The MCAL module `Gpio` of the Embedbits BSP is a real example with real answers, and I will go through them one by one, with the alternatives and the price.

The code from the module is quoted from the STM32H5 branch of [Bsp-Mcal-Gpio](https://github.com/Embedbits/Bsp-Mcal-Gpio). The examples that use it were compiled and run against the **real** `Gpio_Port.h` and `Gpio_Types.h`, with a small fake of the implementation, so that the API could be tried on a PC.

<!-- truncate -->

## The whole interface on one screen

```c
gpio_ModuleVersion_t Gpio_Get_ModuleVersion  ( void );

gpio_RequestState_t  Gpio_Init               ( gpio_Config_t *gpioConfig );
void                 Gpio_Deinit             ( void );
void                 Gpio_Task               ( void );

gpio_RequestState_t  Gpio_Set_PortActive     ( gpio_PortId_t portId );
gpio_RequestState_t  Gpio_Set_PinMode        ( gpio_PortId_t portId, gpio_PinId_t pinId, gpio_PinMode_t pinType );
gpio_RequestState_t  Gpio_Get_PinMode        ( gpio_PortId_t portId, gpio_PinId_t pinId, gpio_PinMode_t * const pinType );
/* ... speed, output type, alternate function and pull in the same pairs ... */

gpio_RequestState_t  Gpio_Toggle_PinLevel    ( gpio_PortId_t portId, gpio_PinId_t pinId );
gpio_RequestState_t  Gpio_Set_PinLevel       ( gpio_PortId_t portId, gpio_PinId_t pinId, gpio_PinLevel_t pinLevel );
gpio_RequestState_t  Gpio_Get_PinLevel       ( gpio_PortId_t portId, gpio_PinId_t pinId, gpio_PinLevel_t * const pinLevel );

gpio_RequestState_t  Gpio_Set_PinStateActive   ( gpio_PortId_t portId, gpio_PinId_t pinId, gpio_PinLevel_t pinActiveLevel );
gpio_RequestState_t  Gpio_Set_PinStateInactive ( gpio_PortId_t portId, gpio_PinId_t pinId, gpio_PinLevel_t pinActiveLevel );
```

Every decision below can be read from this list.

## 1. A pin is a pair of identifiers, not a vendor macro

The vendor drivers address a pin with a pointer to a register block and a bit mask: `LL_GPIO_SetOutputPin(GPIOA, LL_GPIO_PIN_5)`. The MCAL takes two enumerations instead, `gpio_PortId_t` and `gpio_PinId_t`:

```c
Gpio_Set_PinLevel( GPIO_PORT_A, GPIO_PIN_ID_5, GPIO_PIN_LEVEL_HIGH );
```

**Why:** the code above the MCAL does not need any vendor header, it does not know what `GPIOA` is (the address of a register block of the vendor), and an identifier can be range-checked, as an arbitrary pointer cannot. Each enumeration ends with a counter (`GPIO_PORT_CNT`, `GPIO_PIN_ID_CNT`), which is the upper limit for the check at the beginning of a function.

**The price:** a table that translates the identifier to the register block (in `Gpio.c`, one line per port) and one more indirection. The table also solves a problem of its own: the MCUs of a family have a different number of ports, so the entries are wrapped in `#if defined(GPIOK)` (see the article about [the families](/blog/bsp-stm32-families-git-branches)).

## 2. Every function that can fail returns a state, and the results go out through a pointer

All functions except `Deinit`, `Task` and the version getter return `gpio_RequestState_t`, and the getters deliver the value through a pointer parameter:

```c
gpio_PinLevel_t level = GPIO_PIN_LEVEL_LOW;

if (GPIO_REQUEST_OK == Gpio_Get_PinLevel(GPIO_PORT_C, GPIO_PIN_ID_13, &level))
{
    /* level is valid here */
}
```

**Why:** the return value of a getter cannot carry the value *and* the information that the value is not valid (`GPIO_PIN_LEVEL_LOW` is a valid level, so a returned `0` is ambiguous). With the state in the return value and the data in the parameter, an invalid port, an invalid pin or a `NULL` pointer is a visible error and not a silently wrong level. The `* const` in the signature says that the function does not change the pointer, only the data behind it.

**The price:** two lines instead of one at every use. And the state has two values (`GPIO_REQUEST_OK`, `GPIO_REQUEST_ERROR`), so the caller knows *that* it failed and not *why*. For a GPIO it is enough, because there are only a few reasons (an invalid identifier, a `NULL`), and all of them are programming errors. For a peripheral with a real failure (a timeout of the I2C, a bus error), the caller needs more, and a richer enumeration is the usual answer.

The rule from the article about [MISRA](/blog/misra-c-rules-in-practice) that applies is 17.7 (the returned value is used): here the interface makes it easy to follow, because every function that can fail tells it through the value that you have to look at.

## 3. A pin is configured by data, not by a sequence of calls

There is a configuration structure with everything that describes a pin, and one function that applies it:

```c
typedef struct
{
    gpio_PortId_t        PortId;         /**< GPIO port identification       */
    gpio_PinId_t         PinId;          /**< GPIO pin identification        */
    gpio_PinMode_t       PinMode;        /**< GPIO pin type                  */
    gpio_PinPullCfg_t    PinPull;        /**< GPIO pin pull configuration    */
    gpio_PinSpeed_t      PinSpeed;       /**< GPIO output speed              */
    gpio_PinOutputType_t PinOutType;     /**< GPIO output style              */
    gpio_AltFunction_t   PinAltFunction; /**< Alternate function used by pin */
    gpio_PinLevel_t      PinActiveLevel; /**< Pin level in active state      */
}   gpio_Config_t;
```

**Why:** the knowledge about the board then lives in a **table**, and the code that applies it is the same for every board. Look at the example that I compiled and ran: the board is two entries, and the initialization is a loop.

```c title="board.c"
#include <stdbool.h>
#include "Gpio_Port.h"

/* The board is data: which pin is what, and what "active" means for it. */
typedef enum { BOARD_IO_LED, BOARD_IO_BUTTON, BOARD_IO_CNT } boardIo_t;

static gpio_Config_t boardPins[BOARD_IO_CNT] =
{
    [BOARD_IO_LED] =
    {
        .PortId = GPIO_PORT_A, .PinId = GPIO_PIN_ID_5, .PinMode = GPIO_PIN_MODE_OUTPUT,
        .PinPull = GPIO_PIN_PULL_NONE, .PinSpeed = GPIO_PIN_SPEED_LOW,
        .PinOutType = GPIO_PIN_OUTPUT_PUSHPULL, .PinAltFunction = GPIO_ALT_FUNC_CNT,
        .PinActiveLevel = GPIO_PIN_LEVEL_LOW        /* this LED is connected to the supply: low = on */
    },
    [BOARD_IO_BUTTON] =
    {
        .PortId = GPIO_PORT_C, .PinId = GPIO_PIN_ID_13, .PinMode = GPIO_PIN_MODE_INPUT,
        .PinPull = GPIO_PIN_PULL_NONE, .PinSpeed = GPIO_PIN_SPEED_LOW,
        .PinOutType = GPIO_PIN_OUTPUT_PUSHPULL, .PinAltFunction = GPIO_ALT_FUNC_CNT,
        .PinActiveLevel = GPIO_PIN_LEVEL_HIGH
    },
};

bool Board_Init(void)
{
    bool isOk = true;

    for (uint32_t index = 0u; index < (uint32_t)BOARD_IO_CNT; index++)
    {
        if (GPIO_REQUEST_OK != Gpio_Init(&boardPins[index]))
        {
            isOk = false;
        }
    }
    return isOk;
}

bool Board_Set_Led(bool isOn)
{
    const gpio_Config_t *led = &boardPins[BOARD_IO_LED];

    return (GPIO_REQUEST_OK == (isOn
        ? Gpio_Set_PinStateActive  (led->PortId, led->PinId, led->PinActiveLevel)
        : Gpio_Set_PinStateInactive(led->PortId, led->PinId, led->PinActiveLevel)));
}
```

Because the table is data, a new revision of the PCB changes a line in the table and nothing in the code. In the Embedbits architecture it is the job of the HAL layer: it holds the tables and uses the MCAL to apply them.

**The price:** the structure has eight fields and every entry has to fill all of them (the designated initializers make it readable, and a field that is left out is zero, which is not always a sensible value). That is why a `Get_DefaultConfig` function, which some other modules have, is a useful companion.

## 4. The polarity of a signal is a property of the pin, not of the code

The structure has the field `PinActiveLevel`, and there are the functions `Gpio_Set_PinStateActive()` and `Gpio_Set_PinStateInactive()`, which take the polarity as a parameter. The reason is a plain fact of electronics: an LED can be connected to the ground (it lights up with a **high** level) or to the supply (it lights up with a **low** level), and a chip-select signal is usually *active low*. If the code says `Gpio_Set_PinLevel(..., HIGH)` for "LED on", it is right for one board and wrong for the next.

With the polarity in the table, the application says "on" and the table says what that means. In the example above the LED is connected to the supply, so `PinActiveLevel` is `GPIO_PIN_LEVEL_LOW`, and the test confirms what the pin does:

```text
after Board_Init():      the pin is high (the LED is off)
after Board_Set_Led(1):  the pin is low  (the LED is on)
```

## 5. The enumerations are the vendor constants

The types do not invent their own numbers, they are the numbers of the vendor driver:

```c
typedef enum
{
    GPIO_PIN_MODE_INPUT     = LL_GPIO_MODE_INPUT,     /**< Select input mode              */
    GPIO_PIN_MODE_OUTPUT    = LL_GPIO_MODE_OUTPUT,    /**< Select output mode             */
    GPIO_PIN_MODE_ALTERNATE = LL_GPIO_MODE_ALTERNATE, /**< Select alternate function mode */
    GPIO_PIN_MODE_ANALOG    = LL_GPIO_MODE_ANALOG     /**< Select analog mode             */
}   gpio_PinMode_t;
```

**Why:** the conversion from the type of the MCAL to the value that the LL function wants is **free**: there is no `switch`, no table and no way to make a typing mistake in the translation. The values of the constants differ from a family to a family, and that is hidden in the one `#include` of the RAL port (the family-specific `Stm32_gpio.h`).

**The price:** `Gpio_Types.h`, a public header, includes the header of the RAL, so the vendor constants leak into the headers that the users of the module see. The alternative is the type with its own values and a translation table in the `.c` file, which costs code and a place for a bug, but keeps the vendor out of the public headers. The decision is a compromise, and it is good to know that it is one.

## 6. The same lifecycle as every other module

`Gpio_Get_ModuleVersion()`, `Gpio_Init()`, `Gpio_Deinit()` and `Gpio_Task()` come from the template that every module starts with (see the article about the [file organization](/blog/file-organization-embedded-c)). The difference is in the one place where it makes sense: `Gpio_Init()` is not `void`, it takes **a pin configuration**. A GPIO module does not know the board, so "initialize the module" has no meaning without the question "which pin?". A uniform lifecycle that is bent where the nature of the module requires it is better than a lifecycle that is forced on a module where it does not fit.

## 7. The order of the steps is a part of the interface

Look at the comment of `Gpio_Init()`:

```c
/**
 * Activates the port clock and configures the pin. Output level (inactive state),
 * output type, speed, pull and alternate function are configured before the pin
 * mode, so an output pin starts directly with its inactive level (no glitch).
 * Configuration stops at the first failed step.
 */
```

The pin mode, which is the step that actually **connects the output driver to the pad**, is the last. If the mode were first, the pin would for a moment drive the level that the output register had after the reset (usually low), and then jump to the right one: a pulse on a line that may be a chip-select, a reset of another chip or the gate of a transistor. Such a glitch is invisible in a debugger and visible on an oscilloscope. It is a good example of a rule for API design: **when the order of the steps matters for the hardware, the function that does them should own the order**, so the user cannot get it wrong.

The second sentence of the comment, "stops at the first failed step", is also a design decision: the function does not try to continue after an error, and it returns the state of the failing step.

## 8. A wrong argument is an error that the caller can see, not a crash

The functions check their arguments, and the answer is the state:

```c
assert(GPIO_REQUEST_ERROR == Gpio_Init(GPIO_NULL_PTR));
assert(GPIO_REQUEST_ERROR == Gpio_Get_PinLevel(GPIO_PORT_CNT, GPIO_PIN_ID_0, &level));
assert(GPIO_REQUEST_ERROR == Gpio_Set_PinLevel(GPIO_PORT_A, GPIO_PIN_ID_CNT, GPIO_PIN_LEVEL_HIGH));
```

(This is the test of my fake, but the real `Gpio_Init()` does the same for the `NULL`: the whole body is inside `if( GPIO_NULL_PTR != gpioConfig )`.) The `_CNT` constants have a second job here: `GPIO_PORT_CNT` is the first value that is **not** a valid port, so the check is a single comparison. In a firmware, there is no one to show a message to, and an `assert` that stops the program is usually the wrong answer for a production build. An error that goes up to the caller, who knows what to do (and a module on top of the MCAL that knows what is critical), is a better one.

## What I would look at again

An honest design review always has a list, and this one has two items that come from the article about MISRA:

- `Gpio_Init( gpio_Config_t *gpioConfig )` only **reads** the structure, so the parameter could be `const gpio_Config_t *` (Rule 8.13). The signature would say that the function does not change the configuration, and the table of the board could be `const` and live in the flash instead of the RAM.
- The two-valued `gpio_RequestState_t` is the same in every module (it is generated by the template). It is a simple and uniform decision that is right for the GPIO, and the modules with the real failures will sooner or later need more.

## The principles, short

1. **Hide the hardware, not the intent.** The user says *which pin* and *what polarity*, not *which register*.
2. **Make the invalid state visible.** A status for everything that can fail, and an output only on success.
3. **Put the knowledge into data.** The board is a table that a loop reads.
4. **Let the function own the order** when the hardware cares about it.
5. **Keep the interface the same, and say honestly where it is bent** (`Init` with a parameter) and where the abstraction leaks (the vendor constants in the types).

An interface has two readers: the user of today, and the maintainer of the next year. The decisions above are written for both, and the comments in the headers are the proof that somebody thought about the second.
