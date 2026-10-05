---
title: "Running the real firmware without the hardware: a simulator in the CI"
slug: firmware-in-simulator-ci
date: 2026-10-07T18:00:00
authors: [Mr.Nobody]
tags: [embedded, c, testing]
---

In the article about [unit testing with Unity and CMock](/blog/unit-testing-unity-cmock) I said that the tests on the PC do not find "the differences between the PC and the MCU". This article is about those differences, and about the tool that finds them: a **simulator that runs the real binary**. Not the logic compiled for the PC, but the very `.elf` that the ARM compiler made, with the real startup code and the real linker script, on a model of a processor and its peripherals.

I will show two experiments that I ran: the same test source that passes on the PC and fails on the Cortex-M4, and a firmware that writes to the registers of a USART at the real addresses of an STM32F4 and whose text appears in the terminal. At the end there is an honest list of what a simulator will not tell you.

<!-- truncate -->

## Where it fits

| Level | What runs | What it finds | Speed |
|---|---|---|---|
| **Unit test on the PC** | the logic, compiled for the PC, the layers below mocked | logic errors | milliseconds |
| **Simulator** | the real firmware binary, on a model of the MCU | the target-specific errors, the startup, the drivers against a register model | seconds |
| **Hardware in the loop** | the real firmware on the real MCU with real signals | timing, the electrical behavior, the real peripherals | minutes, a lab |

The middle level is the one that is skipped most often, and it is the cheapest to add to a CI that already builds the firmware: a simulator is an executable that you start with the file that your build has produced.

The tool in my experiments is QEMU 8.2.2 with the machine `netduinoplus2`, a model of a board with an **STM32F405** (a Cortex-M4 with the memory map of the real chip: the flash at `0x08000000`, the RAM at `0x20000000`, the peripherals at their real addresses). The platform has an artifact for another simulator, **Renode**, and I come back to it at the end.

## Experiment 1: the test that passes on the PC and fails on the MCU

A small module with two functions that every firmware has: the conversion of the time and the check of a received byte.

```c title="Conversions.c"
#include "Conversions.h"

long Conversions_Get_Microseconds(uint32_t milliseconds)
{
    return (long)milliseconds * 1000L;
}

bool Conversions_Is_HighBitSet(char receivedByte)
{
    return (receivedByte < 0);
}
```

Both functions look right, and both are tested on the PC. The test source is the same for both targets: only the output is different. The file `Platform.h` prints through `printf` on the PC and through *semihosting* (a request to the simulator or to the debugger) on the target, and the exit code of the test says whether it passed:

```c title="Platform.h"
#ifndef PLATFORM_H
#define PLATFORM_H

/* The same test source runs on the PC and on the target: only the output differs. */
#if defined(__arm__)
    #include <stdint.h>
    static inline int Semihost_Call(int operation, const void *argument)
    {
        register int   r0 __asm__("r0") = operation;
        register const void *r1 __asm__("r1") = argument;
        __asm__ volatile ("bkpt 0xAB" : "+r"(r0) : "r"(r1) : "memory");
        return r0;
    }
    static inline void Platform_Print(const char *text) { (void)Semihost_Call(0x04, text); }
    static inline void Platform_Exit(int failures)
    {
        /* 0x20026: the application exited normally, 0x20023: the application failed */
        (void)Semihost_Call(0x18, (const void *)(0 == failures ? 0x20026u : 0x20023u));
    }
#else
    #include <stdio.h>
    #include <stdlib.h>
    static inline void Platform_Print(const char *text) { fputs(text, stdout); }
    static inline void Platform_Exit(int failures)      { exit(0 == failures ? 0 : 1); }
#endif

#endif
```

```c title="tests.c"
#include <stdbool.h>
#include <stdint.h>
#include "Conversions.h"
#include "Platform.h"

static int failures;

#define CHECK(condition, name)                                          \
    do {                                                                \
        if (condition) { Platform_Print("PASS  " name "\n"); }          \
        else           { Platform_Print("FAIL  " name "\n"); failures++; } \
    } while (0)

int main(void)
{
    /* 3 000 000 ms = 50 minutes = 3 000 000 000 us */
    CHECK(3000000000L == Conversions_Get_Microseconds(3000000u), "50 minutes in microseconds");
    CHECK(5000L == Conversions_Get_Microseconds(5u),             "5 ms in microseconds");

    /* the byte 0xFF is received from the UART */
    CHECK(true == Conversions_Is_HighBitSet((char)0xFF),         "0xFF has the high bit set");
    CHECK(false == Conversions_Is_HighBitSet((char)0x41),        "'A' has not the high bit set");

    Platform_Exit(failures);
    return failures;
}
```

On the PC:

```text
PASS  50 minutes in microseconds
PASS  5 ms in microseconds
PASS  0xFF has the high bit set
PASS  'A' has not the high bit set
exit code: 0
```

The same source, compiled with `arm-none-eabi-gcc` for the Cortex-M4 and started in QEMU:

```text
FAIL  50 minutes in microseconds
PASS  5 ms in microseconds
FAIL  0xFF has the high bit set
PASS  'A' has not the high bit set
exit code: 1
```

Two bugs, and both are invisible on the PC:

- **`long` has a different width.** On a 64-bit Linux PC a `long` has 64 bits, on a Cortex-M it has 32. `3 000 000 ms * 1000` is `3 000 000 000`, which does not fit into a signed 32-bit number (the biggest is 2 147 483 647), so the result is wrong, and in C it is also an undefined behavior.
- **`char` has a different signedness.** The C standard leaves it open whether a plain `char` is signed. On x86 it is, so `(char)0xFF` is `-1` and the check `receivedByte < 0` works. On the ARM it is *unsigned*, so `(char)0xFF` is `255` and the comparison is never true. The ARM compiler even says it, and only there:

```text
Conversions.c:10:26: warning: comparison is always false due to limited range of data type [-Wtype-limits]
```

Both are the question of the portable types, which is the topic of the rule 4.6 in the article about [MISRA](/blog/misra-c-rules-in-practice): use the types with a size and a signedness. The fixed version uses `uint64_t` for the time and `uint8_t` for the byte:

```c
uint64_t Conversions_Get_Microseconds_Fixed(uint32_t milliseconds)
{
    return (uint64_t)milliseconds * 1000u;
}

bool Conversions_Is_HighBitSet_Fixed(uint8_t receivedByte)
{
    return (0u != (receivedByte & 0x80u));
}
```

and the same four checks now pass **on both targets**, with exit code 0 on both. The first version was not a bug of the test, and the test on the PC was not wrong: it simply tested a different program.

The exit code is the whole integration with the CI. The simulator terminates with the code that the firmware gives to the semihosting call, so the `add_test` of CMake (see the article about [CMake for firmware](/blog/cmake-for-embedded-firmware)) fails when the test on the target fails:

```cmake
add_test(NAME conversions_on_target
    COMMAND qemu-system-arm -M netduinoplus2 -nographic
            -semihosting-config enable=on,target=native -kernel conversions_test.elf)
```

## Experiment 2: the registers of a peripheral

A simulator also models the peripherals, and then the code that is closest to the hardware can run too. This is a firmware that sends a text through the USART1 of an STM32F4, written on the register level with the real addresses (no library, no startup beyond the code from the article about [what happens before `main()`](/blog/before-main-startup-linker)):

```c title="uart.c"
#include <stdint.h>

/* STM32F4: RCC and USART1 registers, the same addresses as on the real chip */
#define RCC_APB2ENR  (*(volatile uint32_t *)0x40023844u)
#define USART1_SR    (*(volatile uint32_t *)0x40011000u)
#define USART1_DR    (*(volatile uint32_t *)0x40011004u)
#define USART1_CR1   (*(volatile uint32_t *)0x4001100Cu)

#define RCC_APB2ENR_USART1EN  ( 1u << 4 )
#define USART_CR1_UE          ( 1u << 13 )
#define USART_CR1_TE          ( 1u << 3 )
#define USART_SR_TXE          ( 1u << 7 )

static void Uart_Send(const char *text)
{
    while ('\0' != *text)
    {
        while (0u == (USART1_SR & USART_SR_TXE)) { }     /* wait until the data register is empty */
        USART1_DR = (uint32_t)(unsigned char)*text++;
    }
}

int main(void)
{
    RCC_APB2ENR |= RCC_APB2ENR_USART1EN;                  /* clock of the peripheral */
    USART1_CR1  |= USART_CR1_UE | USART_CR1_TE;           /* enable the USART and its transmitter */

    Uart_Send("hello from the register level\r\n");

    for (;;) { }
}
```

```text
hello from the register level
```

The text is in the terminal of the simulator: the firmware switched on the clock of the peripheral in the RCC, enabled the USART and its transmitter, waited for the flag `TXE` and wrote the data register, exactly as it would on the board, and the model of the USART passed the byte to the serial port. It is a test of a driver against a model of the register interface. If a driver waits for a flag that never comes, the test finds it by a timeout, and not at the desk with an oscilloscope.

## What the simulator does not tell you

A simulator is a *model*, and every model has a boundary. A few that I met in the experiments of this series:

- **The timing is not real.** QEMU runs the instructions as fast as the PC allows and does not count the cycles of the real core. A test that must prove "the interrupt is served within 5 microseconds" cannot be done in it.
- **The interrupts arrive in other places than on the MCU.** In the article about [interrupts](/blog/interrupts-and-main-shared-data) the lost update of a shared counter did not appear in QEMU in 200 000 tries, because QEMU delivers an interrupt between blocks of the translated code. The real MCU can interrupt after every instruction. A simulator does not prove the absence of a race.
- **Only the modeled peripherals exist.** The model of the STM32F405 has a USART, but another chip may have a peripheral that the model does not have, or has it in a simplified form: the registers are there, the analog part is not.
- **The electrical world is missing:** a bounce of a contact, the noise on an ADC input, a voltage drop. Everything that comes from the outside is what you put into the model.

So the simulator replaces neither the unit tests (they are faster and test the logic in isolation) nor the hardware tests (they test the reality). It finds the things between: the compiler of the target, the types, the startup, the memory map, the driver against a register model, and it does it in a few seconds on every commit.

## Renode

The platform has an artifact for **Renode**, Antmicro's open-source simulation and virtual development framework, shipped together with `renode-test`, its Robot Framework based test runner, which is used for the integration tests of simulated firmware. I did not run it for this article (the release could not be downloaded in my environment), so I only repeat what its documentation says, and I do not compare it with QEMU. The structure of such a test is the same as above: the real ELF, a model of the hardware, a verdict and an exit code for the CI.

## A checklist

1. Build the test for the **target**, with the compiler of the target, and run it in a simulator, in addition to the PC.
2. Use one test source for both, with a thin layer (`Platform.h`) for the output and the exit.
3. The exit code of the simulator is the result of the test, so the CI needs nothing more.
4. Use the types with a size and a signedness (`uint32_t`, `uint8_t`) and the warnings of the target compiler: the second bug above (the `char`) would be found by `-Wtype-limits`, if anyone looked at the output of the ARM build.
5. Write down what the simulator cannot prove (the timing, the races, the analog world) and leave it to the hardware tests.
